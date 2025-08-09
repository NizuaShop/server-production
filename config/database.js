const mongoose = require('mongoose');
const logger = require('./logger');
require('dotenv').config();

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nizua_licenses';
      
      const options = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000
      };

      this.connection = await mongoose.connect(mongoUri, options);
      
      logger.info('✅ Connexion MongoDB établie', {
        host: this.connection.connection.host,
        port: this.connection.connection.port,
        database: this.connection.connection.name
      });

      // Gestion des événements de connexion
      mongoose.connection.on('error', (error) => {
        logger.error('❌ Erreur MongoDB:', error);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('⚠️ MongoDB déconnecté');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('🔄 MongoDB reconnecté');
      });

      return this.connection;
    } catch (error) {
      logger.error('❌ Erreur de connexion MongoDB:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.disconnect();
        logger.info('🔌 Connexion MongoDB fermée');
      }
    } catch (error) {
      logger.error('❌ Erreur lors de la fermeture MongoDB:', error);
      throw error;
    }
  }

  async healthCheck() {
    try {
      const state = mongoose.connection.readyState;
      const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };

      return {
        status: states[state] || 'unknown',
        connected: state === 1,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        database: mongoose.connection.name
      };
    } catch (error) {
      return {
        status: 'error',
        connected: false,
        error: error.message
      };
    }
  }
}

module.exports = new Database();