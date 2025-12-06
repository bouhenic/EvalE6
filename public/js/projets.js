// Utilise les fonctions communes depuis utils.js
const API_BASE = window.API_BASE;
const showMessage = window.showMessage;
const escapeHtml = window.escapeHtml;

// Charger la liste des projets
async function loadProjets() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/projets`);
    if (!response.ok) throw new Error('Erreur lors du chargement');

    const projets = await response.json();
    displayProjets(projets);
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors du chargement des projets', 'error');
  }
}

// Afficher les projets dans le tableau
function displayProjets(projets) {
  const tbody = document.getElementById('projets-tbody');

  if (projets.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Aucun projet</td></tr>';
    return;
  }

  tbody.innerHTML = projets.map((projet, index) => {
    const cahierChargesHTML = projet.cahierChargesFilename
      ? `
        <div style="display: flex; gap: 0.5rem; flex-direction: column;">
          <button class="btn btn-sm btn-secondary" onclick="downloadCahierCharges('${escapeHtml(projet.id)}', '${escapeHtml(projet.cahierChargesOriginalName || 'cahier-charges.pdf')}')">📄 Télécharger</button>
          <button class="btn btn-sm btn-danger" onclick="deleteCahierCharges('${escapeHtml(projet.id)}')">🗑️ Supprimer</button>
        </div>
      `
      : `
        <div>
          <input type="file" id="file-${escapeHtml(projet.id)}" accept=".pdf" style="display: none;" onchange="uploadCahierCharges('${escapeHtml(projet.id)}')">
          <button class="btn btn-sm btn-primary" onclick="document.getElementById('file-${escapeHtml(projet.id)}').click()">📤 Uploader PDF</button>
        </div>
      `;

    return `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(projet.nom)}</strong></td>
        <td>${escapeHtml(projet.description) || '-'}</td>
        <td>${cahierChargesHTML}</td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="deleteProjet('${escapeHtml(projet.id)}')">Supprimer</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Ajouter un projet
async function addProjet() {
  const nom = document.getElementById('new-nom-projet').value.trim();
  const description = document.getElementById('new-description').value.trim();

  if (!nom) {
    showMessage('Le nom du projet est requis', 'error');
    return;
  }

  try {
    const response = await fetchWithCsrf(`${API_BASE}/projets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom, description })
    });

    if (!response.ok) throw new Error('Erreur lors de l\'ajout');

    showMessage('Projet ajouté avec succès', 'success');
    document.getElementById('modal-add-projet').classList.add('hidden');
    document.getElementById('form-add-projet').reset();
    loadProjets();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors de l\'ajout du projet', 'error');
  }
}

// Supprimer un projet
async function deleteProjet(id) {
  if (!confirm('Êtes-vous sûr de vouloir supprimer ce projet ?')) {
    return;
  }

  try {
    const response = await fetchWithCsrf(`${API_BASE}/projets/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Erreur lors de la suppression');

    showMessage('Projet supprimé avec succès', 'success');
    loadProjets();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors de la suppression du projet', 'error');
  }
}

// Uploader un cahier des charges PDF pour un projet
async function uploadCahierCharges(projetId) {
  const fileInput = document.getElementById(`file-${projetId}`);
  const file = fileInput.files[0];

  if (!file) {
    showMessage('Aucun fichier sélectionné', 'error');
    return;
  }

  if (file.type !== 'application/pdf') {
    showMessage('Seuls les fichiers PDF sont acceptés', 'error');
    fileInput.value = '';
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showMessage('Le fichier est trop volumineux (max 10MB)', 'error');
    fileInput.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('cahierCharges', file);

  try {
    showMessage('Upload en cours...', 'info');
    const response = await fetchWithCsrf(`${API_BASE}/projets/${projetId}/cahier-charges`, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de l\'upload');
    }

    showMessage('Cahier des charges uploadé avec succès', 'success');
    fileInput.value = '';
    loadProjets();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de l\'upload du cahier des charges', 'error');
    fileInput.value = '';
  }
}

// Télécharger le cahier des charges PDF d'un projet
function downloadCahierCharges(projetId, filename) {
  window.location.href = `${API_BASE}/projets/${projetId}/cahier-charges`;
}

// Supprimer le cahier des charges PDF d'un projet
async function deleteCahierCharges(projetId) {
  if (!confirm('Êtes-vous sûr de vouloir supprimer ce cahier des charges ?')) {
    return;
  }

  try {
    const response = await fetchWithCsrf(`${API_BASE}/projets/${projetId}/cahier-charges`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de la suppression');
    }

    showMessage('Cahier des charges supprimé avec succès', 'success');
    loadProjets();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la suppression du cahier des charges', 'error');
  }
}

// Gestion de la modal
document.getElementById('btn-add-projet').addEventListener('click', () => {
  document.getElementById('modal-add-projet').classList.remove('hidden');
});

document.getElementById('btn-close-modal').addEventListener('click', () => {
  document.getElementById('modal-add-projet').classList.add('hidden');
  document.getElementById('form-add-projet').reset();
});

document.getElementById('btn-cancel-add').addEventListener('click', () => {
  document.getElementById('modal-add-projet').classList.add('hidden');
  document.getElementById('form-add-projet').reset();
});

document.getElementById('btn-confirm-add').addEventListener('click', (e) => {
  e.preventDefault();
  addProjet();
});

// Charger les projets au démarrage
document.addEventListener('DOMContentLoaded', () => {
  loadProjets();
});
