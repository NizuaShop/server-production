const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('../config/logger');
const AuditLog = require('../models/AuditLog');

// Configuration CORS pour Render - autoriser toutes les origines
const corsOptions = {
  origin: function (origin, callback) {
    // Pour Render, autoriser toutes les origines par défaut
    if (process.env.ALLOWED_ORIGINS === '*' || process.env.NODE_ENV === 'production') {
      return callback(null, true);
    }
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
    
    // Permettre les requêtes sans origin (applications Electron)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.security('Origine CORS non autorisée', {
        origin,
        allowedOrigins
      });
      callback(new Error('Non autorisé par CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-API-Key']
};

// Rate limiting pour la validation de clés - plus permissif pour Render
const keyValidationLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1 heure
  max: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 100, // Encore plus permissif pour Render
  // Configuration spéciale pour Render avec trust proxy
  trustProxy: true,
  keyGenerator: (req) => {
    // Utiliser l'IP forwarded par Render ou fallback sur l'IP de connexion
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  message: {
    success: false,
    error: 'Trop de tentatives de validation',
    reason: 'rate_limit_exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting pour certaines IPs si nécessaire
    if (process.env.ALLOWED_IPS === '*') {
      return false; // Ne pas skip, appliquer le rate limiting normal
    }
    return false;
  },
  handler: async (req, res) => {
    logger.security('Rate limit dépassé pour validation de clé', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      body: req.body
    });
    
    try {
      await AuditLog.logEvent('rate_limit_exceeded', {
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        message: 'Limite de tentatives de validation dépassée',
        severity: 'warning',
        details: {
          endpoint: '/api/validate-key',
          limit: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 50,
          window: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000
        }
      });
    } catch (error) {
      logger.error('Erreur lors de l\'audit log:', error);
    }
    
    res.status(429).json({
      success: false,
      error: 'Trop de tentatives de validation',
      reason: 'rate_limit_exceeded',
      retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000) / 1000)
    });
  }
});

// Rate limiting général - plus permissif pour Render
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Très permissif pour Render
  trustProxy: true,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  message: {
    success: false,
    error: 'Trop de requêtes',
    reason: 'rate_limit_exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip pour les health checks
    if (req.path.startsWith('/health')) {
      return true;
    }
    return false;
  }
});

// Rate limiting pour l'API admin
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Augmenté pour Render
  trustProxy: true,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  message: {
    success: false,
    error: 'Trop de requêtes admin',
    reason: 'admin_rate_limit_exceeded'
  }
});

// Middleware de détection d'activité suspecte - adapté pour Render
const detectSuspiciousActivity = async (req, res, next) => {
  try {
    // Skip en production pour éviter les faux positifs sur Render
    if (process.env.NODE_ENV === 'production' && process.env.ALLOWED_IPS === '*') {
      return next();
    }
    
    const ip = req.ip;
    const userAgent = req.get('User-Agent');
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Vérifier les tentatives récentes de cette IP
    const recentAttempts = await AuditLog.find({
      ipAddress: ip,
      timestamp: { $gte: oneHourAgo },
      eventType: { $in: ['key_validation_failed', 'session_validation_failed'] }
    }).countDocuments();
    
    // Seuil plus élevé pour Render (50 au lieu de 20)
    if (recentAttempts > 50) {
      logger.security('Activité suspecte détectée', {
        ip,
        userAgent,
        recentAttempts,
        endpoint: req.path
      });
      
      await AuditLog.logEvent('suspicious_activity', {
        ipAddress: ip,
        userAgent,
        message: `Activité suspecte: ${recentAttempts} échecs en 1 heure`,
        severity: 'critical',
        details: {
          recentAttempts,
          endpoint: req.path,
          timeWindow: '1 hour'
        }
      });
      
      // En production, juste logger sans bloquer
      if (process.env.NODE_ENV === 'production') {
        logger.warn('Activité suspecte détectée mais non bloquée (production)', {
          ip,
          recentAttempts
        });
        return next();
      }
      
      return res.status(429).json({
        success: false,
        error: 'Activité suspecte détectée',
        reason: 'suspicious_activity',
        message: 'Votre IP a été temporairement bloquée en raison d\'une activité suspecte'
      });
    }
    
    next();
  } catch (error) {
    logger.error('Erreur détection activité suspecte:', error);
    next(); // Continuer même en cas d'erreur
  }
};

// Configuration Helmet pour la sécurité - adaptée pour Render
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"], // Permettre les connexions HTTPS
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  crossOriginEmbedderPolicy: false // Désactiver pour éviter les problèmes sur Render
});

// Middleware de logging des requêtes - optimisé pour Render
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    };
    
    // Réduire les logs en production pour les health checks
    if (process.env.NODE_ENV === 'production' && req.path.startsWith('/health')) {
      return; // Ne pas logger les health checks en production
    }
    
    if (res.statusCode >= 400) {
      logger.warn('Requête échouée', logData);
    } else {
      logger.info('Requête traitée', logData);
    }
  });
  
  next();
};

module.exports = {
  corsOptions,
  keyValidationLimiter,
  generalLimiter,
  adminLimiter,
  detectSuspiciousActivity,
  helmetConfig,
  requestLogger
};