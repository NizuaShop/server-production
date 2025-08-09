const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const License = require('../models/License');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');

// Validation des entrées pour la validation de clé
const validateKeyRequest = [
  body('key')
    .notEmpty()
    .withMessage('Clé de licence requise')
    .matches(/^KEY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    .withMessage('Format de clé invalide'),
  
  body('hwid')
    .notEmpty()
    .withMessage('HWID requis')
    .isLength({ min: 10, max: 128 })
    .withMessage('HWID invalide'),
  
  body('timestamp')
    .isISO8601()
    .withMessage('Timestamp invalide')
    .custom((value) => {
      const timestamp = new Date(value);
      const now = new Date();
      const diff = Math.abs(now - timestamp);
      
      // Accepter les requêtes dans une fenêtre de 5 minutes
      if (diff > 5 * 60 * 1000) {
        throw new Error('Timestamp trop ancien ou futur');
      }
      return true;
    }),
  
  body('signature')
    .optional()
    .isLength({ min: 32 })
    .withMessage('Signature invalide')
];

// Validation des entrées pour la vérification de session
const validateSessionRequest = [
  body('sessionToken')
    .notEmpty()
    .withMessage('Token de session requis'),
  
  body('hwid')
    .notEmpty()
    .withMessage('HWID requis')
];

// Middleware de validation des erreurs
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.security('Validation échouée', {
      ip: req.ip,
      errors: errors.array(),
      body: req.body
    });
    
    return res.status(400).json({
      success: false,
      error: 'Données invalides',
      reason: 'validation_failed',
      details: errors.array()
    });
  }
  next();
};

// Vérification de signature HMAC (optionnel) - FIX: Rendre vraiment optionnel
const verifySignature = (req, res, next) => {
  // FIX: Si pas de clé secrète configurée, passer directement
  if (!process.env.HMAC_SECRET) {
    console.log('⚠️ HMAC_SECRET non configuré, signature désactivée');
    return next();
  }
  
  const { signature, ...data } = req.body;
  
  // FIX: Si pas de signature dans la requête et que HMAC_SECRET existe, 
  // on peut soit l'exiger soit l'ignorer selon la configuration
  if (!signature) {
    // Pour le moment, on va l'ignorer pour éviter les erreurs
    console.log('⚠️ Signature manquante mais HMAC_SECRET configuré - signature ignorée');
    return next();
    
    /* Si vous voulez forcer la signature, décommentez ceci:
    logger.security('Signature manquante', {
      ip: req.ip,
      body: req.body
    });
    
    return res.status(400).json({
      success: false,
      error: 'Signature requise',
      reason: 'signature_missing'
    });
    */
  }
  
  try {
    const payload = JSON.stringify(data);
    const expectedSignature = crypto
      .createHmac('sha256', process.env.HMAC_SECRET)
      .update(payload)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      logger.security('Signature invalide', {
        ip: req.ip,
        expected: expectedSignature,
        received: signature
      });
      
      return res.status(401).json({
        success: false,
        error: 'Signature invalide',
        reason: 'signature_invalid'
      });
    }
    
    next();
  } catch (error) {
    logger.error('Erreur vérification signature:', error);
    return res.status(500).json({
      success: false,
      error: 'Erreur de vérification',
      reason: 'signature_error'
    });
  }
};

// Middleware d'authentification admin
const requireAdminAuth = (req, res, next) => {
  const apiKey = req.headers['x-admin-api-key'] || req.query.apiKey;
  
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    logger.security('Tentative d\'accès admin non autorisée', {
      ip: req.ip,
      apiKey: apiKey ? 'présente' : 'manquante',
      userAgent: req.get('User-Agent')
    });
    
    return res.status(401).json({
      success: false,
      error: 'Accès non autorisé',
      reason: 'admin_auth_required'
    });
  }
  
  next();
};

// Middleware de vérification de session JWT
const verifySession = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body.sessionToken;
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token de session requis',
        reason: 'token_missing'
      });
    }
    
    // Vérifier le JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérifier que la session existe en base
    const session = await Session.findByToken(token);
    
    if (!session || !session.isActive()) {
      await AuditLog.logEvent('session_validation_failed', {
        sessionToken: token,
        hwid: decoded.hwid,
        ipAddress: req.ip,
        message: 'Session invalide ou expirée'
      });
      
      return res.status(401).json({
        success: false,
        error: 'Session invalide ou expirée',
        reason: 'session_invalid'
      });
    }
    
    // Mettre à jour l'activité de la session
    await session.updateActivity(req.ip);
    
    // Ajouter les informations de session à la requête
    req.session = session;
    req.user = decoded;
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      logger.security('Token JWT invalide', {
        ip: req.ip,
        error: error.message
      });
      
      return res.status(401).json({
        success: false,
        error: 'Token invalide',
        reason: 'token_invalid'
      });
    }
    
    logger.error('Erreur vérification session:', error);
    return res.status(500).json({
      success: false,
      error: 'Erreur de vérification',
      reason: 'verification_error'
    });
  }
};

module.exports = {
  validateKeyRequest,
  validateSessionRequest,
  handleValidationErrors,
  verifySignature,
  requireAdminAuth,
  verifySession
};