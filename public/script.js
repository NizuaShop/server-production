// Variables globales
let autoRefreshInterval = null;
let isAutoRefreshActive = false;

// Fonction principale pour vérifier le statut
async function checkStatus() {
    const startTime = Date.now();
    
    // Mettre à jour l'interface en mode "vérification"
    updateStatusUI('checking', 'Vérification en cours...', null, startTime);
    
    try {
        // Appel à l'endpoint de santé
        const response = await fetch('/health', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
        
        const responseTime = Date.now() - startTime;
        
        if (response.ok) {
            const data = await response.json();
            updateStatusUI('online', 'Serveur en ligne', data, startTime, responseTime);
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
    } catch (error) {
        console.error('Erreur lors de la vérification du statut:', error);
        const responseTime = Date.now() - startTime;
        updateStatusUI('offline', 'Serveur hors ligne', null, startTime, responseTime, error.message);
    }
}

// Fonction pour mettre à jour l'interface utilisateur
function updateStatusUI(status, statusText, data, startTime, responseTime = null, errorMessage = null) {
    const statusIndicator = document.getElementById('statusIndicator');
    const statusTextElement = document.getElementById('statusText');
    const serverStatus = document.getElementById('serverStatus');
    const lastCheck = document.getElementById('lastCheck');
    const responseTimeElement = document.getElementById('responseTime');
    const dbStatus = document.getElementById('dbStatus');
    const serverVersion = document.getElementById('serverVersion');
    const environment = document.getElementById('environment');
    const uptime = document.getElementById('uptime');
    
    // Mettre à jour l'indicateur de statut
    statusIndicator.className = `status-indicator ${status}`;
    statusTextElement.textContent = statusText;
    
    // Mettre à jour l'heure de la dernière vérification
    lastCheck.textContent = new Date().toLocaleString('fr-FR');
    
    // Mettre à jour le temps de réponse
    if (responseTime !== null) {
        responseTimeElement.textContent = `${responseTime}ms`;
        responseTimeElement.style.color = responseTime < 1000 ? '#28a745' : responseTime < 3000 ? '#ffc107' : '#dc3545';
    }
    
    if (status === 'online' && data) {
        // Serveur en ligne - afficher les données
        serverStatus.textContent = 'En ligne';
        serverStatus.style.color = '#28a745';
        
        // Base de données
        if (data.database && data.database.connected) {
            dbStatus.textContent = 'Connectée';
            dbStatus.style.color = '#28a745';
        } else {
            dbStatus.textContent = 'Déconnectée';
            dbStatus.style.color = '#dc3545';
        }
        
        // Informations système
        serverVersion.textContent = data.version || '1.0.0';
        environment.textContent = data.deployment?.environment || 'production';
        
        if (data.uptime) {
            const uptimeSeconds = Math.floor(data.uptime);
            const hours = Math.floor(uptimeSeconds / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const seconds = uptimeSeconds % 60;
            uptime.textContent = `${hours}h ${minutes}m ${seconds}s`;
        } else {
            uptime.textContent = 'Serverless';
        }
        
    } else if (status === 'offline') {
        // Serveur hors ligne
        serverStatus.textContent = 'Hors ligne';
        serverStatus.style.color = '#dc3545';
        
        dbStatus.textContent = 'Inconnu';
        dbStatus.style.color = '#6c757d';
        
        serverVersion.textContent = 'Inconnu';
        environment.textContent = 'Inconnu';
        uptime.textContent = 'Inconnu';
        
        if (errorMessage) {
            console.error('Détails de l\'erreur:', errorMessage);
        }
        
    } else if (status === 'checking') {
        // En cours de vérification
        serverStatus.textContent = 'Vérification...';
        serverStatus.style.color = '#ffc107';
        
        responseTimeElement.textContent = '-';
        responseTimeElement.style.color = '#6c757d';
    }
}

// Fonction pour basculer l'actualisation automatique
function toggleAutoRefresh() {
    const button = document.querySelector('button[onclick="toggleAutoRefresh()"]');
    const buttonText = document.getElementById('autoRefreshText');
    
    if (isAutoRefreshActive) {
        // Arrêter l'actualisation automatique
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        isAutoRefreshActive = false;
        
        buttonText.textContent = '▶️ Activer l\'actualisation auto';
        button.classList.remove('active');
        
        console.log('Actualisation automatique désactivée');
    } else {
        // Démarrer l'actualisation automatique (toutes les 30 secondes)
        autoRefreshInterval = setInterval(checkStatus, 30000);
        isAutoRefreshActive = true;
        
        buttonText.textContent = '⏸️ Désactiver l\'actualisation auto';
        button.classList.add('active');
        
        console.log('Actualisation automatique activée (30s)');
    }
}

// Fonction pour formater la date
function formatDate(date) {
    return new Intl.DateTimeFormat('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(date);
}

// Gestion des erreurs réseau
window.addEventListener('online', () => {
    console.log('Connexion réseau rétablie');
    checkStatus();
});

window.addEventListener('offline', () => {
    console.log('Connexion réseau perdue');
    updateStatusUI('offline', 'Pas de connexion réseau', null, Date.now(), null, 'Connexion réseau indisponible');
});

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
    console.log('Page de statut Nizua License Server chargée');
    
    // Vérifier le statut immédiatement
    checkStatus();

    document.getElementById('checkStatusBtn').addEventListener('click', checkStatus);
    document.getElementById('autoRefreshBtn').addEventListener('click', toggleAutoRefresh);
    
    // Ajouter des gestionnaires d'événements pour les raccourcis clavier
    document.addEventListener('keydown', (event) => {
        if (event.key === 'F5' || (event.ctrlKey && event.key === 'r')) {
            event.preventDefault();
            checkStatus();
        }
        
        if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            checkStatus();
        }
        
        if (event.key === 'a' || event.key === 'A') {
            toggleAutoRefresh();
        }
    });
    
    // Vérifier périodiquement si la page est visible
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isAutoRefreshActive) {
            // La page redevient visible et l'auto-refresh est actif
            checkStatus();
        }
    });
    
    // Afficher les raccourcis clavier dans la console
    console.log('Raccourcis clavier disponibles:');
    console.log('- F5 ou Ctrl+R : Actualiser le statut');
    console.log('- Espace : Actualiser le statut');
    console.log('- A : Basculer l\'actualisation automatique');
});

// Gestion des erreurs JavaScript globales
window.addEventListener('error', (event) => {
    console.error('Erreur JavaScript:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Promesse rejetée non gérée:', event.reason);
});

// Export des fonctions pour les tests (si nécessaire)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkStatus,
        toggleAutoRefresh,
        updateStatusUI
    };
}