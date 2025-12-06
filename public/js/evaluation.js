// Utilise les fonctions communes depuis utils.js
const API_BASE = window.API_BASE;
const showMessage = window.showMessage;

let currentEleve = null;
let currentMapping = null;
let currentSemestre = null;
let observablesData = null;

// Récupérer l'ID de l'élève depuis l'URL
const eleveId = window.location.pathname.split('/').pop();

// Charger les observables depuis l'API
async function loadObservables() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/observables`);
    if (!response.ok) throw new Error('Observables non trouvés');
    observablesData = await response.json();
  } catch (error) {
    console.error('Erreur lors du chargement des observables:', error);
    observablesData = null;
  }
}

// Charger les informations de l'élève
async function loadEleve() {
  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}`);
    if (!response.ok) throw new Error('Élève non trouvé');

    currentEleve = await response.json();
    document.getElementById('eleve-info').textContent =
      `${currentEleve.prenom} ${currentEleve.nom} - ${currentEleve.promotion || currentEleve.classe || ''}`;

    // Vérifier si le fichier Excel existe
    checkExcelFile();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors du chargement des informations de l\'élève', 'error');
  }
}

// Vérifier si le fichier Excel existe pour activer le bouton de téléchargement
async function checkExcelFile() {
  if (!currentEleve) {
    console.warn('currentEleve non chargé');
    return;
  }

  const filename = `${currentEleve.nom}_${currentEleve.prenom}_Evaluation.xlsx`;
  try {
    const response = await fetchWithCsrf(`${API_BASE}/download/${filename}`, { method: 'HEAD' });
    const downloadBtn = document.getElementById('btn-download');
    downloadBtn.disabled = !response.ok;
  } catch (error) {
    console.error('Fichier Excel non trouvé');
  }
}

// Charger le mapping d'une évaluation
async function loadEvaluationMapping(semestre) {
  try {
    // Vérifier les permissions de l'utilisateur
    const user = await waitForCurrentUser();
    const isJury = user && user.role === 'jury';
    if (isJury && semestre !== 'soutenance') {
      showMessage('Accès refusé - Le jury n\'a accès qu\'aux évaluations de soutenance', 'error');
      document.getElementById('evaluation-form-container').classList.add('hidden');
      document.getElementById('semestre-select').value = '';
      return;
    }

    const response = await fetchWithCsrf(`${API_BASE}/mapping/evaluation/${semestre}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur inconnue' }));
      throw new Error(errorData.error || 'Mapping non trouvé');
    }

    currentMapping = await response.json();
    currentSemestre = semestre;

    // Afficher le formulaire d'évaluation
    displayEvaluationForm();

    // Charger les données existantes si disponibles
    loadExistingData();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors du chargement du mapping', 'error');
    document.getElementById('evaluation-form-container').classList.add('hidden');
  }
}

// Afficher le formulaire d'évaluation
function displayEvaluationForm() {
  const formContainer = document.getElementById('evaluation-form-container');
  const title = document.getElementById('evaluation-title');
  const competencesContainer = document.getElementById('competences-container');

  title.textContent = `Grille d'évaluation - ${currentMapping.nom}`;
  competencesContainer.innerHTML = '';

  // Générer les sections de compétences
  // Nouvelle structure: mapping.competences est un objet avec des clés C01, C03, C08...
  for (const [compCode, compData] of Object.entries(currentMapping.competences)) {
    const section = createCompetenceSection(compCode, compData);
    competencesContainer.appendChild(section);
  }

  // Ajouter les champs supplémentaires si présents (spécifique au stage)
  if (currentMapping.champs_supplementaires) {
    const champsSection = createChampsSupplementairesSection(currentMapping.champs_supplementaires);
    competencesContainer.appendChild(champsSection);
  }

  formContainer.classList.remove('hidden');
}

// Mapper le nom du semestre au format du fichier observables.json
function getSemestreKey(semestre) {
  const mapping = {
    'stage': 'stage',
    'revue1': 'revue1',
    'revue2': 'revue2',
    'revue3': 'revue3',
    'soutenance': 'soutenance'
  };
  return mapping[semestre] || semestre;
}

// Créer un élément tooltip avec les observables
function createTooltip(observables) {
  const wrapper = document.createElement('span');
  wrapper.className = 'tooltip-wrapper';

  const icon = document.createElement('span');
  icon.className = 'info-icon';
  icon.textContent = 'i';
  wrapper.appendChild(icon);

  const content = document.createElement('div');
  content.className = 'tooltip-content';

  const strong = document.createElement('strong');
  strong.textContent = 'Observables :';
  content.appendChild(strong);

  const ul = document.createElement('ul');
  observables.forEach(observable => {
    const li = document.createElement('li');
    li.textContent = observable;
    ul.appendChild(li);
  });

  content.appendChild(ul);
  wrapper.appendChild(content);

  // Détection automatique de la position pour éviter le débordement
  icon.addEventListener('mouseenter', () => {
    const rect = wrapper.getBoundingClientRect();
    const tooltipHeight = 400; // Hauteur estimée du tooltip
    const spaceAbove = rect.top;

    // Si pas assez d'espace en haut, afficher en bas
    if (spaceAbove < tooltipHeight) {
      content.classList.add('tooltip-bottom');
    } else {
      content.classList.remove('tooltip-bottom');
    }
  });

  return wrapper;
}

// Créer une section de compétence avec format tableau
function createCompetenceSection(compCode, compData) {
  const section = document.createElement('div');
  section.className = 'competence-section';

  // En-tête de la compétence
  const header = document.createElement('div');
  header.className = 'competence-header';
  header.innerHTML = `
    <h3>${compCode} : ${compData.nom}</h3>
  `;
  section.appendChild(header);

  // Table des critères
  const table = document.createElement('table');
  table.className = 'table-criteres';

  // Utiliser les labels du mapping
  const niveaux = currentMapping.niveaux;

  // En-tête du tableau
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Critère</th>
      <th class="niveau-col">${niveaux.niveau_1.label}</th>
      <th class="niveau-col">${niveaux.niveau_2.label}</th>
      <th class="niveau-col">${niveaux.niveau_3.label}</th>
      <th class="niveau-col">${niveaux.niveau_4.label}</th>
    </tr>
  `;
  table.appendChild(thead);

  // Corps du tableau
  const tbody = document.createElement('tbody');

  compData.criteres.forEach(critere => {
    const tr = document.createElement('tr');

    // Récupérer le niveau actuel si disponible
    let niveauActuel = null;
    if (currentEleve.evaluations && currentEleve.evaluations[currentSemestre]) {
      const critereData = currentEleve.evaluations[currentSemestre][critere.id];
      if (critereData && critereData.niveau !== undefined) {
        niveauActuel = critereData.niveau;
      }
    }

    // Créer le texte du critère avec tooltip si disponible
    const critereCell = document.createElement('td');
    critereCell.className = 'critere-nom';

    const critereText = document.createElement('span');
    critereText.textContent = critere.texte;
    critereCell.appendChild(critereText);

    // Ajouter le tooltip si les observables sont disponibles
    if (observablesData && currentSemestre) {
      const semestreKey = getSemestreKey(currentSemestre);
      const observables = observablesData[semestreKey]?.[critere.id];

      if (observables && observables.length > 0) {
        const tooltipWrapper = createTooltip(observables);
        critereCell.appendChild(tooltipWrapper);
      }
    }

    tr.appendChild(critereCell);

    // Ajouter les cellules de niveaux
    for (let i = 1; i <= 4; i++) {
      const td = document.createElement('td');
      td.className = 'niveau-cell';
      td.innerHTML = `
        <input type="radio" name="${critere.id}" value="${i}"
          ${niveauActuel === i ? 'checked' : ''}>
      `;
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  section.appendChild(table);

  return section;
}

// Créer la section des champs supplémentaires (bonus et note finale pour le stage)
function createChampsSupplementairesSection(champsData) {
  const section = document.createElement('div');
  section.className = 'champs-supplementaires-section';

  const header = document.createElement('div');
  header.className = 'champs-header';
  header.innerHTML = '<h3>Évaluation finale</h3>';
  section.appendChild(header);

  const container = document.createElement('div');
  container.className = 'champs-container';

  // Afficher la note calculée (lecture seule)
  if (champsData.note_calculee) {
    const noteCalculeeDiv = document.createElement('div');
    noteCalculeeDiv.className = 'champ-item';
    noteCalculeeDiv.innerHTML = `
      <label for="note_calculee">${champsData.note_calculee.label}:</label>
      <input type="text" id="note_calculee" name="note_calculee" readonly value="--" placeholder="Calculée automatiquement">
      <small style="color: #78350f; display: block; margin-top: 0.25rem; font-style: italic;">
        La note sera affichée automatiquement après avoir finalisé l'évaluation.
      </small>
    `;
    container.appendChild(noteCalculeeDiv);
  }

  if (champsData.bonus) {
    const bonusDiv = document.createElement('div');
    bonusDiv.className = 'champ-item';
    bonusDiv.innerHTML = `
      <label for="bonus">${champsData.bonus.label}:</label>
      <input type="number" id="bonus" name="bonus" min="0" max="${champsData.bonus.max}" step="0.5" value="0">
    `;
    container.appendChild(bonusDiv);
  }

  if (champsData.note_finale) {
    const noteFinalDiv = document.createElement('div');
    noteFinalDiv.className = 'champ-item';
    noteFinalDiv.innerHTML = `
      <label for="note_finale">${champsData.note_finale.label}:</label>
      <input type="number" id="note_finale" name="note_finale" min="0" max="20" step="0.5">
    `;
    container.appendChild(noteFinalDiv);
  }

  section.appendChild(container);
  return section;
}

// Charger la note calculée depuis l'Excel
async function loadNoteCalculee() {
  if (!currentMapping.champs_supplementaires || !currentMapping.champs_supplementaires.note_calculee) {
    return;
  }

  try {
    const url = `${API_BASE}/eleves/${eleveId}/note-calculee/${currentSemestre}`;
    const response = await fetchWithCsrf(url);

    if (!response.ok) {
      return;
    }

    const result = await response.json();
    const noteCalculeeElem = document.getElementById('note_calculee');

    if (noteCalculeeElem && result.note_calculee !== null && result.note_calculee !== undefined) {
      noteCalculeeElem.value = result.note_calculee;
    }
  } catch (error) {
    console.error('Erreur lors du chargement de la note calculée:', error);
  }
}

// Charger les données existantes
function loadExistingData() {
  if (!currentEleve.evaluations || !currentEleve.evaluations[currentSemestre]) {
    return;
  }

  const data = currentEleve.evaluations[currentSemestre];

  // Remplir les critères
  Object.keys(data).forEach(key => {
    if (key === 'commentaireGeneral') {
      const elem = document.getElementById('commentaire-general');
      if (elem) elem.value = data[key] || '';
      return;
    }

    if (key === 'bonus') {
      const elem = document.getElementById('bonus');
      if (elem) elem.value = data[key] || 0;
      return;
    }

    if (key === 'note_finale') {
      const elem = document.getElementById('note_finale');
      if (elem) elem.value = data[key] || '';
      return;
    }

    const critereData = data[key];
    if (critereData && critereData.niveau !== undefined) {
      // Remplir le niveau
      const radio = document.querySelector(`input[name="${key}_niveau"][value="${critereData.niveau}"]`);
      if (radio) radio.checked = true;
    }
  });

  // Charger la note calculée depuis l'Excel
  loadNoteCalculee();

  showMessage('Données existantes chargées', 'info');
}

// Collecter les données du formulaire
function collectFormData() {
  const data = {};

  // Collecter les données de chaque critère
  for (const [compCode, compData] of Object.entries(currentMapping.competences)) {
    compData.criteres.forEach(critere => {
      const niveauRadio = document.querySelector(`input[name="${critere.id}"]:checked`);

      data[critere.id] = {
        niveau: niveauRadio ? parseInt(niveauRadio.value) : null
      };
    });
  }

  // Ajouter le commentaire général
  const commentaireGeneralElem = document.getElementById('commentaire-general');
  if (commentaireGeneralElem) {
    data.commentaireGeneral = commentaireGeneralElem.value;
  }

  // Ajouter les champs supplémentaires (bonus et note finale pour le stage)
  const bonusElem = document.getElementById('bonus');
  if (bonusElem) {
    data.bonus = parseFloat(bonusElem.value) || 0;
  }

  const noteFinalElem = document.getElementById('note_finale');
  if (noteFinalElem) {
    data.note_finale = parseFloat(noteFinalElem.value) || null;
  }

  return data;
}

// Sauvegarder en brouillon
async function saveDraft() {
  const btn = document.getElementById('btn-save-draft');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Sauvegarde...';

  const data = collectFormData();

  try {
    const response = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        semestre: currentSemestre,
        data: data
      })
    });

    if (!response.ok) throw new Error('Erreur lors de la sauvegarde');

    const result = await response.json();
    showMessage('Brouillon sauvegardé avec succès', 'success');

    // Recharger l'élève pour mettre à jour les données
    await loadEleve();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage('Erreur lors de la sauvegarde du brouillon', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Valider que tous les critères ont été remplis
function validateEvaluation() {
  const missingCriteria = [];

  // Vérifier chaque critère
  for (const [compCode, compData] of Object.entries(currentMapping.competences)) {
    compData.criteres.forEach(critere => {
      const niveauRadio = document.querySelector(`input[name="${critere.id}"]:checked`);

      if (!niveauRadio || niveauRadio.value === null || niveauRadio.value === '') {
        missingCriteria.push({
          competence: compData.nom,
          critere: critere.nom
        });
      }
    });
  }

  return missingCriteria;
}

// Finaliser et remplir Excel
async function finalize() {
  // Valider l'évaluation avant de continuer
  const missingCriteria = validateEvaluation();

  if (missingCriteria.length > 0) {
    let errorMessage = '⚠️ Évaluation incomplète !\n\nLes critères suivants n\'ont pas été évalués :\n\n';

    missingCriteria.forEach((item, index) => {
      errorMessage += `${index + 1}. ${item.competence} - ${item.critere}\n`;
    });

    errorMessage += '\n✋ Veuillez remplir tous les critères avant de finaliser l\'évaluation.';

    // Afficher un message d'erreur visuel
    showMessage('Évaluation incomplète : certains critères n\'ont pas été évalués', 'error');

    // Afficher une alerte avec la liste détaillée
    alert(errorMessage);

    return; // Arrêter la finalisation
  }

  const btn = document.getElementById('btn-finalize');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Finalisation...';

  // D'abord sauvegarder les données
  const data = collectFormData();

  try {
    // Sauvegarder les données
    const saveResponse = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        semestre: currentSemestre,
        data: data
      })
    });

    if (!saveResponse.ok) throw new Error('Erreur lors de la sauvegarde');

    // Remplir le fichier Excel
    const excelResponse = await fetchWithCsrf(`${API_BASE}/eleves/${eleveId}/remplir-excel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        semestre: currentSemestre
      })
    });

    if (!excelResponse.ok) {
      const error = await excelResponse.json();
      throw new Error(error.error || 'Erreur lors du remplissage Excel');
    }

    const result = await excelResponse.json();
    showMessage('Évaluation finalisée et Excel rempli avec succès !', 'success');

    // Activer le bouton de téléchargement
    document.getElementById('btn-download').disabled = false;

    // Rafraîchir la note calculée depuis l'Excel
    await loadNoteCalculee();

    // Recharger l'élève
    await loadEleve();
  } catch (error) {
    console.error('Erreur:', error);
    showMessage(error.message || 'Erreur lors de la finalisation', 'error');
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

// Événement de changement de semestre
document.getElementById('semestre-select').addEventListener('change', (e) => {
  const semestre = e.target.value;
  if (semestre) {
    loadEvaluationMapping(semestre);
  } else {
    document.getElementById('evaluation-form-container').classList.add('hidden');
  }
});

// Événements des boutons
document.getElementById('btn-save-draft').addEventListener('click', saveDraft);
document.getElementById('btn-finalize').addEventListener('click', finalize);
document.getElementById('btn-download').addEventListener('click', downloadExcel);

// Attendre que window.currentUser soit disponible
async function waitForCurrentUser(maxAttempts = 20, intervalMs = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    if (window.currentUser !== null && window.currentUser !== undefined) {
      return window.currentUser;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  // Fallback: vérifier directement via l'API
  try {
    const response = await fetchWithCsrf(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (response.ok) {
      const data = await response.json();
      window.currentUser = data.user;
      return data.user;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'utilisateur:', error);
  }
  return null;
}

// Filtrer les options du dropdown selon le rôle de l'utilisateur
async function filterEvaluationOptions() {
  // Attendre que currentUser soit chargé
  const user = await waitForCurrentUser();

  const semestreSelect = document.getElementById('semestre-select');
  const isJury = user && user.role === 'jury';

  if (isJury) {
    // Pour le jury, ne garder que l'option soutenance
    const allOptions = semestreSelect.querySelectorAll('option');
    allOptions.forEach(option => {
      if (option.value && option.value !== 'soutenance') {
        option.remove();
      }
    });
  }
}

// Initialisation
document.addEventListener('DOMContentLoaded', async () => {
  // Charger les observables en premier
  await loadObservables();

  // Filtrer immédiatement les options selon le rôle
  filterEvaluationOptions();

  // Charger les données de l'élève
  await loadEleve();

  // Pré-sélectionner le semestre depuis l'URL si présent
  const urlParams = new URLSearchParams(window.location.search);
  const semestreFromUrl = urlParams.get('semestre');
  if (semestreFromUrl) {
    const semestreSelect = document.getElementById('semestre-select');

    // Vérifier que l'option existe (elle pourrait avoir été supprimée pour le jury)
    const optionExists = Array.from(semestreSelect.options).some(opt => opt.value === semestreFromUrl);

    if (optionExists) {
      semestreSelect.value = semestreFromUrl;
      loadEvaluationMapping(semestreFromUrl);
    } else {
      showMessage('Vous n\'avez pas accès à cette évaluation', 'error');
    }
  }
});
