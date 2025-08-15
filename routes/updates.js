require('dotenv').config();

const express = require('express');
const https = require('https');
const UpdateToken = require('../models/UpdateToken');
const AppVersion = require('../models/AppVersion');
const logger = require('../config/logger');
const { verifySession } = require('../middleware/auth');

const router = express.Router();

// Middleware pour vérifier la session sur toutes les routes
router.use(verifySession);

// Route: Vérifier les mises à jour disponibles
router.get('/check', async (req, res) => {
  try {
    // Récupérer la version actuelle depuis la base de données
    const versionDoc = await AppVersion.getCurrentVersion();
    const serverVersion = versionDoc ? versionDoc.version : 'v1.0.0';
    const clientVersion = req.query.version || 'v1.0.0';
    
    logger.info('Vérification de mise à jour', {
      clientVersion,
      serverVersion,
      user: req.user.hwid.substring(0, 8) + '...'
    });
    
    // Récupérer le token GitHub depuis MongoDB
    const tokenDoc = await UpdateToken.getGitHubToken();
    
    if (!tokenDoc || !tokenDoc.isActive()) {
      logger.warn('Token non trouvé ou inactif');
      return res.json({
        success: true,
        hasUpdate: false,
        message: 'Service de mise à jour non configuré'
      });
    }
    
    const repoOwner = process.env.GITHUB_REPO_OWNER;
    const repoName = process.env.GITHUB_REPO_NAME;
    
    if (!repoOwner || !repoName) {
      logger.warn('Configuration GitHub repository manquante');
      return res.json({
        success: true,
        hasUpdate: false
      });
    }
    
    // Faire la requête à l'API GitHub
    const latestRelease = await fetchLatestRelease(tokenDoc.token, repoOwner, repoName);
    
    if (!latestRelease) {
      return res.json({
        success: true,
        hasUpdate: false,
        message: 'Aucune mise à jour disponible'
      });
    }
    
    // Comparer les versions
    const hasUpdate = compareVersions(clientVersion, serverVersion);
    
    // Incrémenter l'usage du token
    await tokenDoc.incrementUsage();
    
    logger.info('Vérification de mise à jour', {
      clientVersion,
      serverVersion,
      hasUpdate,
      user: req.user.hwid.substring(0, 8) + '...'
    });
    
    if (hasUpdate) {
      res.json({
        success: true,
        hasUpdate: true,
        update: {
          version: serverVersion,
          name: `${serverVersion} - Build ${versionDoc.buildNumber}`,
          description: versionDoc.lastCommit ? versionDoc.lastCommit.message : 'Nouvelle version disponible',
          publishedAt: versionDoc.updatedAt,
          downloadUrl: `/api/updates/download?version=${serverVersion}`,
          buildNumber: versionDoc.buildNumber,
          changes: versionDoc.versionHistory.length > 0 ? 
            versionDoc.versionHistory[versionDoc.versionHistory.length - 1].changes : []
        }
      });
    } else {
      res.json({
        success: true,
        hasUpdate: false,
        message: 'Application à jour'
      });
    }
    
  } catch (error) {
    logger.error('Erreur vérification mise à jour:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification des mises à jour',
      hasUpdate: false
    });
  }
});

// Route: Obtenir les informations de version détaillées
router.get('/version-info', async (req, res) => {
  try {
    const versionDoc = await AppVersion.getCurrentVersion();
    
    if (!versionDoc) {
      return res.json({
        success: true,
        version: 'v1.0.0',
        buildNumber: 1,
        history: []
      });
    }

    res.json({
      success: true,
      version: versionDoc.version,
      buildNumber: versionDoc.buildNumber,
      lastCommit: versionDoc.lastCommit,
      history: versionDoc.versionHistory.slice(-5).reverse(), // 5 dernières versions
      config: versionDoc.versionConfig
    });

  } catch (error) {
    logger.error('Erreur récupération info version:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des informations de version'
    });
  }
});

// Route: Télécharger une mise à jour (proxy sécurisé)
router.get('/download', async (req, res) => {
  try {
    const version = req.query.version;
    
    if (!version) {
      return res.status(400).json({
        success: false,
        error: 'Version requise'
      });
    }
    
    // Récupérer le token GitHub depuis MongoDB
    const tokenDoc = await UpdateToken.getGitHubToken();
    
    if (!tokenDoc || !tokenDoc.isActive()) {
      return res.status(503).json({
        success: false,
        error: 'Service de téléchargement indisponible'
      });
    }
    
    const repoOwner = process.env.GITHUB_REPO_OWNER;
    const repoName = process.env.GITHUB_REPO_NAME;
    
    // Récupérer les détails de la release
    const release = await fetchReleaseByTag(tokenDoc.token, repoOwner, repoName, version);
    
    if (!release || !release.assets || release.assets.length === 0) {
      logger.warn(`Release ou assets non trouvés pour la version ${version}`);
      if (release) {
        logger.info(`Release trouvée mais assets manquants:`, {
          version,
          assetsCount: release.assets ? release.assets.length : 0
        });
      }
      return res.status(404).json({
        success: false,
        error: 'Fichier de mise à jour non trouvé'
      });
    }
    
    // Log des assets trouvés pour vérification
    logger.info(`Assets trouvés pour la version ${version}:`, release.assets.map(a => ({
      name: a.name,
      size: a.size,
      download_url: a.browser_download_url
    })));
    
    // Trouver l'asset principal (exe ou zip)
    const asset = release.assets.find(asset => 
      asset.name.endsWith('.exe') || 
      asset.name.endsWith('.zip') ||
      asset.name.includes('setup') ||
      asset.name.includes('installer')
    );
    
    let downloadUrl;
    let filename;
    let useZipball = false;
    
    if (!asset) {
      // Si aucun asset spécifique n'est trouvé, utiliser le zipball_url
      if (release.zipball_url) {
        downloadUrl = release.zipball_url;
        filename = `Nizua_Loader-${release.tag_name}.zip`;
        useZipball = true;
        
        logger.info('Aucun asset spécifique trouvé, utilisation du zipball', {
          version,
          zipball_url: release.zipball_url,
          filename
        });
      } else {
        logger.warn(`Aucun asset compatible ni zipball trouvé pour la version ${version}`, {
          availableAssets: release.assets.map(a => a.name)
        });
        return res.status(404).json({
          success: false,
          error: 'Fichier d\'installation non trouvé'
        });
      }
    } else {
      downloadUrl = asset.browser_download_url;
      filename = asset.name;
      
      logger.warn(`Aucun asset compatible trouvé pour la version ${version}`, {
        availableAssets: release.assets.map(a => a.name)
      });
      logger.info('Asset spécifique trouvé', {
        version,
        asset: asset.name,
        size: asset.size,
        downloadUrl: asset.browser_download_url
      });
    }
    
    // Proxy le téléchargement
    logger.info('Téléchargement de mise à jour', {
      version,
      filename,
      downloadUrl,
      useZipball,
      size: asset ? asset.size : 'unknown',
      user: req.user.hwid.substring(0, 8) + '...'
    });
    
    // Préparer les options de requête selon le type de téléchargement
    let options;
    
    if (useZipball) {
      // Pour zipball_url, utiliser api.github.com
      const url = new URL(downloadUrl);
      options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'Authorization': `token ${tokenDoc.token}`,
          'User-Agent': 'Nizua-Loader-Updater',
          'Accept': 'application/vnd.github.v3+json'
        }
      };
    } else {
      // Pour les assets normaux, utiliser github.com
      options = {
        hostname: 'github.com',
        path: downloadUrl.replace('https://github.com', ''),
        headers: {
          'Authorization': `token ${tokenDoc.token}`,
          'User-Agent': 'Nizua-Loader-Updater'
        }
      };
    }
    
    logger.info('Proxy request options:', {
      hostname: options.hostname,
      path: options.path,
      hasToken: !!tokenDoc.token
    });
    
    const proxyReq = https.request(options, (proxyRes) => {
      logger.info(`Proxy response status: ${proxyRes.statusCode}`);
      
      // Copier les headers de réponse
      res.set({
        'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
        'Content-Length': proxyRes.headers['content-length'],
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      
      // Pipe la réponse
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (error) => {
      logger.error('Erreur proxy téléchargement:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du téléchargement'
      });
    });
    
    proxyReq.end();
    
    // Incrémenter l'usage du token
    await tokenDoc.incrementUsage();
    
  } catch (error) {
    logger.error('Erreur téléchargement mise à jour:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du téléchargement'
    });
  }
});

// Fonction pour récupérer la dernière release
function fetchLatestRelease(token, owner, repo) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases/latest`,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'Nizua-Loader-Updater',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const release = JSON.parse(data);
            resolve(release);
          } else if (res.statusCode === 404) {
            resolve(null); // Pas de release
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout GitHub API'));
    });
    
    req.end();
  });
}

// Fonction pour récupérer une release par tag
function fetchReleaseByTag(token, owner, repo, tag) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases/tags/${tag}`,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'Nizua-Loader-Updater',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Ajout de logs détaillés pour le débogage
          logger.info(`GitHub API Response Status for tag ${tag}: ${res.statusCode}`);
          logger.info(`GitHub API Response Body for tag ${tag}: ${data}`);
          
          if (res.statusCode === 200) {
            const release = JSON.parse(data);
            resolve(release);
          } else {
            // Si le statut n'est pas 200, nous voulons savoir pourquoi
            logger.error(`GitHub API returned status ${res.statusCode} for tag ${tag}. Response: ${data}`);
            resolve(null);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout GitHub API'));
    });
    
    req.end();
  });
}

// Fonction pour comparer les versions
function compareVersions(current, latest) {
  // Nettoyer les versions (enlever 'v' au début)
  const cleanCurrent = current.replace(/^v/, '');
  const cleanLatest = latest.replace(/^v/, '');
  
  const currentParts = cleanCurrent.split('.').map(Number);
  const latestParts = cleanLatest.split('.').map(Number);
  
  // Comparer chaque partie
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;
    
    if (latestPart > currentPart) {
      return true; // Mise à jour disponible
    } else if (latestPart < currentPart) {
      return false; // Version actuelle plus récente
    }
  }
  
  return false; // Versions identiques
}

module.exports = router;