// Vérifier l'authentification et récupérer l'utilisateur
// API_BASE est défini dans utils.js

async function checkAuth() {
  const API_BASE = window.API_BASE;
  try {
    const response = await fetchWithCsrf(`${API_BASE}/auth/me`, {
      credentials: 'include'
    });

    if (!response.ok) {
      // Non authentifié, rediriger vers login
      window.location.href = '/login';
      return null;
    }

    const data = await response.json();
    return data.user;
  } catch (error) {
    console.error('Erreur de vérification auth:', error);
    window.location.href = '/login';
    return null;
  }
}

// Ajouter un bouton de déconnexion dans le header
function addLogoutButton(user) {
  const header = document.querySelector('header .container');
  if (header && !document.getElementById('user-info')) {
    const userInfo = document.createElement('div');
    userInfo.id = 'user-info';
    userInfo.style.cssText = 'position: absolute; top: 1rem; right: 1rem; font-size: 0.875rem;';
    userInfo.innerHTML = `
      <span style="opacity: 0.9;">Connecté en tant que <strong>${user.username}</strong> (${user.role})</span>
      <button id="btn-logout" class="btn btn-secondary" style="margin-left: 1rem; padding: 0.375rem 0.75rem; font-size: 0.875rem;">Déconnexion</button>
    `;
    header.appendChild(userInfo);

    document.getElementById('btn-logout').addEventListener('click', async () => {
      try {
        await fetchWithCsrf(`${API_BASE}/auth/logout`, {
          method: 'POST',
          credentials: 'include'
        });
        window.location.href = '/login';
      } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
      }
    });
  }
}

// Exécuter au chargement
window.currentUser = null;
document.addEventListener('DOMContentLoaded', async () => {
  // Ne pas vérifier l'auth sur la page de login
  if (window.location.pathname === '/login' || window.location.pathname === '/login.html') {
    return;
  }

  window.currentUser = await checkAuth();
  if (window.currentUser) {
    addLogoutButton(window.currentUser);
  }
});
