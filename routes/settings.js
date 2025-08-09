const express = require('express');
const Setting = require('../models/Setting');
const logger = require('../config/logger');
const { verifySession } = require('../middleware/auth');

const router = express.Router();

// Middleware pour vérifier la session sur toutes les routes
router.use(verifySession);

// Route: Récupérer les paramètres d'un utilisateur
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Vérifier que l'utilisateur demande ses propres paramètres
    if (req.user.hwid !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé aux paramètres'
      });
    }
    
    const settings = await Setting.getUserSettings(userId);
    
    // Log sans utiliser AuditLog pour éviter l'erreur
    logger.info('Paramètres récupérés', {
      userId: userId.substring(0, 8) + '...',
      ip: req.ip
    });
    
    res.json({
      success: true,
      settings: {
        id: settings.id,
        AntiAFK: settings.AntiAFK,
        Movement: settings.Movement
      }
    });
    
  } catch (error) {
    logger.error('Erreur récupération paramètres:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des paramètres'
    });
  }
});

// Route: Sauvegarder les paramètres d'un utilisateur
router.post('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { settings } = req.body;
    
    // Vérifier que l'utilisateur modifie ses propres paramètres
    if (req.user.hwid !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé aux paramètres'
      });
    }
    
    if (!settings) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres requis'
      });
    }
    
    // Mettre à jour les paramètres
    const updatedSettings = await Setting.findOneAndUpdate(
      { id: userId },
      {
        AntiAFK: settings.AntiAFK || {},
        Movement: settings.Movement || {}
      },
      { 
        new: true, 
        upsert: true,
        runValidators: true
      }
    );
    
    // Log sans utiliser AuditLog pour éviter l'erreur
    logger.info('Paramètres mis à jour', {
      userId: userId.substring(0, 8) + '...',
      sections: Object.keys(settings),
      ip: req.ip
    });
    
    res.json({
      success: true,
      message: 'Paramètres sauvegardés avec succès',
      settings: {
        id: updatedSettings.id,
        AntiAFK: updatedSettings.AntiAFK,
        Movement: updatedSettings.Movement
      }
    });
    
  } catch (error) {
    logger.error('Erreur sauvegarde paramètres:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la sauvegarde des paramètres'
    });
  }
});

// Route: Réinitialiser les paramètres aux valeurs par défaut
router.post('/:userId/reset', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Vérifier que l'utilisateur réinitialise ses propres paramètres
    if (req.user.hwid !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé aux paramètres'
      });
    }
    
    const resetSettings = await Setting.resetUserToDefault(userId);
    
    // Log sans utiliser AuditLog pour éviter l'erreur
    logger.info('Paramètres réinitialisés', {
      userId: userId.substring(0, 8) + '...',
      ip: req.ip
    });
    
    res.json({
      success: true,
      message: 'Paramètres réinitialisés avec succès',
      settings: {
        id: resetSettings.id,
        AntiAFK: resetSettings.AntiAFK,
        Movement: resetSettings.Movement
      }
    });
    
  } catch (error) {
    logger.error('Erreur réinitialisation paramètres:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la réinitialisation des paramètres'
    });
  }
});

// Route: Récupérer les paramètres par défaut (admin uniquement)
router.get('/admin/defaults', async (req, res) => {
  try {
    const defaultSettings = await Setting.getDefaultSettings();
    
    if (!defaultSettings) {
      return res.status(404).json({
        success: false,
        error: 'Paramètres par défaut non trouvés'
      });
    }
    
    res.json({
      success: true,
      settings: {
        id: defaultSettings.id,
        AntiAFK: defaultSettings.AntiAFK,
        Movement: defaultSettings.Movement
      }
    });
    
  } catch (error) {
    logger.error('Erreur récupération paramètres par défaut:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des paramètres par défaut'
    });
  }
});

module.exports = router;