require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const database = require('./config/database');
const logger = require('./config/logger');
const cors = require('cors');
const path = require('path');

// Import des middlewares de sécurité
const {
  corsOptions,
  generalLimiter,
  helmetConfig,
  requestLogger
} = require('./middleware/security');

// Import des routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const healthRoutes = require('./routes/health');
const updateRoutes = require('./routes/updates');
const versionRoutes = require('./routes/version');
const logsRoutes = require('./routes/logs');

// Import des modèles pour s'assurer qu'ils sont chargés
require('./models/License');
require('./models/Session');
require('./models/AuditLog');
require('./models/UpdateToken');
require('./models/AppVersion');
require('./models/LogEntry');
const GitHubVersionService = require('./services/GitHubVersionService');

// Instance globale du service de versioning
let versionService = null;

// Fonction d'initialisation
async function initializeServer() {
  try {
    // Connexion à la base de données
    await database.connect();
    
    // Initialiser le service de versioning
    if (!versionService) {
      versionService = new GitHubVersionService();
      await versionService.initialize();
    }
    
    logger.info('✅ Serveur initialisé avec succès pour Vercel');
    
  } catch (error) {
    logger.error('❌ Erreur lors de l\'initialisation du serveur:', error);
    throw error;
  }
}

// Créer l'application Express
const app = express();

// Configuration trust proxy pour Vercel
app.set('trust proxy', 1);

// Configuration des middlewares de sécurité
app.use(cors(corsOptions));
app.use(helmetConfig);
app.use(generalLimiter);
app.disable('x-powered-by');

// Parsing JSON avec limite de taille
app.use(express.json({ 
  limit: '10mb',
  strict: true
}));

// Parsing URL-encoded
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Logging des requêtes
app.use(requestLogger);

// Middleware pour ajouter des headers de sécurité supplémentaires
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Headers spécifiques pour Vercel
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  
  next();
});

// Servir les fichiers statiques depuis le dossier public
app.use(express.static(path.join(__dirname, 'public')));

// Route de base avec informations sur l'environnement
app.get('/api', (req, res) => {
  res.json({
    name: 'Nizua License Server',
    version: '1.0.0',
    status: 'running',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api',
      admin: '/api/admin',
      updates: '/api/updates',
      health: '/health'
    },
    deployment: {
      platform: 'Vercel',
      cors: process.env.ALLOWED_ORIGINS === '*' ? 'All origins allowed' : 'Restricted origins',
      rateLimit: {
        keyValidation: process.env.RATE_LIMIT_MAX_ATTEMPTS || 50,
        general: 500
      }
    }
  });
});

// Routes de santé (AVANT les autres routes pour éviter les middlewares)
app.use('/health', healthRoutes);

// Routes d'authentification
app.use('/api', authRoutes);

// Routes des logs d'application
app.use('/api/logs', logsRoutes);

// Routes des mises à jour
app.use('/api/updates', updateRoutes);

// Routes de version
app.use('/api/version', versionRoutes);

// Routes d'administration
app.use('/api/admin', adminRoutes);

// Route pour servir la page d'accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route 404 pour les endpoints API non trouvés
app.use('/api/*', (req, res) => {
  logger.warn('Route API non trouvée', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  res.status(404).json({
    success: false,
    error: 'Endpoint non trouvé',
    message: 'L\'endpoint demandé n\'existe pas',
    availableEndpoints: [
      'GET /api',
      'GET /health',
      'POST /api/validate-key',
      'POST /api/check-session',
      'GET /api/updates/check',
      'POST /api/logs',
      'GET /api/logs/health',
      'GET /api/logs/stats/:hwid'
    ]
  });
});

// Gestionnaire d'erreurs global
app.use((error, req, res, next) => {
  logger.error('Erreur non gérée:', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Ne pas exposer les détails de l'erreur en production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    success: false,
    error: 'Erreur interne du serveur',
    message: isDevelopment ? error.message : 'Une erreur inattendue s\'est produite',
    ...(isDevelopment && { stack: error.stack })
  });
});

// Gestion des promesses rejetées non gérées
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Promesse rejetée non gérée:', {
    reason: reason,
    promise: promise
  });
});
const PORT = process.env.PORT || 3000;

// Si le fichier est exécuté directement (Render / local), on lance le serveur
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur Nizua License démarré sur le port ${PORT}`);
  });
}