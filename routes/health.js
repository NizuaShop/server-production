const express = require('express');
const database = require('../config/database');
const License = require('../models/License');
const Session = require('../models/Session');

const router = express.Router();

// Route de santé générale
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Vérifier la connexion à la base de données
    const dbHealth = await database.healthCheck();
    
    // Vérifier que nous pouvons faire des requêtes simples
    const [licenseCount, sessionCount] = await Promise.all([
      Promise.race([
        License.countDocuments(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]),
      Promise.race([
        Session.countDocuments(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ])
    ]);
    
    const responseTime = Date.now() - startTime;
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      server: 'Nizua License Server',
      version: '1.0.0',
      uptime: process.uptime(),
      responseTime: `${responseTime}ms`,
      deployment: {
        platform: 'Render',
        environment: process.env.NODE_ENV || 'development',
        url: process.env.RENDER_EXTERNAL_URL || 'localhost'
      },
      database: dbHealth,
      stats: {
        licenses: licenseCount,
        sessions: sessionCount
      },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      }
    };
    
    res.json(health);
    
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      uptime: process.uptime()
    });
  }
});

// Route de santé simple (pour les load balancers)
router.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Route de santé de la base de données
router.get('/database', async (req, res) => {
  try {
    const dbHealth = await database.healthCheck();
    
    if (dbHealth.connected) {
      res.json({
        status: 'healthy',
        database: dbHealth
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        database: dbHealth
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message
    });
  }
});

module.exports = router;