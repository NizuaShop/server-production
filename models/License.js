const mongoose = require('mongoose');

const licenseSchema = new mongoose.Schema({
  // Clé de licence (format: KEY-XXXX-XXXX-XXXX-XXXX)
  key: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    match: /^KEY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
  },
  
  // HWID lié à cette clé (null si jamais utilisé)
  hwid: {
    type: String,
    default: null,
    trim: true
  },
  
  // Indique si la clé a été utilisée/liée à un HWID
  used: {
    type: Boolean,
    default: false
  },
  
  // Date de création de la clé
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  // Date d'expiration de la clé
  expiresAt: {
    type: Date,
    required: true
  },
  
  // Statut de la clé
  status: {
    type: String,
    enum: ['active', 'expired', 'banned', 'suspended'],
    default: 'active'
  },
  
  // Nombre de tentatives d'utilisation (pour anti-abus)
  attempts: {
    type: Number,
    default: 0
  },
  
  // Dernière tentative d'utilisation
  lastAttempt: {
    type: Date,
    default: null
  },
  
  // Date du dernier reset des tentatives
  lastAttemptsReset: {
    type: Date,
    default: Date.now
  },
  
  // IP de la dernière tentative
  lastIP: {
    type: String,
    default: null
  },
  
  // Type de licence (basic, premium, etc.)
  licenseType: {
    type: String,
    enum: ['demo', 'basic', 'premium', 'enterprise'],
    default: 'basic'
  },
  
  // Fonctionnalités autorisées
  features: [{
    type: String,
    enum: ['lobby_manager', 'controller', 'anti_afk', 'movement', 'premium_features']
  }],
  
  // Métadonnées supplémentaires
  metadata: {
    // Source de la clé (manual, generated, purchased, etc.)
    source: {
      type: String,
      default: 'manual'
    },
    
    // Notes administratives
    notes: {
      type: String,
      default: ''
    },
    
    // ID de commande ou transaction (si applicable)
    orderId: {
      type: String,
      default: null
    }
  }
}, {
  timestamps: true,
  collection: 'licenses'
});

// Index pour optimiser les recherches
licenseSchema.index({ key: 1 });
licenseSchema.index({ hwid: 1 });
licenseSchema.index({ status: 1 });
licenseSchema.index({ expiresAt: 1 });

// Méthodes du modèle
licenseSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

licenseSchema.methods.isActive = function() {
  return this.status === 'active' && !this.isExpired();
};

licenseSchema.methods.canBeUsed = function() {
  return this.isActive() && (!this.used || this.hwid);
};

licenseSchema.methods.bindToHWID = function(hwid) {
  this.hwid = hwid;
  this.used = true;
  this.lastAttempt = new Date();
  return this.save();
};

// Méthode pour vérifier si les tentatives doivent être reset (quotidiennement)
licenseSchema.methods.shouldResetAttempts = function() {
  const now = new Date();
  const lastReset = this.lastAttemptsReset || this.createdAt;
  const daysSinceReset = Math.floor((now - lastReset) / (1000 * 60 * 60 * 24));
  return daysSinceReset >= 1;
};

// Méthode pour reset les tentatives
licenseSchema.methods.resetAttempts = function() {
  this.attempts = 0;
  this.lastAttemptsReset = new Date();
  return this.save();
};

// Méthode pour incrémenter les tentatives avec gestion du reset quotidien
licenseSchema.methods.incrementAttempts = function(ip = null, fromStoredKey = false) {
  // Si la clé vient du fichier stocké, ne pas incrémenter les tentatives
  if (fromStoredKey) {
    console.log('🔑 Validation depuis clé stockée - tentatives non incrémentées');
    this.lastAttempt = new Date();
    if (ip) this.lastIP = ip;
    return this.save();
  }
  
  // Vérifier si on doit reset les tentatives (quotidiennement)
  if (this.shouldResetAttempts()) {
    console.log('🔄 Reset quotidien des tentatives pour la clé:', this.key.substring(0, 8) + '...');
    this.attempts = 0;
    this.lastAttemptsReset = new Date();
  }
  
  this.attempts += 1;
  this.lastAttempt = new Date();
  if (ip) this.lastIP = ip;
  
  console.log(`📊 Tentatives pour ${this.key.substring(0, 8)}...: ${this.attempts}`);
  
  return this.save();
};

// Méthodes statiques
licenseSchema.statics.generateKey = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = [];
  
  for (let i = 0; i < 4; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }
  
  return `KEY-${segments.join('-')}`;
};

licenseSchema.statics.findByKey = function(key) {
  return this.findOne({ key: key.toUpperCase().trim() });
};

licenseSchema.statics.findByHWID = function(hwid) {
  return this.findOne({ hwid: hwid.trim() });
};

licenseSchema.statics.getActiveCount = function() {
  return this.countDocuments({ status: 'active', expiresAt: { $gt: new Date() } });
};

module.exports = mongoose.model('License', licenseSchema);