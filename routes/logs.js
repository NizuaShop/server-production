const express = require('express');
const router = express.Router();
const LogEntry = require('../models/LogEntry');
const logger = require('../config/logger');

// Middleware de validation pour les logs
const validateLogEntry = (req, res, next) => {
  const { source, hwid, timestamp, error_message, error_type, module, version, os_info } = req.body;
  
  // Vérification des champs requis
  if (!source || !hwid || !timestamp || !error_message || !error_type || !module || !version || !os_info) {
    return res.status(400).json({
      success: false,
      error: 'Champs requis manquants',
      message: 'Les champs source, hwid, timestamp, error_message, error_type, module, version et os_info sont obligatoires'
    });
  }
  
  // Vérification de la structure os_info
  if (!os_info.name || !os_info.version) {
    return res.status(400).json({
      success: false,
      error: 'Structure os_info invalide',
      message: 'os_info doit contenir les champs name et version'
    });
  }
  
  // Validation du timestamp
  const parsedTimestamp = new Date(timestamp);
  if (isNaN(parsedTimestamp.getTime())) {
    return res.status(400).json({
      success: false,
      error: 'Format timestamp invalide',
      message: 'Le timestamp doit être au format ISO 8601'
    });
  }
  
  // Validation de la longueur des champs
  if (error_message.length > 2000) {
    return res.status(400).json({
      success: false,
      error: 'Message d\'erreur trop long',
      message: 'Le message d\'erreur ne peut pas dépasser 2000 caractères'
    });
  }
  
  if (module.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Nom de module trop long',
      message: 'Le nom du module ne peut pas dépasser 100 caractères'
    });
  }
  
  if (version.length > 20) {
    return res.status(400).json({
      success: false,
      error: 'Version trop longue',
      message: 'La version ne peut pas dépasser 20 caractères'
    });
  }
  
  next();
};

// Middleware de limitation de taux pour les logs (optionnel)
const logRateLimit = (req, res, next) => {
  // Vous pouvez implémenter une limitation de taux ici si nécessaire
  // Par exemple, limiter le nombre de logs par HWID par minute
  next();
};

// POST /api/logs - Créer une nouvelle entrée de log
router.post('/', validateLogEntry, logRateLimit, async (req, res) => {
  try {
    const {
      source,
      hwid,
      timestamp,
      error_message,
      error_type,
      module,
      version,
      os_info,
      extra_data = {}
    } = req.body;
    
    // Créer une nouvelle entrée de log
    const logEntry = new LogEntry({
      source,
      hwid,
      timestamp: new Date(timestamp),
      error_message,
      error_type,
      module,
      version,
      os_info,
      extra_data,
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.get('User-Agent')
    });
    
    // Sauvegarder dans la base de données
    await logEntry.save();
    
    // Log côté serveur pour le suivi
    logger.info('Nouvelle entrée de log reçue', {
      hwid: hwid.substring(0, 8) + '...',
      error_type,
      module,
      source,
      ip: req.ip
    });
    
    // Réponse de succès
    res.status(201).json({
      success: true,
      message: 'Log enregistré avec succès',
      log_id: logEntry._id
    });
    
  } catch (error) {
    // Log l'erreur côté serveur
    logger.error('Erreur lors de l\'enregistrement du log', {
      error: error.message,
      stack: error.stack,
      body: req.body,
      ip: req.ip
    });
    
    // Réponse d'erreur
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Erreur de validation',
        message: error.message,
        details: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur',
      message: 'Impossible d\'enregistrer le log'
    });
  }
});

// GET /api/logs/stats/:hwid - Obtenir les statistiques de logs pour un HWID
router.get('/stats/:hwid', async (req, res) => {
  try {
    const { hwid } = req.params;
    const hours = parseInt(req.query.hours) || 24;
    
    if (hours > 168) { // Limiter à 7 jours maximum
      return res.status(400).json({
        success: false,
        error: 'Période trop longue',
        message: 'La période ne peut pas dépasser 168 heures (7 jours)'
      });
    }
    
    const stats = await LogEntry.getLogStats(hwid, hours);
    
    res.json({
      success: true,
      hwid,
      period_hours: hours,
      stats
    });
    
  } catch (error) {
    logger.error('Erreur lors de la récupération des statistiques', {
      error: error.message,
      hwid: req.params.hwid,
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      error: 'Erreur interne du serveur',
      message: 'Impossible de récupérer les statistiques'
    });
  }
});

// GET /api/logs/health - Endpoint de santé pour les logs
router.get('/health', async (req, res) => {
  try {
    // Vérifier la connectivité à la base de données
    const recentLogsCount = await LogEntry.countDocuments({
      created_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    res.json({
      success: true,
      status: 'healthy',
      recent_logs_24h: recentLogsCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Erreur lors du check de santé des logs', {
      error: error.message,
      ip: req.ip
    });
    
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: 'Problème de connectivité à la base de données'
    });
  }
});

module.exports = router;