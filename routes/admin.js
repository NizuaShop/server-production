const express = require('express');
const License = require('../models/License');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');
const { requireAdminAuth } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/security');

const router = express.Router();

// Appliquer l'authentification admin et le rate limiting à toutes les routes
router.use(adminLimiter);
router.use(requireAdminAuth);

// Route: Créer une nouvelle clé de licence
router.post('/licenses', async (req, res) => {
  try {
    const {
      licenseType = 'basic',
      durationDays = 30,
      features = ['lobby_manager', 'controller'],
      notes = ''
    } = req.body;
    
    // Générer une nouvelle clé
    const key = License.generateKey();
    
    // Calculer la date d'expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    
    // Créer la licence
    const license = new License({
      key,
      expiresAt,
      licenseType,
      features,
      metadata: {
        source: 'admin_created',
        notes
      }
    });
    
    await license.save();
    
    await AuditLog.logEvent('key_created', {
      licenseKey: key,
      ipAddress: req.ip,
      message: 'Nouvelle clé créée par admin',
      severity: 'info',
      details: {
        licenseType,
        durationDays,
        features,
        expiresAt
      }
    });
    
    logger.info('Nouvelle clé créée', {
      key: key.substring(0, 8) + '...',
      licenseType,
      durationDays,
      admin_ip: req.ip
    });
    
    res.status(201).json({
      success: true,
      license: {
        key,
        licenseType,
        features,
        expiresAt: expiresAt.toISOString(),
        createdAt: license.createdAt.toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Erreur création de clé:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la création de la clé'
    });
  }
});

// Route: Lister toutes les licences avec pagination
router.get('/licenses', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status;
    const licenseType = req.query.type;
    
    const filter = {};
    if (status) filter.status = status;
    if (licenseType) filter.licenseType = licenseType;
    
    const skip = (page - 1) * limit;
    
    const [licenses, total] = await Promise.all([
      License.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v'),
      License.countDocuments(filter)
    ]);
    
    res.json({
      success: true,
      licenses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    logger.error('Erreur récupération licences:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des licences'
    });
  }
});

// Route: Obtenir les détails d'une licence
router.get('/licenses/:key', async (req, res) => {
  try {
    const { key } = req.params;
    
    const license = await License.findByKey(key);
    
    if (!license) {
      return res.status(404).json({
        success: false,
        error: 'Licence non trouvée'
      });
    }
    
    // Récupérer les sessions actives pour cette licence
    const activeSessions = await Session.find({
      licenseKey: key,
      status: 'active',
      expiresAt: { $gt: new Date() }
    }).select('createdAt expiresAt lastActivity createdIP lastIP');
    
    // Récupérer l'historique des événements
    const auditLogs = await AuditLog.find({
      licenseKey: key
    }).sort({ timestamp: -1 }).limit(20);
    
    res.json({
      success: true,
      license,
      activeSessions,
      auditLogs
    });
    
  } catch (error) {
    logger.error('Erreur récupération détails licence:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des détails'
    });
  }
});

// Route: Modifier le statut d'une licence
router.patch('/licenses/:key/status', async (req, res) => {
  try {
    const { key } = req.params;
    const { status, reason = '' } = req.body;
    
    if (!['active', 'banned', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Statut invalide'
      });
    }
    
    const license = await License.findByKey(key);
    
    if (!license) {
      return res.status(404).json({
        success: false,
        error: 'Licence non trouvée'
      });
    }
    
    const oldStatus = license.status;
    license.status = status;
    license.metadata.notes += `\n[${new Date().toISOString()}] Statut changé de ${oldStatus} à ${status}. Raison: ${reason}`;
    
    await license.save();
    
    // Si la licence est bannie ou suspendue, révoquer toutes les sessions actives
    if (status === 'banned' || status === 'suspended') {
      await Session.updateMany(
        { licenseKey: key, status: 'active' },
        { status: 'revoked' }
      );
    }
    
    await AuditLog.logEvent('admin_action', {
      licenseKey: key,
      ipAddress: req.ip,
      message: `Statut de licence changé: ${oldStatus} → ${status}`,
      severity: status === 'banned' ? 'critical' : 'warning',
      details: {
        oldStatus,
        newStatus: status,
        reason,
        admin: true
      }
    });
    
    logger.info('Statut de licence modifié', {
      key: key.substring(0, 8) + '...',
      oldStatus,
      newStatus: status,
      reason,
      admin_ip: req.ip
    });
    
    res.json({
      success: true,
      message: 'Statut mis à jour',
      license: {
        key,
        status,
        updatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Erreur modification statut:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la modification du statut'
    });
  }
});

// Route: Statistiques générales
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const [
      totalLicenses,
      activeLicenses,
      expiredLicenses,
      bannedLicenses,
      activeSessions,
      validationsToday,
      validationsWeek,
      suspiciousActivity
    ] = await Promise.all([
      License.countDocuments(),
      License.countDocuments({ status: 'active', expiresAt: { $gt: now } }),
      License.countDocuments({ expiresAt: { $lt: now } }),
      License.countDocuments({ status: 'banned' }),
      Session.countDocuments({ status: 'active', expiresAt: { $gt: now } }),
      AuditLog.countDocuments({
        eventType: 'key_validation_success',
        timestamp: { $gte: oneDayAgo }
      }),
      AuditLog.countDocuments({
        eventType: 'key_validation_success',
        timestamp: { $gte: oneWeekAgo }
      }),
      AuditLog.countDocuments({
        eventType: 'suspicious_activity',
        timestamp: { $gte: oneWeekAgo }
      })
    ]);
    
    res.json({
      success: true,
      stats: {
        licenses: {
          total: totalLicenses,
          active: activeLicenses,
          expired: expiredLicenses,
          banned: bannedLicenses
        },
        sessions: {
          active: activeSessions
        },
        validations: {
          today: validationsToday,
          week: validationsWeek
        },
        security: {
          suspiciousActivityWeek: suspiciousActivity
        }
      }
    });
    
  } catch (error) {
    logger.error('Erreur récupération statistiques:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques'
    });
  }
});

// Route: Logs d'audit récents
router.get('/audit-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const eventType = req.query.eventType;
    const severity = req.query.severity;
    
    const filter = {};
    if (eventType) filter.eventType = eventType;
    if (severity) filter.severity = severity;
    
    const skip = (page - 1) * limit;
    
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
      AuditLog.countDocuments(filter)
    ]);
    
    res.json({
      success: true,
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    logger.error('Erreur récupération logs:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des logs'
    });
  }
});

// Route: Nettoyage des sessions expirées
router.post('/cleanup', async (req, res) => {
  try {
    const result = await Session.cleanupExpired();
    
    await AuditLog.logEvent('admin_action', {
      ipAddress: req.ip,
      message: `Nettoyage des sessions expirées: ${result.deletedCount} sessions supprimées`,
      severity: 'info',
      details: {
        deletedCount: result.deletedCount,
        admin: true
      }
    });
    
    logger.info('Nettoyage des sessions expirées', {
      deletedCount: result.deletedCount,
      admin_ip: req.ip
    });
    
    res.json({
      success: true,
      message: 'Nettoyage effectué',
      deletedCount: result.deletedCount
    });
    
  } catch (error) {
    logger.error('Erreur nettoyage:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du nettoyage'
    });
  }
});

module.exports = router;