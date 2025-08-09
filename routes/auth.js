const express = require('express');
const jwt = require('jsonwebtoken');
const moment = require('moment');
const License = require('../models/License.js');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');
const {
  validateKeyRequest,
  validateSessionRequest,
  handleValidationErrors,
  verifySignature,
  verifySession
} = require('../middleware/auth');
const {
  keyValidationLimiter,
  detectSuspiciousActivity
} = require('../middleware/security');

const router = express.Router();

// Route principale: Validation de clé de licence
router.post('/validate-key', 
  keyValidationLimiter,
  detectSuspiciousActivity,
  validateKeyRequest,
  handleValidationErrors,
  verifySignature,
  async (req, res) => {
    try {
      const { key, hwid, timestamp, fromStoredKey = false } = req.body;
      const ip = req.ip;
      const userAgent = req.get('User-Agent');
      
      logger.info('Tentative de validation de clé', {
        key: key.substring(0, 8) + '...',
        hwid: hwid.substring(0, 8) + '...',
        ip,
        userAgent,
        fromStoredKey
      });
      
      // Rechercher la clé en base
      const license = await License.findByKey(key);
      
      if (!license) {
        await AuditLog.logEvent('key_validation_failed', {
          licenseKey: key,
          hwid,
          ipAddress: ip,
          userAgent,
          message: 'Clé non trouvée',
          severity: 'warning',
          details: { reason: 'not_found', fromStoredKey }
        });
        
        return res.status(404).json({
          success: false,
          error: 'Clé de licence non trouvée',
          reason: 'not_found'
        });
      }
      
      // Incrémenter le compteur de tentatives (avec gestion du reset quotidien et fromStoredKey)
      await license.incrementAttempts(ip, fromStoredKey);
      
      // Vérifier le statut de la clé
      if (license.status === 'banned') {
        await AuditLog.logEvent('key_validation_failed', {
          licenseKey: key,
          hwid,
          ipAddress: ip,
          userAgent,
          message: 'Tentative d\'utilisation de clé bannie',
          severity: 'critical',
          details: { reason: 'banned', fromStoredKey }
        });
        
        return res.status(403).json({
          success: false,
          error: 'Cette clé a été bannie',
          reason: 'banned'
        });
      }
      
      if (license.status === 'suspended') {
        await AuditLog.logEvent('key_validation_failed', {
          licenseKey: key,
          hwid,
          ipAddress: ip,
          userAgent,
          message: 'Tentative d\'utilisation de clé suspendue',
          severity: 'warning',
          details: { reason: 'suspended', fromStoredKey }
        });
        
        return res.status(403).json({
          success: false,
          error: 'Cette clé est temporairement suspendue',
          reason: 'suspended'
        });
      }
      
      // Vérifier l'expiration
      if (license.isExpired()) {
        await AuditLog.logEvent('key_validation_failed', {
          licenseKey: key,
          hwid,
          ipAddress: ip,
          userAgent,
          message: 'Tentative d\'utilisation de clé expirée',
          severity: 'info',
          details: { 
            reason: 'expired',
            expiresAt: license.expiresAt,
            fromStoredKey
          }
        });
        
        return res.status(410).json({
          success: false,
          error: 'Cette clé a expiré',
          reason: 'expired',
          expiresAt: license.expiresAt
        });
      }
      
      // Vérifier si la clé est déjà liée à un autre HWID
      if (license.used && license.hwid && license.hwid !== hwid) {
        await AuditLog.logEvent('key_validation_failed', {
          licenseKey: key,
          hwid,
          ipAddress: ip,
          userAgent,
          message: 'Tentative d\'utilisation de clé sur HWID différent',
          severity: 'critical',
          details: { 
            reason: 'hwid_mismatch',
            registeredHwid: license.hwid.substring(0, 8) + '...',
            fromStoredKey
          }
        });
        
        return res.status(409).json({
          success: false,
          error: 'Cette clé est déjà utilisée sur une autre machine',
          reason: 'hwid_mismatch'
        });
      }
      
      // Lier la clé au HWID si ce n'est pas déjà fait
      if (!license.used || !license.hwid) {
        await license.bindToHWID(hwid);
        logger.info('Clé liée au HWID', {
          key: key.substring(0, 8) + '...',
          hwid: hwid.substring(0, 8) + '...'
        });
      }
      
      // Créer un token de session JWT
      const sessionPayload = {
        licenseKey: key,
        hwid: hwid,
        licenseType: license.licenseType,
        features: license.features,
        iat: Math.floor(Date.now() / 1000)
      };
      
      const sessionToken = jwt.sign(sessionPayload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRY || '7d'
      });
      
      // Calculer la date d'expiration de la session
      const sessionExpiry = moment().add(7, 'days').toDate();
      
      // Sauvegarder la session en base
      const session = new Session({
        sessionToken,
        licenseKey: key,
        hwid,
        expiresAt: sessionExpiry,
        createdIP: ip,
        lastIP: ip,
        userAgent,
        metadata: {
          clientVersion: req.get('X-Client-Version'),
          systemInfo: {
            platform: req.get('X-Platform'),
            arch: req.get('X-Arch'),
            version: req.get('X-Version')
          }
        }
      });
      
      await session.save();
      
      // Log de succès
      await AuditLog.logEvent('key_validation_success', {
        licenseKey: key,
        hwid,
        sessionToken,
        ipAddress: ip,
        userAgent,
        message: 'Validation de clé réussie',
        severity: 'info',
        details: {
          licenseType: license.licenseType,
          features: license.features,
          sessionExpiry,
          fromStoredKey
        }
      });
      
      logger.info('Validation de clé réussie', {
        key: key.substring(0, 8) + '...',
        hwid: hwid.substring(0, 8) + '...',
        licenseType: license.licenseType,
        sessionExpiry,
        fromStoredKey
      });
      
      // Réponse de succès
      res.json({
        success: true,
        sessionToken,
        sessionExpiry: sessionExpiry.toISOString(),
        licenseExpiry: license.expiresAt.toISOString(),
        keyStatus: {
          type: license.licenseType,
          features: license.features,
          validUntil: license.expiresAt.toISOString(),
          createdAt: license.createdAt.toISOString()
        }
      });
      
    } catch (error) {
      logger.error('Erreur lors de la validation de clé:', error);
      
      await AuditLog.logEvent('key_validation_failed', {
        licenseKey: req.body.key,
        hwid: req.body.hwid,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        message: 'Erreur serveur lors de la validation',
        severity: 'error',
        details: { error: error.message, fromStoredKey: req.body.fromStoredKey }
      });
      
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        reason: 'server_error'
      });
    }
  }
);

// Route: Vérification de session
router.post('/check-session',
  validateSessionRequest,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { sessionToken, hwid } = req.body;
      const ip = req.ip;
      
      // Vérifier le JWT
      const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
      
      // Vérifier que la session existe en base
      const session = await Session.findByToken(sessionToken);
      
      if (!session || !session.isActive()) {
        await AuditLog.logEvent('session_validation_failed', {
          sessionToken,
          hwid,
          ipAddress: ip,
          message: 'Session invalide ou expirée',
          severity: 'warning'
        });
        
        return res.json({
          valid: false,
          reason: 'session_invalid'
        });
      }
      
      // Vérifier que le HWID correspond
      if (session.hwid !== hwid) {
        await AuditLog.logEvent('session_validation_failed', {
          sessionToken,
          hwid,
          ipAddress: ip,
          message: 'HWID ne correspond pas à la session',
          severity: 'critical'
        });
        
        return res.json({
          valid: false,
          reason: 'hwid_mismatch'
        });
      }
      
      // Mettre à jour l'activité de la session
      await session.updateActivity(ip);
      
      await AuditLog.logEvent('session_validated', {
        sessionToken,
        hwid,
        ipAddress: ip,
        message: 'Session validée avec succès',
        severity: 'info'
      });
      
      res.json({
        valid: true,
        expiresAt: session.expiresAt.toISOString(),
        lastActivity: session.lastActivity.toISOString()
      });
      
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.json({
          valid: false,
          reason: 'token_invalid'
        });
      }
      
      logger.error('Erreur lors de la vérification de session:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        reason: 'server_error'
      });
    }
  }
);

// Route: Déconnexion (révocation de session)
router.post('/logout',
  verifySession,
  async (req, res) => {
    try {
      const session = req.session;
      
      // Révoquer la session
      await session.revoke();
      
      await AuditLog.logEvent('session_revoked', {
        sessionToken: session.sessionToken,
        hwid: session.hwid,
        ipAddress: req.ip,
        message: 'Session révoquée par l\'utilisateur',
        severity: 'info'
      });
      
      logger.info('Session révoquée', {
        sessionToken: session.sessionToken.substring(0, 16) + '...',
        hwid: session.hwid.substring(0, 8) + '...'
      });
      
      res.json({
        success: true,
        message: 'Déconnexion réussie'
      });
      
    } catch (error) {
      logger.error('Erreur lors de la déconnexion:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
      });
    }
  }
);

module.exports = router;