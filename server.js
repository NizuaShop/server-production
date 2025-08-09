require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const database = require('./config/database');
const logger = require('./config/logger');

// Sécurité
const {
  corsOptions,
  generalLimiter,
  helmetConfig,
  requestLogger
} = require('./middleware/security');

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const healthRoutes = require('./routes/health');
const updateRoutes = require('./routes/updates');
const versionRoutes = require('./routes/version');
const logsRoutes = require('./routes/logs');

// Modèles (pour initialiser Mongoose)
require('./models/License');
require('./models/Session');
require('./models/AuditLog');
require('./models/UpdateToken');
require('./models/AppVersion');
require('./models/LogEntry');

const GitHubVersionService = require('./services/GitHubVersionService');
let versionService = null;

// Fonction d'initialisation
async function initializeServer() {
  try {
    await database.connect();

    if (!versionService) {
      versionService = new GitHubVersionService();
      await versionService.initialize();
    }

    logger.info('✅ Serveur initialisé avec succès');
  } catch (error) {
    logger.error('❌ Erreur lors de l\'initialisation du serveur:', error);
    throw error;
  }
}

async function startServer() {
  await initializeServer();

  const app = express();

  app.set('trust proxy', 1);
  app.use(cors(corsOptions));
  app.use(helmetConfig);
  app.use(generalLimiter);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb', strict: true }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(requestLogger);

  // Headers de sécurité supplémentaires
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // Routes
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
      }
    });
  });

  app.use('/health', healthRoutes);
  app.use('/api', authRoutes);
  app.use('/api/logs', logsRoutes);
  app.use('/api/updates', updateRoutes);
  app.use('/api/version', versionRoutes);
  app.use('/api/admin', adminRoutes);

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.use('/api/*', (req, res) => {
    logger.warn('Route API non trouvée', {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    res.status(404).json({ success: false, error: 'Endpoint non trouvé' });
  });

  app.use((error, req, res, next) => {
    logger.error('Erreur non gérée:', {
      error: error.message,
      stack: error.stack
    });
    const isDevelopment = process.env.NODE_ENV === 'development';
    res.status(error.status || 500).json({
      success: false,
      error: 'Erreur interne du serveur',
      message: isDevelopment ? error.message : 'Une erreur inattendue s\'est produite',
      ...(isDevelopment && { stack: error.stack })
    });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Serveur Nizua License démarré sur le port ${PORT}`);
  });
}

// Lancer le serveur seulement si le fichier est exécuté directement
if (require.main === module) {
  startServer().catch(err => {
    console.error('❌ Impossible de démarrer le serveur :', err);
    process.exit(1);
  });
}
