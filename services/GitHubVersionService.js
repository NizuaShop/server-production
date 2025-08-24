const https = require('https');
const AppVersion = require('../models/AppVersion');
const UpdateToken = require('../models/UpdateToken');
const logger = require('../config/logger');

class GitHubVersionService {
  constructor() {
    this.repoOwner = process.env.GITHUB_REPO_OWNER;
    this.repoName = process.env.GITHUB_REPO_NAME;
    this.checkInterval = null;
  }

  async initialize() {
    try {
      // Initialiser la version si elle n'existe pas
      await AppVersion.initializeVersion();
      
      // Démarrer la vérification périodique (toutes les 5 minutes)
      this.startPeriodicCheck();
      
      logger.info('✅ Service de versioning GitHub initialisé');
    } catch (error) {
      logger.error('❌ Erreur initialisation service versioning:', error);
    }
  }

  startPeriodicCheck() {
    // Vérifier immédiatement
    this.checkForNewCommits();
    
    // Puis toutes les 5 minutes
    this.checkInterval = setInterval(() => {
      this.checkForNewCommits();
    }, 5 * 60 * 1000);
    
    logger.info('🔄 Vérification périodique des commits démarrée (5 min)');
  }

  async checkForNewCommits() {
    try {
      if (!this.repoOwner || !this.repoName) {
        return;
      }

      const tokenDoc = await UpdateToken.getGitHubToken();
      if (!tokenDoc || !tokenDoc.isActive()) {
        return;
      }

      const currentVersion = await AppVersion.getCurrentVersion();
      if (!currentVersion) {
        return;
      }

      // Récupérer les commits récents
      const commits = await this.fetchRecentCommits(tokenDoc.token);
      
      if (!commits || commits.length === 0) {
        return;
      }

      // Vérifier s'il y a de nouveaux commits
      const latestCommit = commits[0];
      
      if (currentVersion.lastCommitSha === latestCommit.sha) {
        // Pas de nouveaux commits
        return;
      }

      // Traiter les nouveaux commits
      const newCommits = [];
      for (const commit of commits) {
        if (commit.sha === currentVersion.lastCommitSha) {
          break;
        }
        newCommits.push(commit);
      }

      if (newCommits.length > 0) {
        await this.processNewCommits(currentVersion, newCommits.reverse(), tokenDoc);
      }

    } catch (error) {
      logger.error('❌ Erreur vérification commits:', error);
    }
  }

  async processNewCommits(currentVersion, newCommits, tokenDoc) {
    try {
      let versionChanged = false;
      
      for (const commit of newCommits) {
        // Déterminer le type de version basé sur le message du commit
        const versionType = currentVersion.determineVersionType(commit.commit.message);
        
        // Incrémenter la version
        const oldVersion = currentVersion.version;
        currentVersion.incrementVersion(versionType);
        
        // Mettre à jour les informations du commit
        currentVersion.lastCommitSha = commit.sha;
        currentVersion.lastCommit = {
          message: commit.commit.message,
          author: commit.commit.author.name,
          date: new Date(commit.commit.author.date),
          url: commit.html_url
        };
        
        // Ajouter à l'historique
        currentVersion.addToHistory({
          sha: commit.sha,
          message: commit.commit.message
        });
        
        logger.info('🆕 Nouvelle version créée', {
          oldVersion,
          newVersion: currentVersion.version,
          versionType,
          commitSha: commit.sha.substring(0, 7),
          commitMessage: commit.commit.message.split('\n')[0]
        });
        
        versionChanged = true;
      }
      
      if (versionChanged) {
        await currentVersion.save();
        
        // Récupérer les informations de la dernière release (créée par GitHub Action)
        await this.updateReleaseAssetInfo(currentVersion, tokenDoc.token);
      }
      
    } catch (error) {
      logger.error('❌ Erreur traitement commits:', error);
    }
  }

  async createGitHubRelease(versionDoc) {
    try {
      const tokenDoc = await UpdateToken.getGitHubToken();
      if (!tokenDoc || !tokenDoc.isActive()) {
        return;
      }

      const releaseData = {
        tag_name: versionDoc.version,
        name: `${versionDoc.version} - Build ${versionDoc.buildNumber}`,
        body: this.generateReleaseNotes(versionDoc),
        draft: false,
        prerelease: false
      };

      const success = await this.createRelease(tokenDoc.token, releaseData);
      
      if (success) {
        logger.info('🏷️ Release GitHub créée', {
          version: versionDoc.version,
          buildNumber: versionDoc.buildNumber
        });
      }

    } catch (error) {
      logger.error('❌ Erreur création release:', error);
    }
  }

  generateReleaseNotes(versionDoc) {
    const latestVersion = versionDoc.versionHistory[versionDoc.versionHistory.length - 1];
    
    if (!latestVersion || !latestVersion.changes || latestVersion.changes.length === 0) {
      return `## Version ${versionDoc.version}\n\n${versionDoc.lastCommit.message}`;
    }

    let notes = `## Version ${versionDoc.version} - Build ${versionDoc.buildNumber}\n\n`;
    notes += `### Changements:\n\n`;
    
    for (const change of latestVersion.changes) {
      notes += `- ${change}\n`;
    }
    
    notes += `\n### Informations du commit:\n`;
    notes += `- **Auteur:** ${versionDoc.lastCommit.author}\n`;
    notes += `- **Date:** ${versionDoc.lastCommit.date.toISOString()}\n`;
    notes += `- **SHA:** ${versionDoc.lastCommitSha.substring(0, 7)}\n`;
    
    return notes;
  }

  async fetchRecentCommits(token, limit = 10) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repoOwner}/${this.repoName}/commits?per_page=${limit}`,
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'Nizua-Version-Service',
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
              const commits = JSON.parse(data);
              resolve(commits);
            } else {
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

  async createRelease(token, releaseData) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(releaseData);
      
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repoOwner}/${this.repoName}/releases`,
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'Nizua-Version-Service',
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 201) {
            resolve(true);
          } else {
            logger.warn('Erreur création release GitHub:', {
              status: res.statusCode,
              response: data
            });
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        logger.error('Erreur requête GitHub:', error);
        resolve(false);
      });

      req.setTimeout(15000, () => {
        req.destroy();
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  }

  async updateReleaseAssetInfo(versionDoc, token) {
    try {
      // Récupérer les détails de la release avec le tag "latest"
      const latestRelease = await this._fetchLatestReleaseDetails(token);
      
      if (!latestRelease) {
        logger.warn('Aucune release "latest" trouvée');
        return;
      }

      // Extraire le SHA256 du corps de la release
      const sha256Match = latestRelease.body.match(/SHA256:\s*([a-fA-F0-9]{64})/);
      if (sha256Match) {
        versionDoc.latestReleaseAssetSha256 = sha256Match[1];
        logger.info('SHA256 extrait de la release:', sha256Match[1]);
      } else {
        logger.warn('SHA256 non trouvé dans le corps de la release');
      }

      // Trouver l'asset Nizua-Loader.zip et récupérer sa taille
      const zipAsset = latestRelease.assets.find(asset => 
        asset.name === 'Nizua-Loader.zip'
      );
      
      if (zipAsset) {
        versionDoc.latestReleaseAssetSize = zipAsset.size;
        logger.info('Taille de l\'asset ZIP:', zipAsset.size, 'bytes');
      } else {
        logger.warn('Asset Nizua-Loader.zip non trouvé dans la release');
      }

      // Sauvegarder les informations mises à jour
      await versionDoc.save();
      
      logger.info('Informations de release mises à jour', {
        version: versionDoc.version,
        sha256: versionDoc.latestReleaseAssetSha256,
        size: versionDoc.latestReleaseAssetSize
      });

    } catch (error) {
      logger.error('❌ Erreur mise à jour informations release:', error);
    }
  }

  async _fetchLatestReleaseDetails(token) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repoOwner}/${this.repoName}/releases/tags/latest`,
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'Nizua-Version-Service',
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
            } else {
              logger.warn(`Release "latest" non trouvée: ${res.statusCode}`);
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

  async getCurrentVersion() {
    try {
      const versionDoc = await AppVersion.getCurrentVersion();
      return versionDoc ? versionDoc.version : 'v1.0.0';
    } catch (error) {
      return 'v1.0.0';
    }
  }

  async getVersionInfo() {
    try {
      const versionDoc = await AppVersion.getCurrentVersion();
      if (!versionDoc) {
        return null;
      }

      return {
        version: versionDoc.version,
        buildNumber: versionDoc.buildNumber,
        lastCommit: versionDoc.lastCommit,
        lastCommitSha: versionDoc.lastCommitSha,
        history: versionDoc.versionHistory.slice(-10) // 10 dernières versions
      };
    } catch (error) {
      logger.error('Erreur récupération info version:', error);
      return null;
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('🛑 Vérification périodique des commits arrêtée');
    }
  }
}

module.exports = GitHubVersionService;