const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  // Token de session (JWT ou UUID)
  sessionToken: {
    type: String,
    required: true
  },
  
  // Clé de licence associée
  licenseKey: {
    type: String,
    required: true,
    ref: 'License'
  },
  
  // HWID de la session
  hwid: {
    type: String,
    required: true
  },
  
  // Date de création
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  // Date d'expiration
  expiresAt: {
    type: Date,
    required: true
  },
  
  // Statut de la session
  status: {
    type: String,
    enum: ['active', 'expired', 'revoked'],
    default: 'active'
  },
  
  // Dernière activité
  lastActivity: {
    type: Date,
    default: Date.now
  },
  
  // IP de création
  createdIP: {
    type: String,
    required: true
  },
  
  // Dernière IP utilisée
  lastIP: {
    type: String
  },
  
  // User Agent
  userAgent: {
    type: String
  },
  
  // Métadonnées de la session
  metadata: {
    // Version de l'application cliente
    clientVersion: String,
    
    // Informations système
    systemInfo: {
      platform: String,
      arch: String,
      version: String
    }
  }
}, {
  timestamps: true,
  collection: 'sessions'
});

// Index pour optimiser les recherches
sessionSchema.index({ sessionToken: 1 });
sessionSchema.index({ hwid: 1 });
sessionSchema.index({ licenseKey: 1 });
sessionSchema.index({ expiresAt: 1 });
sessionSchema.index({ status: 1 });

// Méthodes du modèle
sessionSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

sessionSchema.methods.isActive = function() {
  return this.status === 'active' && !this.isExpired();
};

sessionSchema.methods.updateActivity = function(ip = null) {
  this.lastActivity = new Date();
  if (ip) this.lastIP = ip;
  return this.save();
};

sessionSchema.methods.revoke = function() {
  this.status = 'revoked';
  return this.save();
};

// Méthodes statiques
sessionSchema.statics.findByToken = function(token) {
  return this.findOne({ sessionToken: token });
};

sessionSchema.statics.findActiveByHWID = function(hwid) {
  return this.find({ 
    hwid: hwid, 
    status: 'active', 
    expiresAt: { $gt: new Date() } 
  });
};

sessionSchema.statics.cleanupExpired = function() {
  return this.deleteMany({ 
    $or: [
      { expiresAt: { $lt: new Date() } },
      { status: 'expired' }
    ]
  });
};

module.exports = mongoose.model('Session', sessionSchema);