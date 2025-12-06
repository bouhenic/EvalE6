// Utilise les fonctions communes depuis utils.js
const API_BASE = window.API_BASE;
const showMessage = window.showMessage;

// Afficher les informations de l'utilisateur
async function displayUserInfo() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/auth/me`, {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      const user = data.user;
      document.getElementById('user-info').textContent =
        `Connecté en tant que: ${user.username} (${user.role})`;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des informations utilisateur:', error);
  }
}

// Gérer la soumission du formulaire
document.getElementById('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  // Vérifier que les nouveaux mots de passe correspondent
  if (newPassword !== confirmPassword) {
    showMessage('Les nouveaux mots de passe ne correspondent pas', 'error');
    return;
  }

  // Vérifier la longueur minimale
  if (newPassword.length < 6) {
    showMessage('Le nouveau mot de passe doit contenir au moins 6 caractères', 'error');
    return;
  }

  // Vérifier que le nouveau mot de passe est différent de l'ancien
  if (currentPassword === newPassword) {
    showMessage('Le nouveau mot de passe doit être différent de l\'ancien', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="loading"></span> Modification en cours...';

  try {
    const response = await fetchWithCsrf(`${API_BASE}/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        currentPassword,
        newPassword
      })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('Mot de passe modifié avec succès !', 'success');

      // Réinitialiser le formulaire
      document.getElementById('change-password-form').reset();

      // Rediriger vers la page d'accueil après 2 secondes
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } else {
      showMessage(data.error || 'Erreur lors de la modification du mot de passe', 'error');
    }
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors de la modification du mot de passe', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
});

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
  displayUserInfo();
});
