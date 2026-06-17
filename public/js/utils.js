/**
 * Fichier utilitaire contenant les fonctions communes
 * à tous les scripts de l'application
 */

// Configuration de base de l'API
// Basée sur l'origine courante : fonctionne en localhost comme via une IP/domaine distant
window.API_BASE = `${window.location.origin}/api`;

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
  // Échappe &, <, >, " et ' — sûr en contenu d'élément ET en valeur d'attribut.
  // (& doit être traité en premier.) Round-trip correct via dataset/textContent.
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};
