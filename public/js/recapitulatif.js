// Utilise les fonctions communes depuis utils.js
const API_BASE = window.API_BASE;
const showMessage = window.showMessage;

let currentEleve = null;
let juryMembers = { jury1: [], jury2: [] };

// Récupérer l'ID de l'élève depuis l'URL
const eleveId = window.location.pathname.split('/').pop();

// Charger les informations de l'élève
async function loadEleve() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}`);
    if (!response.ok) throw new Error('Élève non trouvé');

    currentEleve = await response.json();
    document.getElementById('eleve-info').textContent =
      `${currentEleve.prenom} ${currentEleve.nom} - ${currentEleve.promotion || currentEleve.classe || ''}`;

    // Charger les notes des évaluations
    await loadNotesEvaluations();

    // Charger les membres du jury
    await loadJuryMembers();

    // Afficher les membres du jury correspondant
    displayJuryMembers();

    // Charger les données du récapitulatif
    loadRecapData();

    // Vérifier si le fichier Excel existe
    checkExcelFile();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors du chargement des informations de l\'élève', 'error');
  }
}

// Vérifier si le fichier Excel existe
async function checkExcelFile() {
  const filename = `${currentEleve.nom}_${currentEleve.prenom}_Evaluation.xlsx`;
  try {
    const response = await fetchWithCsrf(`${API_BASE}/download/${filename}`, { method: 'HEAD' });
    const downloadBtn = document.getElementById('btn-download');
    downloadBtn.disabled = !response.ok;
  } catch (error) {
    console.error('Fichier Excel non trouvé');
  }
}

// Charger les notes finales des 3 évaluations principales
async function loadNotesEvaluations() {
  const evaluations = {
    stage: { noteElem: 'note-stage', statutElem: 'statut-stage' },
    revue3: { noteElem: 'note-revue3', statutElem: 'statut-revue3' },
    soutenance: { noteElem: 'note-soutenance', statutElem: 'statut-soutenance' }
  };

  for (const [semestre, config] of Object.entries(evaluations)) {
    const noteElem = document.getElementById(config.noteElem);
    const statutElem = document.getElementById(config.statutElem);

    if (currentEleve.evaluations && currentEleve.evaluations[semestre]) {
      const evalData = currentEleve.evaluations[semestre];

      // Vérifier si une note finale a été proposée
      if (evalData.note_finale !== undefined && evalData.note_finale !== null) {
        noteElem.textContent = evalData.note_finale;
        statutElem.innerHTML = '<span class="badge success">Finalisé</span>';
      } else {
        noteElem.textContent = '--';
        statutElem.innerHTML = '<span class="badge warning">Non finalisé</span>';
      }
    } else {
      noteElem.textContent = '--';
      statutElem.innerHTML = '<span class="badge warning">Non évalué</span>';
    }
  }

  // Calculer la note récapitulative
  calculerNoteRecap();
}

// Calculer la note récapitulative
function calculerNoteRecap() {
  const noteStage = parseFloat(document.getElementById('note-stage').textContent);
  const noteRevue3 = parseFloat(document.getElementById('note-revue3').textContent);
  const noteSoutenance = parseFloat(document.getElementById('note-soutenance').textContent);

  if (!isNaN(noteStage) && !isNaN(noteRevue3) && !isNaN(noteSoutenance)) {
    const noteCalculee = (noteStage * 1 + noteRevue3 * 3 + noteSoutenance * 3) / 7;
    document.getElementById('note-calculee-recap').value = noteCalculee.toFixed(2);
  } else {
    document.getElementById('note-calculee-recap').value = '--';
  }
}

// Charger les données du récapitulatif
function loadRecapData() {
  if (!currentEleve.recapitulatif) {
    return;
  }

  const recap = currentEleve.recapitulatif;

  // Note proposée au jury
  if (recap.note_proposee !== undefined && recap.note_proposee !== null) {
    document.getElementById('note-proposee-jury').value = recap.note_proposee;
  }

  // Commentaires
  if (recap.commentaires) {
    document.getElementById('commentaires-jury').value = recap.commentaires;
  }
}

// Sauvegarder les données du récapitulatif
async function saveRecap() {
  const btn = document.getElementById('btn-save-recap');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Sauvegarde...';

  const data = {
    note_proposee: parseFloat(document.getElementById('note-proposee-jury').value) || null,
    commentaires: document.getElementById('commentaires-jury').value || ''
  };

  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/recapitulatif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) throw new Error('Erreur lors de la sauvegarde');

    showMessage('Récapitulatif sauvegardé avec succès', 'success');

    // Recharger l'élève
    await loadEleve();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors de la sauvegarde du récapitulatif', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Générer Excel complet en un seul chargement (67% moins de RAM)
async function generateCompleteExcel() {
  const btn = document.getElementById('btn-generer-excel-optimise');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Génération...';

  // D'abord sauvegarder les données du récapitulatif
  const data = {
    note_proposee: parseFloat(document.getElementById('note-proposee-jury').value) || null,
    commentaires: document.getElementById('commentaires-jury').value || ''
  };

  try {
    // Sauvegarder les données du récapitulatif
    const saveResponse = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/recapitulatif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!saveResponse.ok) throw new Error('Erreur lors de la sauvegarde');

    // Générer l'Excel complet en UNE SEULE opération (identité + évaluations + récap)
    const excelData = {
      academie: localStorage.getItem('academie') || '',
      etablissement: localStorage.getItem('etablissement') || '',
      session: localStorage.getItem('session') || ''
    };

    const excelResponse = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/generer-excel-complet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(excelData)
    });

    if (!excelResponse.ok) {
      const error = await excelResponse.json();
      throw new Error(error.error || 'Erreur lors de la génération Excel');
    }

    const result = await excelResponse.json();

    showMessage('✅ Excel complet généré avec succès ! (Version optimisée - économie de RAM)', 'success');

    // Activer le bouton de téléchargement
    document.getElementById('btn-download').disabled = false;

    // Recharger l'élève
    await loadEleve();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la génération Excel', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Télécharger le fichier Excel
function downloadExcel() {
  const filename = `${currentEleve.nom}_${currentEleve.prenom}_Evaluation.xlsx`;
  window.location.href = `${API_BASE}/download/${filename}`;
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

// Afficher les membres du jury correspondant à l'élève
function displayJuryMembers() {
  const container = document.getElementById('jury-members-display');

  if (!currentEleve || !currentEleve.jury) {
    container.innerHTML = '<p style="color: #e53e3e; font-style: italic;">⚠️ Aucun jury assigné à cet élève</p>';
    return;
  }

  const members = juryMembers[currentEleve.jury] || [];

  if (members.length === 0) {
    container.innerHTML = '<p style="color: #e53e3e; font-style: italic;">⚠️ Aucun membre configuré pour ce jury. Veuillez configurer les membres du jury dans la page principale.</p>';
    return;
  }

  // Filtrer les membres vides
  const validMembers = members.filter(m => m.nom || m.prenom || m.qualite);

  if (validMembers.length === 0) {
    container.innerHTML = '<p style="color: #e53e3e; font-style: italic;">⚠️ Aucun membre valide configuré pour ce jury.</p>';
    return;
  }

  container.innerHTML = `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #f7fafc; border-bottom: 2px solid #e2e8f0;">
          <th style="padding: 0.75rem; text-align: left; font-weight: 600;">Nom</th>
          <th style="padding: 0.75rem; text-align: left; font-weight: 600;">Prénom</th>
          <th style="padding: 0.75rem; text-align: left; font-weight: 600;">Qualité</th>
        </tr>
      </thead>
      <tbody>
        ${validMembers.map(member => `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 0.75rem;">${member.nom || '-'}</td>
            <td style="padding: 0.75rem;">${member.prenom || '-'}</td>
            <td style="padding: 0.75rem;">${member.qualite || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="margin-top: 1rem; color: #667eea; font-weight: 500;">
      Jury assigné: ${currentEleve.jury === 'jury1' ? 'Jury 1' : 'Jury 2'}
    </p>
  `;
}

// Adapter l'interface selon le rôle de l'utilisateur
async function adaptUIForRole() {
  // Attendre que l'utilisateur soit chargé
  let attempts = 0;
  while (!window.currentUser && attempts < 20) {
    await new Promise(resolve => setTimeout(resolve, 50));
    attempts++;
  }

  if (window.currentUser && window.currentUser.role === 'jury') {
    // Masquer les boutons réservés à l'admin pour les jurys
    const downloadBtn = document.getElementById('btn-download');
    if (downloadBtn) {
      downloadBtn.style.display = 'none';
    }

    const btnGenererExcelOptimise = document.getElementById('btn-generer-excel-optimise');
    if (btnGenererExcelOptimise) {
      btnGenererExcelOptimise.style.display = 'none';
    }
  }
}

// Événements des boutons
document.getElementById('btn-save-recap').addEventListener('click', saveRecap);
document.getElementById('btn-generer-excel-optimise').addEventListener('click', generateCompleteExcel);
document.getElementById('btn-download').addEventListener('click', downloadExcel);

// Note: Les paramètres établissement, académie et session sont désormais
// gérés centralement dans la configuration établissement (localStorage)

// Initialisation
document.addEventListener('DOMContentLoaded', async () => {
  await adaptUIForRole();
  loadEleve();
});
