const express = require('express');
const AppVersion = require('../models/AppVersion');
const logger = require('../config/logger');
const { requireAdminAuth } = require('../middleware/auth');

const router = express.Router();

// Route publique: Obtenir la version actuelle
router.get('/current', async (req, res) => {
  try {
    const versionDoc = await AppVersion.getCurrentVersion();
    
    if (!versionDoc) {
      return res.json({
        success: true,
        version: 'v1.0.0',
        buildNumber: 1
      });
    }

    res.json({
      success: true,
      version: versionDoc.version,
      buildNumber: versionDoc.buildNumber,
      lastCommit: versionDoc.lastCommit,
      updatedAt: versionDoc.updatedAt,
      sha256: versionDoc.latestReleaseAssetSha256,
      size: versionDoc.latestReleaseAssetSize
    });

  } catch (error) {
    logger.error('Erreur récupération version:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération de la version'
    });
  }
});

// Route publique: Obtenir l'historique des versions
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const versionDoc = await AppVersion.getCurrentVersion();
    
    if (!versionDoc) {
      return res.json({
        success: true,
        history: []
      });
    }

    const history = versionDoc.versionHistory
      .slice(-limit)
      .reverse(); // Plus récent en premier

    res.json({
      success: true,
      history,
      currentVersion: versionDoc.version,
      totalVersions: versionDoc.versionHistory.length
    });

  } catch (error) {
    logger.error('Erreur récupération historique:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération de l\'historique'
    });
  }
});

// Route admin: Modifier manuellement la version
router.post('/set', requireAdminAuth, async (req, res) => {
  try {
    const { version, notes } = req.body;
    
    if (!version) {
      return res.status(400).json({
        success: false,
        error: 'Version requise'
      });
    }

    // Valider le format de version (vX.X.X)
    if (!/^v\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({
        success: false,
        error: 'Format de version invalide (attendu: vX.X.X)'
      });
    }

    let versionDoc = await AppVersion.getCurrentVersion();
    
    if (!versionDoc) {
      versionDoc = new AppVersion({
        _id: 'current_version'
      });
    }

    const oldVersion = versionDoc.version;
    versionDoc.version = version;
    versionDoc.buildNumber += 1;
    
    // Ajouter à l'historique
    versionDoc.addToHistory({
      sha: 'manual-' + Date.now(),
      message: notes || `Version mise à jour manuellement vers ${version}`
    });

    await versionDoc.save();

    logger.info('Version mise à jour manuellement', {
      oldVersion,
      newVersion: version,
      admin_ip: req.ip,
      notes
    });

    res.json({
      success: true,
      message: 'Version mise à jour avec succès',
      oldVersion,
      newVersion: version,
      buildNumber: versionDoc.buildNumber
    });

  } catch (error) {
    logger.error('Erreur mise à jour version:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la mise à jour de la version'
    });
  }
});

// Route admin: Configurer le versioning automatique
router.post('/config', requireAdminAuth, async (req, res) => {
  try {
    const { autoIncrementType, keywords } = req.body;
    
    let versionDoc = await AppVersion.getCurrentVersion();
    
    if (!versionDoc) {
      versionDoc = new AppVersion({
        _id: 'current_version'
      });
    }

    if (autoIncrementType) {
      versionDoc.versionConfig.autoIncrementType = autoIncrementType;
    }

    if (keywords) {
      if (keywords.major) versionDoc.versionConfig.keywords.major = keywords.major;
      if (keywords.minor) versionDoc.versionConfig.keywords.minor = keywords.minor;
      if (keywords.patch) versionDoc.versionConfig.keywords.patch = keywords.patch;
    }

    await versionDoc.save();

    logger.info('Configuration versioning mise à jour', {
      autoIncrementType,
      keywords,
      admin_ip: req.ip
    });

    res.json({
      success: true,
      message: 'Configuration mise à jour avec succès',
      config: versionDoc.versionConfig
    });

  } catch (error) {
    logger.error('Erreur mise à jour config:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la mise à jour de la configuration'
    });
  }
});

// Route admin: Forcer la vérification des commits
router.post('/check-commits', requireAdminAuth, async (req, res) => {
  try {
    const GitHubVersionService = require('../services/GitHubVersionService');
    const versionService = new GitHubVersionService();
    
    await versionService.checkForNewCommits();
    
    res.json({
      success: true,
      message: 'Vérification des commits lancée'
    });

  } catch (error) {
    logger.error('Erreur vérification commits:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification des commits'
    });
  }
});

module.exports = router;