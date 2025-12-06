/**
 * Fichier utilitaire contenant les fonctions communes
 * à tous les scripts de l'application
 */

// Configuration de base de l'API
window.API_BASE = 'https://localhost:3001/api';

/**
 * Affiche un message temporaire à l'utilisateur
 * @param {string} message - Le message à afficher
 * @param {string} type - Le type de message ('info', 'success', 'error', 'warning')
 */
window.showMessage = function(message, type = 'info') {
  const container = document.getElementById('message-container');
  if (!container) {
    console.error('Container de messages introuvable');
    return;
  }

  container.innerHTML = '';
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = message;
  container.appendChild(messageDiv);

  setTimeout(() => {
    messageDiv.remove();
  }, 5000);
};

/**
 * Fonction pour échapper les caractères HTML spéciaux
 * Utilisée pour prévenir les injections XSS
 * @param {string} text - Le texte à échapper
 * @returns {string} Le texte échappé
 */
window.escapeHtml = function(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};
