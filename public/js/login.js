// Utilise les fonctions communes depuis utils.js
const API_BASE = window.API_BASE;
const showMessage = window.showMessage;

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showMessage('Veuillez remplir tous les champs', 'error');
    return;
  }

  const submitBtn = document.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="loading"></span> Connexion...';

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur de connexion');
    }

    showMessage('Connexion réussie...', 'success');

    // Rediriger vers la page d'accueil
    setTimeout(() => {
      window.location.href = '/';
    }, 500);
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur de connexion', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
});
