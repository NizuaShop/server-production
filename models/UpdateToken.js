const mongoose = require('mongoose');

const updateTokenSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true
  },
  
  type: {
    type: String,
    required: true,
    enum: ['access_token', 'api_key']
  },
  
  service: {
    type: String,
    required: true,
    enum: ['github', 'gitlab', 'bitbucket']
  },
  
  token: {
    type: String,
    required: true
  },
  
  scopes: [{
    type: String
  }],
  
  note: {
    type: String,
    default: ''
  },
  
  metadata: {
    active: {
      type: Boolean,
      default: true
    },
    usageCount: {
      type: Number,
      default: 0
    },
    lastUsed: {
      type: Date,
      default: null
    },
    expiresAt: {
      type: Date,
      default: null
    }
  }
}, {
  timestamps: true,
  collection: 'update_tokens'
});

// Méthodes du modèle
updateTokenSchema.methods.incrementUsage = function() {
  this.metadata.usageCount += 1;
  this.metadata.lastUsed = new Date();
  return this.save();
};

updateTokenSchema.methods.isActive = function() {
  if (!this.metadata.active) return false;
  if (this.metadata.expiresAt && new Date() > this.metadata.expiresAt) return false;
  return true;
};

// Méthodes statiques
updateTokenSchema.statics.getGitHubToken = function() {
  return this.findOne({ 
    _id: 'github_token',
    service: 'github',
    'metadata.active': true
  });
};

module.exports = mongoose.model('UpdateToken', updateTokenSchema);