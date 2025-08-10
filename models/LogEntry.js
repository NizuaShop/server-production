const mongoose = require('mongoose');

const osInfoSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  version: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const logEntrySchema = new mongoose.Schema({
  source: {
    type: String,
    required: true,
    trim: true,
    enum: ['client', 'server', 'system'],
    default: 'client'
  },
  hwid: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  error_message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  error_type: {
    type: String,
    required: true,
    trim: true,
    enum: [
      'validation_error',
      'network_error',
      'ui_error',
      'critical_error',
      'server_error',
      'authentication_error',
      'authorization_error',
      'database_error',
      'file_system_error',
      'configuration_error',
      'timeout_error',
      'parse_error',
      'unknown_error'
    ]
  },
  module: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  version: {
    type: String,
    required: true,
    trim: true,
    maxlength: 20
  },
  os_info: {
    type: osInfoSchema,
    required: true
  },
  extra_data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  ip_address: {
    type: String,
    trim: true
  },
  user_agent: {
    type: String,
    trim: true,
    maxlength: 500
  }
}, {
  timestamps: false, // We're using our own created_at field
  collection: 'error_logs'
});

// Index composé pour les requêtes fréquentes
logEntrySchema.index({ hwid: 1, created_at: -1 });
logEntrySchema.index({ error_type: 1, created_at: -1 });
logEntrySchema.index({ module: 1, created_at: -1 });

// Méthode statique pour nettoyer les anciens logs (optionnel)
logEntrySchema.statics.cleanOldLogs = function(daysToKeep = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  return this.deleteMany({
    created_at: { $lt: cutoffDate }
  });
};

// Méthode pour obtenir des statistiques de logs
logEntrySchema.statics.getLogStats = function(hwid, hours = 24) {
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - hours);

  return this.aggregate([
    {
      $match: {
        hwid: hwid,
        created_at: { $gte: cutoffDate }
      }
    },
    {
      $group: {
        _id: '$error_type',
        count: { $sum: 1 },
        latest: { $max: '$created_at' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

module.exports = mongoose.model('LogEntry', logEntrySchema);