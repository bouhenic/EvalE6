// Gestion automatique des tokens CSRF
let csrfToken = null;

// Fonction pour récupérer le token CSRF (déclarée globalement)
window.getCsrfToken = async function() {
  if (csrfToken) {
    return csrfToken;
  }

  try {
    const response = await fetch('https://localhost:3001/api/csrf-token', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Erreur lors de la récupération du token CSRF');
      return null;
    }

    const data = await response.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  } catch (error) {
    console.error('Erreur CSRF:', error);
    return null;
  }
}

// Fonction wrapper pour fetch qui ajoute automatiquement le token CSRF (déclarée globalement)
window.fetchWithCsrf = async function(url, options = {}) {
  // Si c'est une requête qui modifie l'état (POST, PATCH, DELETE, PUT)
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method);

  if (needsCsrf) {
    // Récupérer le token CSRF
    const token = await window.getCsrfToken();

    if (!token) {
      throw new Error('Token CSRF non disponible');
    }

    // Ajouter le token dans les headers
    options.headers = {
      ...options.headers,
      'CSRF-Token': token
    };
  }

  // Faire la requête
  const response = await fetch(url, {
    ...options,
    credentials: 'include'
  });

  // Si erreur CSRF (403), renouveler le token et réessayer
  if (response.status === 403 && needsCsrf) {
    console.log('Token CSRF invalide, renouvellement...');
    csrfToken = null; // Invalider le token actuel

    // Récupérer un nouveau token
    const newToken = await window.getCsrfToken();
    if (newToken) {
      options.headers['CSRF-Token'] = newToken;
      return fetch(url, {
        ...options,
        credentials: 'include'
      });
    }
  }

  return response;
}

// Initialiser le token CSRF au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
  // Ne récupérer le token que si l'utilisateur est connecté (pas sur la page de login)
  if (!window.location.pathname.includes('login')) {
    window.getCsrfToken().catch(err => console.error('Erreur initialisation CSRF:', err));
  }
});
