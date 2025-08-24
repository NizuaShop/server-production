const mongoose = require('mongoose');

const appVersionSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'current_version'
  },
  
  // Version actuelle (format: v1.0.0)
  version: {
    type: String,
    required: true,
    default: 'v1.0.0'
  },
  
  // Numéro de build (incrémenté à chaque commit)
  buildNumber: {
    type: Number,
    default: 1
  },
  
  // SHA du dernier commit traité
  lastCommitSha: {
    type: String,
    default: null
  },
  
  // Informations du dernier commit
  lastCommit: {
    message: String,
    author: String,
    date: Date,
    url: String
  },
  
  // Informations de l'asset de la dernière release
  latestReleaseAssetSha256: {
    type: String,
    default: null
  },
  
  latestReleaseAssetSize: {
    type: Number,
    default: 0
  },
  
  // Historique des versions
  versionHistory: [{
    version: String,
    buildNumber: Number,
    commitSha: String,
    commitMessage: String,
    createdAt: {
      type: Date,
      default: Date.now
    },
    changes: [String] // Liste des changements
  }],
  
  // Configuration de versioning
  versionConfig: {
    // Auto-increment: patch, minor, major
    autoIncrementType: {
      type: String,
      enum: ['patch', 'minor', 'major'],
      default: 'patch'
    },
    
    // Mots-clés dans les commits pour déclencher des types de versions
    keywords: {
      major: {
        type: [String],
        default: ['BREAKING CHANGE', 'major:', 'breaking:']
      },
      minor: {
        type: [String],
        default: ['feat:', 'feature:', 'minor:']
      },
      patch: {
        type: [String],
        default: ['fix:', 'patch:', 'bugfix:', 'hotfix:']
      }
    }
  }
}, {
  timestamps: true,
  collection: 'app_version'
});

// Méthodes du modèle
appVersionSchema.methods.incrementVersion = function(type = 'patch') {
  const versionParts = this.version.replace('v', '').split('.').map(Number);
  let [major, minor, patch] = versionParts;
  
  switch (type) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      break;
    case 'patch':
    default:
      patch += 1;
      break;
  }
  
  this.version = `v${major}.${minor}.${patch}`;
  this.buildNumber += 1;
  
  return this.version;
};

appVersionSchema.methods.addToHistory = function(commitData) {
  this.versionHistory.push({
    version: this.version,
    buildNumber: this.buildNumber,
    commitSha: commitData.sha,
    commitMessage: commitData.message,
    changes: this.parseChangesFromCommit(commitData.message)
  });
  
  // Garder seulement les 50 dernières versions
  if (this.versionHistory.length > 50) {
    this.versionHistory = this.versionHistory.slice(-50);
  }
};

appVersionSchema.methods.parseChangesFromCommit = function(commitMessage) {
  const changes = [];
  const lines = commitMessage.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      changes.push(trimmed.substring(2));
    } else if (trimmed.startsWith('feat:') || trimmed.startsWith('fix:') || trimmed.startsWith('add:')) {
      changes.push(trimmed);
    }
  }
  
  return changes.length > 0 ? changes : [commitMessage.split('\n')[0]];
};

appVersionSchema.methods.determineVersionType = function(commitMessage) {
  const message = commitMessage.toLowerCase();
  
  // Vérifier les mots-clés pour major
  for (const keyword of this.versionConfig.keywords.major) {
    if (message.includes(keyword.toLowerCase())) {
      return 'major';
    }
  }
  
  // Vérifier les mots-clés pour minor
  for (const keyword of this.versionConfig.keywords.minor) {
    if (message.includes(keyword.toLowerCase())) {
      return 'minor';
    }
  }
  
  // Vérifier les mots-clés pour patch
  for (const keyword of this.versionConfig.keywords.patch) {
    if (message.includes(keyword.toLowerCase())) {
      return 'patch';
    }
  }
  
  // Par défaut, utiliser le type configuré
  return this.versionConfig.autoIncrementType;
};

// Méthodes statiques
appVersionSchema.statics.getCurrentVersion = function() {
  return this.findById('current_version');
};

appVersionSchema.statics.initializeVersion = async function() {
  const existing = await this.findById('current_version');
  
  if (!existing) {
    const version = new this({
      _id: 'current_version',
      version: 'v1.0.0',
      buildNumber: 1
    });
    await version.save();
    console.log('✅ Version initiale créée: v1.0.0');
    return version;
  }
  
  return existing;
};

module.exports = mongoose.model('AppVersion', appVersionSchema);