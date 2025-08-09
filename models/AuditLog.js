const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Type d'événement
  eventType: {
    type: String,
    required: true,
    enum: [
      'key_validation_success',
      'key_validation_failed',
      'session_created',
      'session_validated',
      'session_expired',
      'session_revoked',
      'key_created',
      'key_banned',
      'suspicious_activity',
      'rate_limit_exceeded',
      'admin_action',
      'settings_retrieved',
      'settings_updated',
      'settings_reset'
    ]
  },
  
  // Clé de licence concernée (si applicable)
  licenseKey: {
    type: String,
    default: null
  },
  
  // HWID concerné (si applicable)
  hwid: {
    type: String,
    default: null
  },
  
  // Token de session (si applicable)
  sessionToken: {
    type: String,
    default: null
  },
  
  // Adresse IP
  ipAddress: {
    type: String,
    required: true
  },
  
  // User Agent
  userAgent: {
    type: String,
    default: null
  },
  
  // Détails de l'événement
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Message descriptif
  message: {
    type: String,
    required: true
  },
  
  // Niveau de sévérité
  severity: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    default: 'info'
  },
  
  // Timestamp
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'audit_logs',
  strict: false // Permet plus de flexibilité
});

// Index pour optimiser les recherches
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ eventType: 1 });
auditLogSchema.index({ licenseKey: 1 });
auditLogSchema.index({ hwid: 1 });
auditLogSchema.index({ ipAddress: 1 });
auditLogSchema.index({ severity: 1 });

// Méthodes statiques
auditLogSchema.statics.logEvent = function(eventType, data) {
  const log = new this({
    eventType,
    licenseKey: data.licenseKey || null,
    hwid: data.hwid || null,
    sessionToken: data.sessionToken || null,
    ipAddress: data.ipAddress || 'unknown',
    userAgent: data.userAgent || null,
    details: data.details || {},
    message: data.message || eventType,
    severity: data.severity || 'info'
  });
  
  return log.save();
};

auditLogSchema.statics.getRecentActivity = function(limit = 100) {
  return this.find()
    .sort({ timestamp: -1 })
    .limit(limit);
};

auditLogSchema.statics.getSuspiciousActivity = function(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return this.find({
    timestamp: { $gte: since },
    $or: [
      { eventType: 'suspicious_activity' },
      { eventType: 'rate_limit_exceeded' },
      { severity: 'critical' }
    ]
  }).sort({ timestamp: -1 });
};

// Supprimer le modèle existant s'il existe pour forcer la recompilation
if (mongoose.models.AuditLog) {
  delete mongoose.models.AuditLog;
}

module.exports = mongoose.model('AuditLog', auditLogSchema);