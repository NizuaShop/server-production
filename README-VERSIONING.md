# 🚀 Système de Versioning Automatique GitHub

Ce système surveille automatiquement votre repository GitHub et crée de nouvelles versions à chaque commit.

## 📋 Configuration

### 1. Variables d'environnement

Ajoutez ces variables à votre `.env` :

```bash
GITHUB_REPO_OWNER=votre-username
GITHUB_REPO_NAME=votre-repo-name
```

### 2. Token GitHub

Créez un token GitHub avec les permissions `repo` et exécutez :

```bash
node scripts/init-github-token.js ghp_votre_token_github
```

## 🔄 Fonctionnement

### Vérification Automatique
- Le système vérifie les nouveaux commits **toutes les 5 minutes**
- Chaque nouveau commit déclenche une nouvelle version
- Une release GitHub est automatiquement créée

### Types de Versions

Le système détermine automatiquement le type de version basé sur le message du commit :

#### 🔴 **MAJOR** (v1.0.0 → v2.0.0)
Mots-clés : `BREAKING CHANGE`, `major:`, `breaking:`
```bash
git commit -m "BREAKING CHANGE: Nouvelle API incompatible"
git commit -m "major: Refonte complète de l'interface"
```

#### 🟡 **MINOR** (v1.0.0 → v1.1.0)
Mots-clés : `feat:`, `feature:`, `minor:`
```bash
git commit -m "feat: Ajout du système de notifications"
git commit -m "feature: Nouveau panneau d'administration"
```

#### 🟢 **PATCH** (v1.0.0 → v1.0.1)
Mots-clés : `fix:`, `patch:`, `bugfix:`, `hotfix:`
```bash
git commit -m "fix: Correction du bug de connexion"
git commit -m "hotfix: Réparation critique de sécurité"
```

### Format des Messages de Commit

Pour de meilleures notes de version, utilisez ce format :

```bash
git commit -m "feat: Ajout du système de mise à jour automatique

- Surveillance automatique des commits GitHub
- Création automatique des releases
- Interface d'administration pour la gestion des versions
- Notifications de mise à jour dans l'application"
```

## 🎛️ Gestion Manuelle

### API Admin

#### Modifier la version manuellement
```bash
POST /api/version/set
Authorization: X-Admin-API-Key: your-admin-key

{
  "version": "v2.1.0",
  "notes": "Version mise à jour manuellement"
}
```

#### Configurer le versioning automatique
```bash
POST /api/version/config
Authorization: X-Admin-API-Key: your-admin-key

{
  "autoIncrementType": "patch",
  "keywords": {
    "major": ["BREAKING CHANGE", "major:", "breaking:"],
    "minor": ["feat:", "feature:", "minor:"],
    "patch": ["fix:", "patch:", "bugfix:", "hotfix:"]
  }
}
```

#### Forcer la vérification des commits
```bash
POST /api/version/check-commits
Authorization: X-Admin-API-Key: your-admin-key
```

### API Publique

#### Obtenir la version actuelle
```bash
GET /api/version/current
```

#### Obtenir l'historique des versions
```bash
GET /api/version/history?limit=10
```

## 📱 Interface Client

Le client vérifie automatiquement les mises à jour et affiche une popup quand une nouvelle version est disponible.

### Fonctionnalités Client
- ✅ Vérification automatique toutes les 30 minutes
- ✅ Popup de notification avec détails de la version
- ✅ Affichage du numéro de build
- ✅ Liste des changements
- ✅ Téléchargement sécurisé via proxy

## 🔧 Dépannage

### Le système ne détecte pas les commits
1. Vérifiez que le token GitHub est valide
2. Vérifiez les variables `GITHUB_REPO_OWNER` et `GITHUB_REPO_NAME`
3. Consultez les logs du serveur

### Les versions ne s'incrémentent pas correctement
1. Vérifiez le format de vos messages de commit
2. Utilisez les mots-clés appropriés (`feat:`, `fix:`, etc.)
3. Configurez les mots-clés via l'API admin si nécessaire

### Réinitialiser le système
```bash
# Supprimer toutes les données de version
db.app_version.deleteMany({})

# Le système se réinitialisera automatiquement à v1.0.0
```

## 📊 Monitoring

Surveillez les logs pour :
- `🆕 Nouvelle version créée` - Nouveau commit détecté
- `🏷️ Release GitHub créée` - Release automatique créée
- `🔄 Vérification périodique des commits démarrée` - Service démarré

## 🚀 Déploiement

Le système fonctionne automatiquement sur Render. Assurez-vous que :
1. Les variables d'environnement sont configurées
2. Le token GitHub est initialisé
3. Le service démarre sans erreur

---

**Note :** Ce système est conçu pour fonctionner en continu. Chaque commit sur votre repository déclenchera automatiquement une nouvelle version !