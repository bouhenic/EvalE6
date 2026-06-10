// Utilise les fonctions communes depuis utils.js
const API_BASE = window.API_BASE;
const showMessage = window.showMessage;
const escapeHtml = window.escapeHtml;

// Fonction pour déterminer le statut d'un élève
function getEleveStatus(eleve) {
  if (!eleve.evaluations || Object.keys(eleve.evaluations).length === 0) {
    return '<span class="badge warning">Non commencé</span>';
  }

  const evaluations = ['stage', 'revue1', 'revue2', 'revue3', 'soutenance'];
  const completed = evaluations.filter(ev => eleve.evaluations[ev]).length;

  if (completed === 0) {
    return '<span class="badge warning">Non commencé</span>';
  } else if (completed === evaluations.length) {
    return '<span class="badge success">Complet</span>';
  } else {
    return `<span class="badge info">${completed}/5 évaluations</span>`;
  }
}

// Fonction pour charger la liste des élèves
async function loadEleves() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves`, {
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Erreur lors du chargement');

    allEleves = await response.json();
    populateProjetFilter();
    applyFilters();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors du chargement des élèves', 'error');
  }
}

// Peupler le filtre de projet avec les projets disponibles
function populateProjetFilter() {
  const filterSelect = document.getElementById('filter-projet');
  if (!filterSelect) return;

  // Sauvegarder la valeur actuellement sélectionnée
  const currentValue = filterSelect.value;

  // Garder l'option "Tous"
  filterSelect.innerHTML = '<option value="">Tous</option>';

  // Pour les jurys, ne montrer que les projets des élèves de leur jury
  const isJury = window.currentUser && window.currentUser.role === 'jury';
  const juryId = window.currentUser?.juryId;

  let availableProjets = projets;

  if (isJury && juryId) {
    // Récupérer les IDs de projets uniques des élèves de ce jury
    const projetIdsForJury = [...new Set(
      allEleves
        .filter(eleve => eleve.jury === juryId && eleve.projetId)
        .map(eleve => eleve.projetId)
    )];

    // Filtrer les projets pour ne garder que ceux assignés aux élèves du jury
    availableProjets = projets.filter(projet => projetIdsForJury.includes(projet.id));
  }

  // Ajouter une option pour "Non assigné"
  const hasUnassigned = allEleves.some(eleve => !eleve.projetId);
  if (hasUnassigned) {
    const option = document.createElement('option');
    option.value = 'unassigned';
    option.textContent = 'Non assigné';
    filterSelect.appendChild(option);
  }

  // Ajouter les projets filtrés
  availableProjets.forEach(projet => {
    const option = document.createElement('option');
    option.value = projet.id;
    option.textContent = projet.nom;
    filterSelect.appendChild(option);
  });

  // Restaurer la valeur sélectionnée si elle existe toujours
  if (currentValue) {
    const optionExists = Array.from(filterSelect.options).some(opt => opt.value === currentValue);
    if (optionExists) {
      filterSelect.value = currentValue;
    }
  }
}

// Appliquer les filtres combinés (projet + jury)
function applyFilters() {
  const projetFilter = document.getElementById('filter-projet')?.value || '';
  const juryFilter = document.getElementById('filter-jury')?.value || '';

  let filteredEleves = allEleves;

  // Filtre par projet
  if (projetFilter) {
    if (projetFilter === 'unassigned') {
      filteredEleves = filteredEleves.filter(eleve => !eleve.projetId);
    } else {
      filteredEleves = filteredEleves.filter(eleve => eleve.projetId === projetFilter);
    }
  }

  // Filtre par jury
  if (juryFilter) {
    if (juryFilter === 'unassigned') {
      filteredEleves = filteredEleves.filter(eleve => !eleve.jury);
    } else {
      filteredEleves = filteredEleves.filter(eleve => eleve.jury === juryFilter);
    }
  }

  displayEleves(filteredEleves);
}

// Fonction pour afficher les élèves dans le tableau
function displayEleves(eleves) {
  const tbody = document.getElementById('eleves-tbody');
  tbody.innerHTML = '';

  // Pour le jury, afficher seulement le bouton "Évaluer" pour la soutenance
  const isJury = window.currentUser && window.currentUser.role === 'jury';
  const isAdmin = !isJury;

  // Déterminer le colspan pour la ligne "Aucun élève"
  // Admin: 7 colonnes (N°, Nom, Prénom, Projet, Jury, Statut, Actions)
  // Jury: 7 colonnes aussi (N°, Nom, Prénom, Projet, CDC, Statut, Actions - sans Jury)
  const colspan = 7;

  if (eleves.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center">Aucun élève trouvé</td></tr>`;
    return;
  }

  eleves.forEach((eleve, index) => {
    const row = document.createElement('tr');

    let actionsHTML = '';
    if (isJury) {
      // Jury: seulement le bouton Évaluer pour soutenance
      actionsHTML = `
        <a href="/evaluation/${eleve.id}?semestre=soutenance" class="btn btn-secondary">
          ✏️ Évaluer (Soutenance)
        </a>
      `;
    } else {
      // Admin: vérifier si cet élève spécifique est verrouillé
      const isLocked = shouldLockAdminActionsForEleve(eleve);

      if (isLocked) {
        actionsHTML = `<span style="color: #e53e3e; font-size: 0.875rem;">🔒 Verrouillé (jury en cours)</span>`;
      } else {
        actionsHTML = `
          <div class="action-menu">
            <button class="btn btn-primary btn-action-menu" data-id="${eleve.id}">
              ⚡ Actions ▼
            </button>
            <div class="action-dropdown" id="dropdown-${eleve.id}">
              <a href="/evaluation/${eleve.id}" class="action-item">
                ✏️ Évaluer
              </a>
            <a href="/recapitulatif/${eleve.id}" class="action-item">
              📊 Récapitulatif
            </a>
            <button class="action-item btn-generer" data-id="${eleve.id}">
              📄 Générer Excel
            </button>
            <button class="action-item btn-telecharger" data-id="${eleve.id}" data-nom="${escapeHtml(eleve.nom)}" data-prenom="${escapeHtml(eleve.prenom)}">
              ⬇️ Télécharger Excel
            </button>
            <div class="action-divider"></div>
            <button class="action-item btn-modifier" data-id="${eleve.id}">
              ✏️ Modifier
            </button>
            <button class="action-item action-danger btn-supprimer" data-id="${eleve.id}" data-nom="${escapeHtml(eleve.nom)}" data-prenom="${escapeHtml(eleve.prenom)}">
              🗑️ Supprimer
            </button>
          </div>
        </div>
        `;
      }
    }

    // Créer un dropdown pour le jury (éditable uniquement par admin)
    let juryHTML = '';
    if (isAdmin) {
      juryHTML = `
        <select class="jury-select" data-id="${eleve.id}" style="padding: 0.25rem 0.5rem; border: 1px solid #e2e8f0; border-radius: 4px;">
          <option value="">Non assigné</option>
          <option value="jury1" ${eleve.jury === 'jury1' ? 'selected' : ''}>Jury 1</option>
          <option value="jury2" ${eleve.jury === 'jury2' ? 'selected' : ''}>Jury 2</option>
        </select>
      `;
    } else {
      juryHTML = eleve.jury ? `<span class="badge info">${eleve.jury === 'jury1' ? 'Jury 1' : 'Jury 2'}</span>` : '-';
    }

    // Créer un dropdown pour le projet (éditable uniquement par admin)
    let projetHTML = '';
    if (isAdmin) {
      const selectedProjet = projets.find(p => p.id === eleve.projetId);
      projetHTML = `
        <select class="projet-select" data-id="${escapeHtml(eleve.id)}" style="padding: 0.25rem 0.5rem; border: 1px solid #e2e8f0; border-radius: 4px; min-width: 150px;">
          <option value="">Non assigné</option>
          ${projets.map(projet => `
            <option value="${escapeHtml(projet.id)}" ${eleve.projetId === projet.id ? 'selected' : ''}>${escapeHtml(projet.nom)}</option>
          `).join('')}
        </select>
      `;
    } else {
      // Pour les jurys, afficher le nom du projet avec possibilité de télécharger le cahier des charges au survol
      const selectedProjet = projets.find(p => p.id === eleve.projetId);
      if (selectedProjet && selectedProjet.cahierChargesFilename) {
        projetHTML = `
          <div class="projet-with-download">
            <span class="projet-nom">${escapeHtml(selectedProjet.nom)}</span>
            <a href="${API_BASE}/projets/${escapeHtml(selectedProjet.id)}/cahier-charges"
               class="projet-download-icon"
               title="Télécharger le cahier des charges"
               download>
              📥
            </a>
          </div>
        `;
      } else if (selectedProjet) {
        projetHTML = escapeHtml(selectedProjet.nom);
      } else {
        projetHTML = '-';
      }
    }

    // La colonne "Cahier des charges" a été supprimée - le téléchargement se fait maintenant depuis la colonne Projet

    // Construction de la ligne selon le rôle
    if (isAdmin) {
      // Admin: dropdown pour projet, colonne jury visible
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${escapeHtml(eleve.nom)}</td>
        <td>${escapeHtml(eleve.prenom)}</td>
        <td>${projetHTML}</td>
        <td>${juryHTML}</td>
        <td>${getEleveStatus(eleve)}</td>
        <td>${actionsHTML}</td>
      `;
    } else {
      // Jury: nom du projet avec icône de téléchargement, colonne jury masquée
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${escapeHtml(eleve.nom)}</td>
        <td>${escapeHtml(eleve.prenom)}</td>
        <td>${projetHTML}</td>
        <td style="display: none;">${juryHTML}</td>
        <td>${getEleveStatus(eleve)}</td>
        <td>${actionsHTML}</td>
      `;
    }
    tbody.appendChild(row);
  });

  // Attacher les événements
  attachEventListeners();

  // Gestion des menus dropdown
  if (isAdmin) {
    setupActionMenus();
  }
}

// Fonction pour générer le fichier Excel d'un élève (Version optimisée)
async function genererExcel(eleveId) {
  const btn = document.querySelector(`[data-id="${eleveId}"].btn-generer`);
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Génération...';

  const etablissement = document.getElementById('etablissement').value;
  const academie = document.getElementById('academie').value;
  const session = document.getElementById('session').value;

  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/generer-excel-complet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ etablissement, academie, session })
    });

    if (!response.ok) throw new Error('Erreur lors de la génération');

    const result = await response.json();
    showMessage(result.message + ' (Version optimisée - économie de RAM)', 'success');

    // Activer le bouton de téléchargement
    const downloadBtn = document.querySelector(`[data-id="${eleveId}"].btn-telecharger`);
    if (downloadBtn) {
      downloadBtn.disabled = false;
    }
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors de la génération du fichier Excel', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Fonction pour télécharger le fichier Excel
function telechargerExcel(nom, prenom) {
  const filename = `${nom}_${prenom}_Evaluation.xlsx`;
  window.location.href = `${API_BASE}/download/${filename}`;
}

// Fonction pour supprimer un élève
async function supprimerEleve(eleveId, nom, prenom) {
  if (!confirm(`Êtes-vous sûr de vouloir supprimer l'élève ${prenom} ${nom} ?\n\nCette action est irréversible et supprimera toutes les évaluations associées.`)) {
    return;
  }

  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de la suppression');
    }

    showMessage(`Élève ${prenom} ${nom} supprimé avec succès`, 'success');
    loadEleves(); // Recharger la liste
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la suppression de l\'élève', 'error');
  }
}

// Fonction pour mettre à jour le jury d'un élève
async function updateJury(eleveId, newJury) {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/jury`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ jury: newJury })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de la mise à jour');
    }

    showMessage('Jury mis à jour avec succès', 'success');
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la mise à jour du jury', 'error');
    loadEleves(); // Recharger pour annuler le changement visuel
  }
}

// Fonction pour mettre à jour le projet d'un élève
async function updateProjet(eleveId, newProjetId) {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/projet`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ projetId: newProjetId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de la mise à jour');
    }

    showMessage('Projet assigné avec succès', 'success');
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de l\'assignation du projet', 'error');
    loadEleves(); // Recharger pour annuler le changement visuel
  }
}

// Gérer les menus dropdown d'actions
function setupActionMenus() {
  // Toggle dropdown au clic sur le bouton
  document.querySelectorAll('.btn-action-menu').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const eleveId = e.target.dataset.id;
      const dropdown = document.getElementById(`dropdown-${eleveId}`);

      // Fermer tous les autres dropdowns
      document.querySelectorAll('.action-dropdown').forEach(dd => {
        if (dd.id !== `dropdown-${eleveId}`) {
          dd.classList.remove('show');
        }
      });

      // Toggle le dropdown actuel
      dropdown.classList.toggle('show');
    });
  });

  // Fermer les dropdowns en cliquant ailleurs
  document.addEventListener('click', () => {
    document.querySelectorAll('.action-dropdown').forEach(dd => {
      dd.classList.remove('show');
    });
  });

  // Empêcher la fermeture lors du clic à l'intérieur du dropdown
  document.querySelectorAll('.action-dropdown').forEach(dropdown => {
    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  });
}

// Attacher les événements aux boutons
function attachEventListeners() {
  // Boutons "Générer Excel"
  document.querySelectorAll('.btn-generer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const eleveId = e.target.closest('.btn-generer').dataset.id;
      genererExcel(eleveId);
    });
  });

  // Boutons "Télécharger"
  document.querySelectorAll('.btn-telecharger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const button = e.target.closest('.btn-telecharger');
      const nom = button.dataset.nom;
      const prenom = button.dataset.prenom;
      telechargerExcel(nom, prenom);
    });
  });

  // Boutons "Modifier"
  document.querySelectorAll('.btn-modifier').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const button = e.target.closest('.btn-modifier');
      const eleveId = button.dataset.id;
      openEditModal(eleveId);
    });
  });

  // Boutons "Supprimer"
  document.querySelectorAll('.btn-supprimer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const button = e.target.closest('.btn-supprimer');
      const eleveId = button.dataset.id;
      const nom = button.dataset.nom;
      const prenom = button.dataset.prenom;
      supprimerEleve(eleveId, nom, prenom);
    });
  });

  // Dropdowns de jury
  document.querySelectorAll('.jury-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const eleveId = e.target.dataset.id;
      const newJury = e.target.value;
      updateJury(eleveId, newJury);
    });
  });

  // Dropdowns de projet
  document.querySelectorAll('.projet-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const eleveId = e.target.dataset.id;
      const newProjetId = e.target.value;
      updateProjet(eleveId, newProjetId);
    });
  });
}

// Charger établissement, académie et session depuis localStorage
function loadSettings() {
  const etablissement = localStorage.getItem('etablissement');
  const academie = localStorage.getItem('academie');
  const session = localStorage.getItem('session');

  if (etablissement) {
    document.getElementById('etablissement').value = etablissement;
  }
  if (academie) {
    document.getElementById('academie').value = academie;
  }
  if (session) {
    document.getElementById('session').value = session;
  } else {
    // Par défaut, utiliser l'année courante
    document.getElementById('session').value = new Date().getFullYear().toString();
  }
}

// Ouvrir le modal de configuration
function openConfigModal() {
  // Charger les valeurs actuelles depuis localStorage
  const etablissement = localStorage.getItem('etablissement') || '';
  const academie = localStorage.getItem('academie') || '';
  const session = localStorage.getItem('session') || new Date().getFullYear().toString();

  document.getElementById('modal-etablissement').value = etablissement;
  document.getElementById('modal-academie').value = academie;
  document.getElementById('modal-session').value = session;

  document.getElementById('modal-manage-config').classList.remove('hidden');
}

// Fermer le modal de configuration
function closeConfigModal() {
  document.getElementById('modal-manage-config').classList.add('hidden');
}

// Sauvegarder la configuration
function saveConfig() {
  const etablissement = document.getElementById('modal-etablissement').value.trim();
  const academie = document.getElementById('modal-academie').value.trim();
  const session = document.getElementById('modal-session').value.trim();

  if (!etablissement || !academie || !session) {
    showMessage('Tous les champs sont obligatoires', 'error');
    return;
  }

  if (!/^\d{4}$/.test(session)) {
    showMessage('La session doit être une année sur 4 chiffres (ex: 2025)', 'error');
    return;
  }

  // Sauvegarder dans localStorage
  localStorage.setItem('etablissement', etablissement);
  localStorage.setItem('academie', academie);
  localStorage.setItem('session', session);

  // Mettre à jour les champs cachés
  document.getElementById('etablissement').value = etablissement;
  document.getElementById('academie').value = academie;
  document.getElementById('session').value = session;

  showMessage('Configuration enregistrée avec succès', 'success');
  closeConfigModal();
}

// ========== GESTION DU MODAL CHANGEMENT DE MOT DE PASSE ==========

// Ouvrir le modal de changement de mot de passe
function openPasswordModal() {
  document.getElementById('modal-change-password').classList.remove('hidden');
  // Réinitialiser le formulaire
  document.getElementById('modal-change-password-form').reset();
}

// Fermer le modal de changement de mot de passe
function closePasswordModal() {
  document.getElementById('modal-change-password').classList.add('hidden');
  document.getElementById('modal-change-password-form').reset();
}

// Sauvegarder le nouveau mot de passe
async function savePassword() {
  const currentPassword = document.getElementById('modal-current-password').value;
  const newPassword = document.getElementById('modal-new-password').value;
  const confirmPassword = document.getElementById('modal-confirm-password').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    showMessage('Tous les champs sont obligatoires', 'error');
    return;
  }

  if (newPassword.length < 6) {
    showMessage('Le nouveau mot de passe doit contenir au moins 6 caractères', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    showMessage('Les mots de passe ne correspondent pas', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-password');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Modification...';

  try {
    const response = await fetchWithCsrf(`${API_BASE}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur lors de la modification');
    }

    showMessage('Mot de passe modifié avec succès', 'success');
    closePasswordModal();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la modification du mot de passe', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ========== GESTION DU MODAL PROJETS ==========

// Ouvrir le modal de gestion des projets
async function openProjetsModal() {
  document.getElementById('modal-manage-projets').classList.remove('hidden');
  await loadProjetsInModal();
}

// Fermer le modal de gestion des projets
function closeProjetsModal() {
  document.getElementById('modal-manage-projets').classList.add('hidden');
}

// Charger les projets dans le modal
async function loadProjetsInModal() {
  const projetsList = document.getElementById('projets-list');
  projetsList.innerHTML = '<p style="text-align: center;">Chargement...</p>';

  try {
    const response = await fetchWithCsrf(`${API_BASE}/projets`, {
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Erreur lors du chargement');

    const projetsList = document.getElementById('projets-list');
    const modalProjets = await response.json();

    if (modalProjets.length === 0) {
      projetsList.innerHTML = '<p style="text-align: center; color: #718096;">Aucun projet pour le moment</p>';
      return;
    }

    projetsList.innerHTML = modalProjets.map((projet, index) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 0.5rem; background: #f7fafc;">
        <div style="flex: 1;">
          <strong>${escapeHtml(projet.nom)}</strong>
          ${projet.description ? `<p style="margin: 0.25rem 0 0 0; color: #718096; font-size: 0.875rem;">${escapeHtml(projet.description)}</p>` : ''}
          <div style="margin-top: 0.5rem;">
            ${projet.cahierChargesFilename ? `
              <span style="font-size: 0.75rem; color: #48bb78;">✓ Cahier des charges: ${escapeHtml(projet.cahierChargesOriginalName || projet.cahierChargesFilename)}</span>
              <button class="btn btn-sm btn-secondary" data-action="download-cdc-modal" data-id="${escapeHtml(projet.id)}" style="margin-left: 0.5rem; padding: 0.25rem 0.5rem;">📄 Télécharger</button>
              <button class="btn btn-sm btn-danger" data-action="delete-cdc-modal" data-id="${escapeHtml(projet.id)}" data-nom="${escapeHtml(projet.nom)}" style="margin-left: 0.25rem; padding: 0.25rem 0.5rem;">🗑️</button>
            ` : `
              <label for="upload-cdc-${escapeHtml(projet.id)}" class="btn btn-sm btn-secondary" style="cursor: pointer; display: inline-block; padding: 0.25rem 0.5rem;">📤 Uploader cahier des charges</label>
              <input type="file" id="upload-cdc-${escapeHtml(projet.id)}" accept=".pdf" style="display: none;" data-action="upload-cdc-modal" data-id="${escapeHtml(projet.id)}">
            `}
          </div>
        </div>
        <button class="btn btn-danger btn-sm" data-action="delete-projet-modal" data-id="${escapeHtml(projet.id)}" data-nom="${escapeHtml(projet.nom)}">🗑️ Supprimer projet</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Erreur:', error);
    projetsList.innerHTML = '<p style="text-align: center; color: #e53e3e;">Erreur lors du chargement des projets</p>';
  }
}

// Supprimer un projet depuis le modal
async function deleteProjetFromModal(projetId, projetNom) {
  if (!confirm(`Êtes-vous sûr de vouloir supprimer le projet "${projetNom}" ?`)) {
    return;
  }

  try {
    const response = await fetchWithCsrf(`${API_BASE}/projets/${projetId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de la suppression');
    }

    showMessage(`Projet "${projetNom}" supprimé avec succès`, 'success');
    await loadProjetsInModal();
    await loadProjets(); // Recharger aussi la liste globale
    await loadEleves(); // Recharger les élèves pour mettre à jour les filtres
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la suppression du projet', 'error');
  }
}

// Ajouter un projet depuis le modal
async function addProjetFromModal() {
  const nom = prompt('Nom du projet:');
  if (!nom || nom.trim() === '') return;

  const description = prompt('Description (optionnelle):') || '';

  try {
    const response = await fetchWithCsrf(`${API_BASE}/projets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nom: nom.trim(), description: description.trim() })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de l\'ajout');
    }

    showMessage(`Projet "${nom}" ajouté avec succès`, 'success');
    await loadProjetsInModal();
    await loadProjets(); // Recharger aussi la liste globale
    await loadEleves(); // Recharger les élèves pour mettre à jour les filtres
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de l\'ajout du projet', 'error');
  }
}

// Uploader un cahier des charges depuis le modal
async function uploadCahierChargesFromModal(projetId, inputElement) {
  const file = inputElement.files[0];
  if (!file) return;

  if (file.type !== 'application/pdf') {
    showMessage('Seuls les fichiers PDF sont acceptés', 'error');
    inputElement.value = '';
    return;
  }

  if (file.size > 10 * 1024 * 1024) { // 10 MB max
    showMessage('Le fichier est trop volumineux (max 10 MB)', 'error');
    inputElement.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('cahierCharges', file);

  try {
    showMessage('Upload en cours...', 'info');
    const response = await fetchWithCsrf(`${API_BASE}/projets/${projetId}/cahier-charges`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de l\'upload');
    }

    showMessage('Cahier des charges uploadé avec succès', 'success');
    await loadProjetsInModal();
    await loadProjets();
    await loadEleves();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de l\'upload du cahier des charges', 'error');
  } finally {
    inputElement.value = '';
  }
}

// Supprimer un cahier des charges depuis le modal
async function deleteCahierChargesFromModal(projetId, projetNom) {
  if (!confirm(`Êtes-vous sûr de vouloir supprimer le cahier des charges du projet "${projetNom}" ?`)) {
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
    await loadProjetsInModal();
    await loadProjets();
    await loadEleves();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la suppression du cahier des charges', 'error');
  }
}

// Gestion du modal (ajout)
function openModal() {
  document.getElementById('modal-add-eleve').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-add-eleve').classList.add('hidden');
  document.getElementById('form-add-eleve').reset();
}

// Gestion du modal (modification)
function openEditModal(eleveId) {
  // Convertir eleveId en nombre pour la comparaison
  const id = typeof eleveId === 'string' ? parseInt(eleveId) : eleveId;
  const eleve = allEleves.find(e => e.id === id);

  if (!eleve) {
    console.error('Élève introuvable avec ID:', eleveId, 'Type:', typeof eleveId);
    console.log('IDs disponibles:', allEleves.map(e => ({ id: e.id, type: typeof e.id })));
    showMessage('Élève introuvable', 'error');
    return;
  }

  // Remplir le formulaire avec les données actuelles
  document.getElementById('edit-eleve-id').value = eleve.id;
  document.getElementById('edit-nom').value = eleve.nom || '';
  document.getElementById('edit-prenom').value = eleve.prenom || '';
  document.getElementById('edit-promotion').value = eleve.promotion || '';
  document.getElementById('edit-numero').value = eleve.numero || '';
  document.getElementById('edit-jury').value = eleve.jury || '';

  document.getElementById('modal-edit-eleve').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('modal-edit-eleve').classList.add('hidden');
  document.getElementById('form-edit-eleve').reset();
}

// Ajouter un nouvel élève
async function addEleve() {
  const nom = document.getElementById('new-nom').value.trim();
  const prenom = document.getElementById('new-prenom').value.trim();
  const promotion = document.getElementById('new-promotion').value.trim();
  const numero = document.getElementById('new-numero').value.trim();
  const jury = document.getElementById('new-jury').value;

  if (!nom || !prenom || !promotion || !numero) {
    showMessage('Veuillez remplir tous les champs obligatoires', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-eleve');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Ajout...';

  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nom, prenom, promotion, numero, jury })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de l\'ajout');
    }

    const result = await response.json();
    showMessage(`Élève ${prenom} ${nom} ajouté avec succès`, 'success');
    closeModal();
    loadEleves(); // Recharger la liste
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de l\'ajout de l\'élève', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Modifier un élève existant
async function editEleve() {
  const eleveId = document.getElementById('edit-eleve-id').value;
  const nom = document.getElementById('edit-nom').value.trim();
  const prenom = document.getElementById('edit-prenom').value.trim();
  const promotion = document.getElementById('edit-promotion').value.trim();
  const numero = document.getElementById('edit-numero').value.trim();
  const jury = document.getElementById('edit-jury').value;

  if (!nom || !prenom || !promotion || !numero) {
    showMessage('Veuillez remplir tous les champs obligatoires', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-edit-eleve');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Modification...';

  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nom, prenom, promotion, numero, jury })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de la modification');
    }

    const result = await response.json();
    showMessage(`Élève ${prenom} ${nom} modifié avec succès`, 'success');
    closeEditModal();
    loadEleves(); // Recharger la liste
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la modification de l\'élève', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Variables globales pour les jurys
let juryMembers = {
  jury1: [],
  jury2: []
};

// Variable globale pour les projets
let projets = [];

// Variable globale pour stocker tous les élèves
let allEleves = [];

// Charger les projets
async function loadProjets() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/projets`, {
      credentials: 'include'
    });
    if (response.ok) {
      projets = await response.json();
    }
  } catch (error) {
    console.error('Erreur lors du chargement des projets:', error);
  }
}

// Charger les membres des jurys
async function loadJuryMembers() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/jury-members`, {
      credentials: 'include'
    });
    if (response.ok) {
      juryMembers = await response.json();
    }
  } catch (error) {
    console.error('Erreur lors du chargement des membres du jury:', error);
  }
}

// Ouvrir le modal de gestion des jurys
function openJuryModal() {
  document.getElementById('modal-manage-jury').classList.remove('hidden');
  displayJuryMembers();
}

// Fermer le modal de gestion des jurys
function closeJuryModal() {
  document.getElementById('modal-manage-jury').classList.add('hidden');
}

// Afficher les membres des jurys
function displayJuryMembers() {
  displayJuryList('jury1');
  displayJuryList('jury2');
}

// Afficher la liste d'un jury spécifique
function displayJuryList(juryId) {
  const container = document.getElementById(`${juryId}-members`);
  const members = juryMembers[juryId] || [];

  if (members.length === 0) {
    container.innerHTML = '<p style="color: #718096; font-style: italic;">Aucun membre ajouté</p>';
    return;
  }

  container.innerHTML = members.map((member, index) => `
    <div class="jury-member" style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.5rem; margin-bottom: 0.5rem; padding: 0.75rem; background: #f7fafc; border-radius: 6px;">
      <input type="text" placeholder="Nom" value="${escapeHtml(member.nom || '')}" data-jury="${escapeHtml(juryId)}" data-index="${index}" data-field="nom" class="jury-input" style="padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 4px;">
      <input type="text" placeholder="Prénom" value="${escapeHtml(member.prenom || '')}" data-jury="${escapeHtml(juryId)}" data-index="${index}" data-field="prenom" class="jury-input" style="padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 4px;">
      <input type="text" placeholder="Qualité" value="${escapeHtml(member.qualite || '')}" data-jury="${escapeHtml(juryId)}" data-index="${index}" data-field="qualite" class="jury-input" style="padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 4px;">
      <button class="btn btn-danger btn-sm btn-remove-member" data-jury="${escapeHtml(juryId)}" data-index="${index}">🗑️</button>
    </div>
  `).join('');

  // Attacher les événements
  container.querySelectorAll('.jury-input').forEach(input => {
    input.addEventListener('input', updateJuryMember);
  });
  container.querySelectorAll('.btn-remove-member').forEach(btn => {
    btn.addEventListener('click', removeMemberJury);
  });
}

// Ajouter un membre au jury
function addJuryMember(juryId) {
  if (!juryMembers[juryId]) {
    juryMembers[juryId] = [];
  }
  juryMembers[juryId].push({ nom: '', prenom: '', qualite: '' });
  displayJuryList(juryId);
}

// Mettre à jour un membre du jury
function updateJuryMember(e) {
  const juryId = e.target.dataset.jury;
  const index = parseInt(e.target.dataset.index);
  const field = e.target.dataset.field;
  juryMembers[juryId][index][field] = e.target.value;
}

// Supprimer un membre du jury
function removeMemberJury(e) {
  const juryId = e.target.dataset.jury;
  const index = parseInt(e.target.dataset.index);
  juryMembers[juryId].splice(index, 1);
  displayJuryList(juryId);
}

// Sauvegarder les membres des jurys
async function saveJuryMembers() {
  const btn = document.getElementById('btn-save-jury');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Enregistrement...';

  try {
    const response = await fetchWithCsrf(`${API_BASE}/jury-members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(juryMembers)
    });

    if (!response.ok) {
      throw new Error('Erreur lors de la sauvegarde');
    }

    showMessage('Membres des jurys enregistrés avec succès', 'success');
    closeJuryModal();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors de la sauvegarde des membres du jury', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ========== GESTION DES UTILISATEURS ==========

// Ouvrir le modal de gestion des utilisateurs
async function openUsersModal() {
  document.getElementById('modal-manage-users').classList.remove('hidden');
  await loadAndDisplayUsers();
}

// Fermer le modal de gestion des utilisateurs
function closeUsersModal() {
  document.getElementById('modal-manage-users').classList.add('hidden');
}

// Charger et afficher les utilisateurs
async function loadAndDisplayUsers() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/users`, {
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Erreur lors du chargement des utilisateurs');
    }

    const users = await response.json();
    displayUsers(users);
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors du chargement des utilisateurs', 'error');
  }
}

// Afficher les utilisateurs
function displayUsers(users) {
  const container = document.getElementById('users-list');

  if (users.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #718096;">Aucun utilisateur trouvé</p>';
    return;
  }

  container.innerHTML = users.map(user => `
    <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong style="font-size: 1.1rem;">${escapeHtml(user.username)}</strong>
          <span style="margin-left: 1rem; color: #667eea; font-weight: 500;">${escapeHtml(user.role)}</span>
          ${user.juryId ? `<span style="margin-left: 0.5rem; color: #718096;">(${escapeHtml(user.juryId)})</span>` : ''}
        </div>
        <button
          class="btn btn-secondary btn-sm"
          data-action="reset-password" data-username="${escapeHtml(user.username)}"
          ${user.username === 'admin' ? 'style="visibility: hidden;"' : ''}
        >
          🔒 Réinitialiser mot de passe
        </button>
      </div>
    </div>
  `).join('');
}

// Réinitialiser le mot de passe d'un utilisateur
async function resetUserPassword(username) {
  const newPassword = prompt(`Entrez le nouveau mot de passe pour ${username}:\n(minimum 6 caractères)`);

  if (!newPassword) {
    return;
  }

  if (newPassword.length < 6) {
    showMessage('Le mot de passe doit contenir au moins 6 caractères', 'error');
    return;
  }

  const confirmed = confirm(`Confirmer la réinitialisation du mot de passe pour ${username} ?`);
  if (!confirmed) return;

  try {
    const response = await fetchWithCsrf(`${API_BASE}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, newPassword })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur lors de la réinitialisation');
    }

    showMessage(`Mot de passe réinitialisé pour ${username}`, 'success');
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la réinitialisation du mot de passe', 'error');
  }
}

// Afficher les noms des membres du jury
function displayJuryInfo() {
  const juryInfo = document.getElementById('jury-info');
  if (!juryInfo || !window.currentUser?.juryId) return;

  const juryId = window.currentUser.juryId;
  const members = juryMembers[juryId] || [];

  if (members.length === 0) {
    const juryName = juryId === 'jury1' ? 'Jury 1' : 'Jury 2';
    juryInfo.textContent = `👥 ${juryName}`;
  } else {
    // Formatter les noms des membres (Prénom Nom)
    const memberNames = members
      .filter(m => m.prenom || m.nom)
      .map(m => `${m.prenom || ''} ${m.nom || ''}`.trim())
      .filter(name => name.length > 0)
      .join(', ');

    if (memberNames) {
      juryInfo.textContent = `👥 ${memberNames}`;
    } else {
      const juryName = juryId === 'jury1' ? 'Jury 1' : 'Jury 2';
      juryInfo.textContent = `👥 ${juryName}`;
    }
  }

  juryInfo.style.display = 'block';
}

// Adapter l'interface selon le rôle
function adaptUIForRole(userRole) {
  if (userRole === 'jury') {
    // Afficher les noms des membres du jury
    displayJuryInfo();

    // Masquer le bouton "Ajouter un élève"
    const addBtn = document.getElementById('btn-add-eleve');
    if (addBtn) addBtn.style.display = 'none';

    // Adapter le menu de gestion pour les jurys
    const adminMenuBtn = document.getElementById('btn-admin-menu');
    const adminDropdown = document.getElementById('admin-dropdown');

    if (adminMenuBtn && adminDropdown) {
      // Changer le texte du bouton
      adminMenuBtn.innerHTML = '👤 Mon compte ▼';

      // Masquer les options admin uniquement
      document.getElementById('btn-manage-users')?.style.setProperty('display', 'none');
      document.getElementById('btn-manage-jury')?.style.setProperty('display', 'none');
      document.getElementById('btn-manage-projets')?.style.setProperty('display', 'none');
      document.getElementById('btn-print-recap')?.style.setProperty('display', 'none');
      document.getElementById('btn-manage-config')?.style.setProperty('display', 'none');

      // Masquer le séparateur avant la configuration
      const dividers = adminDropdown.querySelectorAll('.action-divider');
      dividers.forEach(divider => divider.style.display = 'none');
    }

    // Masquer la colonne filtre "Jury" pour les jurys (ils ne voient que leurs élèves)
    const juryHeader = document.querySelector('#eleves-table thead th:nth-child(5)');
    if (juryHeader) {
      juryHeader.style.display = 'none';
    }

    // Masquer aussi les cellules de la colonne Jury dans le tbody
    document.querySelectorAll('#eleves-tbody tr').forEach(row => {
      const juryCell = row.querySelector('td:nth-child(5)');
      if (juryCell) juryCell.style.display = 'none';
    });
  }
}

// ========== GESTION DU VERROUILLAGE DES ÉVALUATIONS ==========

let currentLockState = null;

// Charger l'état du verrouillage
async function loadLockState() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/evaluation-lock`, {
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Erreur lors du chargement du verrouillage');

    const data = await response.json();
    currentLockState = data;
    return data;
  } catch (error) {
    console.error('Erreur loading lock state:', error);
    return null;
  }
}

// Afficher l'état du verrouillage dans le modal
function displayLockStatus(lockData) {
  const statusDiv = document.getElementById('lock-status-display');
  if (!statusDiv) return;

  // Pour le jury: lockData contient directement les données du jury
  if (!lockData || !lockData.lockData) {
    statusDiv.innerHTML = '<p style="color: #718096; font-size: 0.875rem;">Aucun verrouillage actif</p>';
    return;
  }

  const juryLock = lockData.lockData;

  if (!juryLock.isLocked) {
    statusDiv.innerHTML = '<p style="color: #718096; font-size: 0.875rem;">Aucun verrouillage actif</p>';
    return;
  }

  const start = new Date(juryLock.startDate);
  const end = new Date(juryLock.endDate);
  const now = new Date();

  let statusText = '';
  let statusColor = '';

  if (juryLock.unlockedEarly) {
    statusText = '🔓 Débloqué anticipé';
    statusColor = '#48bb78';
  } else if (lockData.isLocked) {
    statusText = '🔒 Verrouillage actif';
    statusColor = '#e53e3e';
  } else if (now < start) {
    statusText = '⏳ Verrouillage programmé';
    statusColor = '#ed8936';
  } else if (now > end) {
    statusText = '✅ Période terminée';
    statusColor = '#48bb78';
  }

  statusDiv.innerHTML = `
    <div style="padding: 1rem; background: #f7fafc; border-left: 4px solid ${statusColor}; border-radius: 4px;">
      <p style="font-weight: 600; color: ${statusColor}; margin-bottom: 0.5rem;">${statusText}</p>
      <p style="font-size: 0.875rem; color: #4a5568; margin: 0;">
        Du ${start.toLocaleString('fr-FR')} au ${end.toLocaleString('fr-FR')}
      </p>
    </div>
  `;
}

// Définir la période de verrouillage
async function setLockPeriod() {
  const startInput = document.getElementById('modal-lock-start');
  const endInput = document.getElementById('modal-lock-end');

  if (!startInput.value || !endInput.value) {
    showMessage('Veuillez sélectionner les dates de début et de fin', 'error');
    return;
  }

  try {
    const response = await fetchWithCsrf(`${API_BASE}/evaluation-lock/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        startDate: startInput.value,
        endDate: endInput.value
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors de la définition du verrouillage');
    }

    await response.json();
    showMessage('Période de verrouillage activée avec succès', 'success');

    // Recharger l'état
    const lockData = await loadLockState();
    displayLockStatus(lockData);
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la définition du verrouillage', 'error');
  }
}

// Désactiver le verrouillage
async function disableLock() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/evaluation-lock/disable`, {
      method: 'POST',
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Erreur lors de la désactivation');

    showMessage('Verrouillage désactivé', 'success');

    // Recharger l'état
    const lockData = await loadLockState();
    displayLockStatus(lockData);

    // Vider les champs
    document.getElementById('modal-lock-start').value = '';
    document.getElementById('modal-lock-end').value = '';
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors de la désactivation du verrouillage', 'error');
  }
}

// Débloquer l'admin (jury uniquement)
async function unlockAdmin() {
  if (!confirm('Êtes-vous sûr de vouloir débloquer l\'accès admin maintenant ?\n\nCette action permettra à l\'administrateur d\'accéder aux évaluations avant la fin de la période prévue.')) {
    return;
  }

  try {
    const response = await fetchWithCsrf(`${API_BASE}/evaluation-lock/unlock`, {
      method: 'POST',
      credentials: 'include'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors du déblocage');
    }

    showMessage('Accès admin débloqué avec succès', 'success');

    // Recharger la page pour appliquer les changements
    setTimeout(() => window.location.reload(), 1500);
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors du déblocage', 'error');
  }
}

// Vérifier si les actions doivent être verrouillées pour un élève spécifique
function shouldLockAdminActionsForEleve(eleve) {
  if (!window.currentUser || window.currentUser.role !== 'admin') {
    return false;
  }

  if (!currentLockState || !currentLockState.lockData) {
    return false;
  }

  const eleveJury = eleve.jury; // 'jury1' ou 'jury2'
  if (!eleveJury) {
    return false;
  }

  const juryLock = currentLockState.lockData[eleveJury];

  if (!juryLock || !juryLock.isLocked || juryLock.unlockedEarly) {
    return false;
  }

  const now = new Date();
  const start = juryLock.startDate ? new Date(juryLock.startDate) : null;
  const end = juryLock.endDate ? new Date(juryLock.endDate) : null;

  if (!start || !end) {
    return false;
  }

  return now >= start && now <= end;
}

// Fonctions de gestion du modal verrouillage
function openLockModal() {
  document.getElementById('modal-manage-lock').classList.remove('hidden');
  loadLockState().then(displayLockStatus);
}

function closeLockModal() {
  document.getElementById('modal-manage-lock').classList.add('hidden');
}

// Initialisation
// Délégation d'événements pour le contenu généré dynamiquement
// (remplace les handlers inline onclick/onchange -> compatible CSP sans 'unsafe-inline')
function setupModalDelegation() {
  const projetsList = document.getElementById('projets-list');
  if (projetsList) {
    projetsList.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const id = el.dataset.id;
      switch (el.dataset.action) {
        case 'download-cdc-modal':
          window.location.href = `${API_BASE}/projets/${id}/cahier-charges`;
          break;
        case 'delete-cdc-modal':
          deleteCahierChargesFromModal(id, el.dataset.nom);
          break;
        case 'delete-projet-modal':
          deleteProjetFromModal(id, el.dataset.nom);
          break;
      }
    });
    projetsList.addEventListener('change', (e) => {
      const input = e.target.closest('[data-action="upload-cdc-modal"]');
      if (input) uploadCahierChargesFromModal(input.dataset.id, input);
    });
  }

  const usersList = document.getElementById('users-list');
  if (usersList) {
    usersList.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action="reset-password"]');
      if (el) resetUserPassword(el.dataset.username);
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Attendre la vérification d'authentification
  await new Promise(resolve => setTimeout(resolve, 100));

  setupModalDelegation();
  loadSettings();
  await loadProjets();
  await loadJuryMembers();

  // Adapter l'UI selon le rôle (après avoir chargé les membres du jury)
  if (window.currentUser) {
    adaptUIForRole(window.currentUser.role);
  }

  // Pour l'admin: charger l'état du verrouillage AVANT de charger les élèves
  if (window.currentUser && window.currentUser.role === 'admin') {
    await loadLockState();

    // Rafraîchir l'état du verrouillage toutes les 10 secondes
    setInterval(async () => {
      const previousState = JSON.stringify(currentLockState);
      await loadLockState();
      const newState = JSON.stringify(currentLockState);

      // Si l'état a changé, recharger les élèves pour mettre à jour l'affichage
      if (previousState !== newState) {
        console.log('Lock state changed, reloading students...');
        loadEleves();
      }
    }, 10000); // Vérifier toutes les 10 secondes
  }

  loadEleves();

  // Gestion du menu dropdown d'administration
  const adminMenuBtn = document.getElementById('btn-admin-menu');
  const adminDropdown = document.getElementById('admin-dropdown');

  if (adminMenuBtn && adminDropdown) {
    adminMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      adminDropdown.classList.toggle('show');
    });

    // Fermer le dropdown en cliquant ailleurs
    document.addEventListener('click', () => {
      adminDropdown.classList.remove('show');
    });

    // Empêcher la fermeture lors du clic à l'intérieur du dropdown pour les modals
    adminDropdown.addEventListener('click', (e) => {
      // Ne pas stopper la propagation si c'est un lien ou un bouton de redirection
      const target = e.target;
      if (target.id === 'btn-manage-projets' || target.id === 'btn-change-password') {
        // Laisser le clic se propager et la redirection se faire
        // Le dropdown se fermera automatiquement car la page change
        return;
      }
      // Pour les autres boutons (modals), empêcher la fermeture du dropdown
      e.stopPropagation();
    });
  }

  // Événement du bouton "Gestion des projets" (modal)
  document.getElementById('btn-manage-projets')?.addEventListener('click', openProjetsModal);

  // Événement du bouton "Changer mon mot de passe" (modal)
  document.getElementById('btn-change-password')?.addEventListener('click', openPasswordModal);

  // Événements du modal élève (ajout)
  document.getElementById('btn-add-eleve')?.addEventListener('click', openModal);
  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-submit-eleve')?.addEventListener('click', addEleve);

  // Fermer le modal élève en cliquant en dehors
  document.getElementById('modal-add-eleve')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-add-eleve') {
      closeModal();
    }
  });

  // Soumettre le formulaire élève avec Enter
  document.getElementById('form-add-eleve')?.addEventListener('submit', (e) => {
    e.preventDefault();
    addEleve();
  });

  // Événements du modal élève (modification)
  document.getElementById('btn-close-edit-modal')?.addEventListener('click', closeEditModal);
  document.getElementById('btn-cancel-edit-modal')?.addEventListener('click', closeEditModal);
  document.getElementById('btn-submit-edit-eleve')?.addEventListener('click', editEleve);

  // Fermer le modal de modification en cliquant en dehors
  document.getElementById('modal-edit-eleve')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-edit-eleve') {
      closeEditModal();
    }
  });

  // Soumettre le formulaire de modification avec Enter
  document.getElementById('form-edit-eleve')?.addEventListener('submit', (e) => {
    e.preventDefault();
    editEleve();
  });

  // Événements du modal jury
  document.getElementById('btn-manage-jury')?.addEventListener('click', openJuryModal);
  document.getElementById('btn-close-jury-modal')?.addEventListener('click', closeJuryModal);
  document.getElementById('btn-cancel-jury-modal')?.addEventListener('click', closeJuryModal);
  document.getElementById('btn-save-jury')?.addEventListener('click', saveJuryMembers);
  document.getElementById('btn-add-jury1-member')?.addEventListener('click', () => addJuryMember('jury1'));
  document.getElementById('btn-add-jury2-member')?.addEventListener('click', () => addJuryMember('jury2'));

  // Fermer le modal jury en cliquant en dehors
  document.getElementById('modal-manage-jury')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-manage-jury') {
      closeJuryModal();
    }
  });

  // Événements du modal utilisateurs
  document.getElementById('btn-manage-users')?.addEventListener('click', openUsersModal);
  document.getElementById('btn-close-users-modal')?.addEventListener('click', closeUsersModal);
  document.getElementById('btn-cancel-users-modal')?.addEventListener('click', closeUsersModal);

  // Fermer le modal utilisateurs en cliquant en dehors
  document.getElementById('modal-manage-users')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-manage-users') {
      closeUsersModal();
    }
  });

  // Événements du modal configuration
  document.getElementById('btn-manage-config')?.addEventListener('click', openConfigModal);
  document.getElementById('btn-close-config-modal')?.addEventListener('click', closeConfigModal);
  document.getElementById('btn-cancel-config-modal')?.addEventListener('click', closeConfigModal);
  document.getElementById('btn-save-config')?.addEventListener('click', saveConfig);

  // Fermer le modal configuration en cliquant en dehors
  document.getElementById('modal-manage-config')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-manage-config') {
      closeConfigModal();
    }
  });

  // Événements du modal changement de mot de passe
  document.getElementById('btn-close-password-modal')?.addEventListener('click', closePasswordModal);
  document.getElementById('btn-cancel-password-modal')?.addEventListener('click', closePasswordModal);
  document.getElementById('btn-save-password')?.addEventListener('click', savePassword);

  // Fermer le modal mot de passe en cliquant en dehors
  document.getElementById('modal-change-password')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-change-password') {
      closePasswordModal();
    }
  });

  // Événements du modal gestion des projets
  document.getElementById('btn-close-projets-modal')?.addEventListener('click', closeProjetsModal);
  document.getElementById('btn-cancel-projets-modal')?.addEventListener('click', closeProjetsModal);
  document.getElementById('btn-add-projet-modal')?.addEventListener('click', addProjetFromModal);

  // Fermer le modal projets en cliquant en dehors
  document.getElementById('modal-manage-projets')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-manage-projets') {
      closeProjetsModal();
    }
  });

  // Événements pour les filtres
  document.getElementById('filter-projet')?.addEventListener('change', applyFilters);
  document.getElementById('filter-jury')?.addEventListener('change', applyFilters);

  // Événements pour le verrouillage
  document.getElementById('btn-set-lock')?.addEventListener('click', setLockPeriod);
  document.getElementById('btn-unlock-admin')?.addEventListener('click', unlockAdmin);
  document.getElementById('btn-manage-lock')?.addEventListener('click', openLockModal);
  document.getElementById('btn-close-lock-modal')?.addEventListener('click', closeLockModal);
  document.getElementById('btn-cancel-lock-modal')?.addEventListener('click', closeLockModal);

  // Fermer le modal de verrouillage en cliquant en dehors
  document.getElementById('modal-manage-lock')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-manage-lock') {
      closeLockModal();
    }
  });

  // Pour le jury: afficher le bouton de gestion du verrouillage
  if (window.currentUser && window.currentUser.role === 'jury') {
    document.getElementById('btn-manage-lock')?.style.setProperty('display', 'block');
  }

  // Événement pour le bouton d'impression du tableau récapitulatif
  document.getElementById('btn-print-recap')?.addEventListener('click', printRecapitulatif);
});

// Fonction pour imprimer le tableau récapitulatif de la classe
async function printRecapitulatif() {
  try {
    // Vérifier que fetchWithCsrf est disponible
    if (typeof window.fetchWithCsrf !== 'function') {
      console.error('fetchWithCsrf n\'est pas défini');
      showMessage('Erreur : fonctions de sécurité non chargées. Veuillez rafraîchir la page.', 'error');
      return;
    }

    // Vérifier si un jury est en train d'évaluer (verrouillage actif)
    if (currentLockState && currentLockState.lockData) {
      const now = new Date();
      let lockActive = false;

      // Vérifier jury1
      if (currentLockState.lockData.jury1) {
        const jury1Lock = currentLockState.lockData.jury1;
        if (jury1Lock.isLocked && !jury1Lock.unlockedEarly) {
          const start = new Date(jury1Lock.startDate);
          const end = new Date(jury1Lock.endDate);
          if (now >= start && now <= end) {
            lockActive = true;
          }
        }
      }

      // Vérifier jury2
      if (currentLockState.lockData.jury2) {
        const jury2Lock = currentLockState.lockData.jury2;
        if (jury2Lock.isLocked && !jury2Lock.unlockedEarly) {
          const start = new Date(jury2Lock.startDate);
          const end = new Date(jury2Lock.endDate);
          if (now >= start && now <= end) {
            lockActive = true;
          }
        }
      }

      if (lockActive) {
        showMessage('Impossible d\'imprimer le tableau récapitulatif : un jury est actuellement en train d\'évaluer.', 'error');
        return;
      }
    }

    // Créer une référence locale à escapeHtml pour l'utiliser dans les templates
    const escapeHtmlFunc = window.escapeHtml || escapeHtml;

    // Récupérer les données de configuration
    const etablissement = document.getElementById('etablissement').value || 'Établissement';
    const academie = document.getElementById('academie').value || 'Académie';
    const session = document.getElementById('session').value || new Date().getFullYear();

    // Récupérer les membres des jurys
    let juryMembers = { jury1: [], jury2: [] };
    try {
      const juryResponse = await window.fetchWithCsrf(`${API_BASE}/jury-members`, {
        credentials: 'include'
      });
      if (juryResponse.ok) {
        juryMembers = await juryResponse.json();
      } else {
        console.error('Erreur HTTP lors de la récupération des jurys:', juryResponse.status);
      }
    } catch (error) {
      console.error('Erreur lors de la récupération des jurys:', error);
    }

    // Récupérer les notes depuis les évaluations
    function getNote(eleve, phase) {
      if (!eleve.evaluations || !eleve.evaluations[phase]) {
        return null;
      }
      return eleve.evaluations[phase].note_finale;
    }

    // Récupérer la note proposée ou calculer la moyenne
    function getMoyenne(eleve) {
      // Priorité à la note proposée au jury
      if (eleve.recapitulatif && eleve.recapitulatif.note_proposee != null) {
        return parseFloat(eleve.recapitulatif.note_proposee).toFixed(2);
      }

      // Sinon, calculer la moyenne
      const noteStage = parseFloat(getNote(eleve, 'stage')) || 0;
      const noteRevue3 = parseFloat(getNote(eleve, 'revue3')) || 0;
      const noteSoutenance = parseFloat(getNote(eleve, 'soutenance')) || 0;

      // Formule: (Stage×1 + Revue3×3 + Soutenance×3) / 7
      const moyenne = (noteStage * 1 + noteRevue3 * 3 + noteSoutenance * 3) / 7;
      return moyenne > 0 ? moyenne.toFixed(2) : '--';
    }

    // Construire le HTML pour l'impression
    let printHTML = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Tableau Récapitulatif - ${session}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 1.5cm 1cm;
          }
          @media print {
            /* Masquer l'URL et le titre dans l'en-tête/pied de page d'impression */
            @page {
              margin-top: 1cm;
              margin-bottom: 1cm;
            }
            body::before,
            body::after {
              display: none;
            }
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 9pt;
            margin: 0;
            padding: 10px;
          }
          .header {
            text-align: center;
            margin-bottom: 15px;
          }
          .header h1 {
            font-size: 14pt;
            margin: 3px 0;
          }
          .header p {
            margin: 2px 0;
            font-size: 9pt;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 8pt;
          }
          th, td {
            border: 1px solid #333;
            padding: 4px 3px;
            text-align: center;
          }
          th {
            background-color: #667eea;
            color: white;
            font-weight: bold;
            font-size: 8pt;
          }
          tr:nth-child(even) {
            background-color: #f8f9fa;
          }
          .text-left {
            text-align: left;
          }
          .num-col {
            width: 30px;
          }
          .nom-col {
            width: 100px;
          }
          .prenom-col {
            width: 80px;
          }
          .note-col {
            width: 50px;
          }
          .moyenne-col {
            width: 55px;
            font-weight: bold;
          }
          .footer {
            margin-top: 15px;
            font-size: 7pt;
            color: #666;
          }
          .jury-signatures {
            margin-top: 20px;
            page-break-inside: avoid;
            border-top: 1px solid #ccc;
            padding-top: 10px;
          }
          .jury-title {
            font-size: 9pt;
            font-weight: bold;
            margin-bottom: 8px;
            text-align: center;
          }
          .signatures-container {
            display: flex;
            justify-content: space-around;
            gap: 10px;
          }
          .signature-box {
            text-align: center;
            flex: 1;
          }
          .signature-line {
            margin-top: 25px;
            border-bottom: 1px solid #333;
            width: 80%;
            margin-left: auto;
            margin-right: auto;
          }
          .member-info {
            font-size: 7pt;
            margin-top: 3px;
          }
          .member-name {
            font-weight: bold;
          }
          .member-qualite {
            color: #666;
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>BTS CIEL - Épreuve E6</h1>
          <p><strong>${escapeHtmlFunc(etablissement)}</strong> - ${escapeHtmlFunc(academie)}</p>
          <p>Session ${escapeHtmlFunc(session)}</p>
          <p style="margin-top: 10px;"><strong>Tableau Récapitulatif des Notes</strong></p>
        </div>

        <table>
          <thead>
            <tr>
              <th class="num-col">N°</th>
              <th class="text-left nom-col">NOM</th>
              <th class="text-left prenom-col">PRÉNOM</th>
              <th class="note-col">Stage<br>(×1)</th>
              <th class="note-col">Revue 3<br>(×3)</th>
              <th class="note-col">Soutenance<br>(×3)</th>
              <th class="moyenne-col">Moyenne<br>/20</th>
            </tr>
          </thead>
          <tbody>
    `;

    // Trier les élèves par nom
    const sortedEleves = [...allEleves].sort((a, b) => {
      const nomA = (a.nom || '').toLowerCase();
      const nomB = (b.nom || '').toLowerCase();
      return nomA.localeCompare(nomB);
    });

    // Ajouter chaque élève au tableau
    sortedEleves.forEach((eleve, index) => {
      const noteStage = getNote(eleve, 'stage') || '--';
      const noteRevue3 = getNote(eleve, 'revue3') || '--';
      const noteSoutenance = getNote(eleve, 'soutenance') || '--';
      const moyenne = getMoyenne(eleve);

      printHTML += `
        <tr>
          <td>${index + 1}</td>
          <td class="text-left">${escapeHtmlFunc(eleve.nom || '')}</td>
          <td class="text-left">${escapeHtmlFunc(eleve.prenom || '')}</td>
          <td>${noteStage}</td>
          <td>${noteRevue3}</td>
          <td>${noteSoutenance}</td>
          <td><strong>${moyenne}</strong></td>
        </tr>
      `;
    });

    printHTML += `
          </tbody>
        </table>

        <div class="jury-signatures">
          <div class="jury-title">Signatures des membres des jurys</div>
          <div class="signatures-container">
    `;

    // Collecter tous les membres valides des deux jurys
    const allMembers = [];

    if (juryMembers.jury1) {
      juryMembers.jury1.forEach(m => {
        if (m.nom && m.prenom) {
          allMembers.push({ ...m, jury: 'Jury 1' });
        }
      });
    }

    if (juryMembers.jury2) {
      juryMembers.jury2.forEach(m => {
        if (m.nom && m.prenom) {
          allMembers.push({ ...m, jury: 'Jury 2' });
        }
      });
    }

    // Ajouter chaque membre sur la même ligne
    allMembers.forEach(member => {
      printHTML += `
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="member-info">
            <div class="member-name">${escapeHtmlFunc(member.prenom)} ${escapeHtmlFunc(member.nom)}</div>
            <div class="member-qualite">${escapeHtmlFunc(member.qualite || '')} - ${member.jury}</div>
          </div>
        </div>
      `;
    });

    printHTML += `
          </div>
        </div>

        <div class="footer">
          <p>Formule de calcul : Moyenne = (Note Stage × 1 + Note Revue 3 × 3 + Note Soutenance × 3) / 7</p>
          <p>Document généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
        </div>
      </body>
      </html>
    `;

    // Ouvrir une nouvelle fenêtre pour l'impression
    const printWindow = window.open('', '_blank');

    // Vérifier que la fenêtre a bien été ouverte (pas bloquée par le navigateur)
    if (!printWindow) {
      showMessage('Impossible d\'ouvrir la fenêtre d\'impression. Veuillez autoriser les popups pour ce site.', 'error');
      return;
    }

    printWindow.document.write(printHTML);
    printWindow.document.close();

    // Attendre que le document soit chargé puis lancer l'impression
    printWindow.onload = function() {
      printWindow.print();
    };

  } catch (error) {
    console.error('Erreur lors de la génération du tableau récapitulatif:', error);
    showMessage('Erreur lors de la génération du tableau', 'error');
  }
}
