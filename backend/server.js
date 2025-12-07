require('dotenv').config();

const express = require('express');
const https = require('https');
const fsSync = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs').promises;
const XlsxPopulate = require('xlsx-populate');
const multer = require('multer');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');

const app = express();
const PORT = process.env.PORT || 3001;

// Vérifier que SESSION_SECRET est défini dans .env
if (!process.env.SESSION_SECRET) {
  console.error('❌ ERREUR CRITIQUE: SESSION_SECRET n\'est pas défini dans le fichier .env');
  console.error('   Veuillez créer un fichier .env avec SESSION_SECRET=<votre_secret_sécurisé>');
  console.error('   Exemple: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const SESSION_SECRET = process.env.SESSION_SECRET;

// Mutex pour éviter les écritures concurrentes sur les fichiers Excel
const excelLocks = new Map();
let activeExcelOperations = 0;
const MAX_CONCURRENT_EXCEL_OPERATIONS = 4; // 2 jurys × 2 opérations max par jury
const LOCK_TIMEOUT = 30000; // Timeout de 30 secondes pour éviter les blocages infinis

// Fonction pour acquérir un verrou sur un fichier Excel
async function acquireExcelLock(filename) {
  const startTime = Date.now();

  // Attendre qu'il y ait moins de 4 opérations Excel en cours
  while (activeExcelOperations >= MAX_CONCURRENT_EXCEL_OPERATIONS) {
    if (Date.now() - startTime > LOCK_TIMEOUT) {
      throw new Error('Timeout: Trop d\'opérations Excel en cours. Veuillez réessayer dans quelques instants.');
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Attendre que le fichier spécifique soit libre
  const fileStartTime = Date.now();
  while (excelLocks.get(filename)) {
    if (Date.now() - fileStartTime > LOCK_TIMEOUT) {
      throw new Error('Timeout: Le fichier Excel est déjà en cours de modification. Veuillez réessayer dans quelques instants.');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  activeExcelOperations++;
  excelLocks.set(filename, { locked: true, timestamp: Date.now() });
}

// Fonction pour libérer un verrou sur un fichier Excel
function releaseExcelLock(filename) {
  excelLocks.delete(filename);
  activeExcelOperations--;
  if (activeExcelOperations < 0) activeExcelOperations = 0;
}

// Configuration de Helmet pour la sécurité des headers HTTP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting global - Adapté pour 2 jurys simultanés
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 2 jurys × ~10 élèves × ~25 requêtes par élève = 500 requêtes
  message: 'Trop de requêtes, veuillez réessayer plus tard'
});

// Rate limiting strict pour le login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limite à 5 tentatives de connexion
  message: 'Trop de tentatives de connexion, veuillez réessayer dans 15 minutes',
  skipSuccessfulRequests: true // Ne compte que les échecs
});

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://localhost:3001',
  credentials: true
}));
app.use(bodyParser.json());
app.use(generalLimiter); // Appliquer le rate limiting global
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true, // activé pour HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 heures
    sameSite: 'strict' // Protection CSRF supplémentaire
  }
}));

// Protection CSRF
const csrfProtection = csrf({ cookie: false }); // Utilise la session au lieu des cookies

// Middleware conditionnel pour appliquer CSRF à toutes les routes state-changing sauf login
app.use((req, res, next) => {
  // Appliquer CSRF protection à toutes les requêtes POST/PATCH/DELETE/PUT sauf le login
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method) && req.path !== '/api/auth/login') {
    return csrfProtection(req, res, next);
  }
  next();
});

// Chemins
const DATA_DIR = path.join(__dirname, '../data');
const CONFIG_DIR = path.join(__dirname, '../config');
const MODELES_DIR = path.join(__dirname, '../modeles');
const EXPORT_DIR = path.join(__dirname, '../export');
const RAPPORTS_DIR = path.join(__dirname, '../rapports');
const ELEVES_FILE = path.join(DATA_DIR, 'eleves.json');
const MAPPING_FILE = path.join(CONFIG_DIR, 'mapping.json');
const MODELE_FILE = path.join(MODELES_DIR, 'GRILLE_E6.xlsx');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const JURY_MEMBERS_FILE = path.join(DATA_DIR, 'jury-members.json');
const PROJETS_FILE = path.join(DATA_DIR, 'projets.json');
const SECURITY_LOG_FILE = path.join(__dirname, '../security.log');

// Fonction de logging sécurité
async function logSecurityEvent(event, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    ...details
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  try {
    await fs.appendFile(SECURITY_LOG_FILE, logLine);
  } catch (error) {
    console.error('Erreur lors de l\'écriture du log de sécurité:', error);
  }
}

// Charger les données
let mapping = null;

async function loadMapping() {
  try {
    const data = await fs.readFile(MAPPING_FILE, 'utf-8');
    mapping = JSON.parse(data);
    console.log('Mapping chargé avec succès');
  } catch (error) {
    console.error('Erreur lors du chargement du mapping:', error);
    throw error;
  }
}

async function loadEleves() {
  try {
    const data = await fs.readFile(ELEVES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erreur lors du chargement des élèves:', error);
    return [];
  }
}

async function saveEleves(eleves) {
  try {
    await fs.writeFile(ELEVES_FILE, JSON.stringify(eleves, null, 2));
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des élèves:', error);
    return false;
  }
}

// Fonctions d'authentification
async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erreur lors du chargement des utilisateurs:', error);
    return [];
  }
}

async function saveUsers(users) {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des utilisateurs:', error);
    return false;
  }
}

// Fonctions pour les membres des jurys
async function loadJuryMembers() {
  try {
    const data = await fs.readFile(JURY_MEMBERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erreur lors du chargement des membres du jury:', error);
    return { jury1: [], jury2: [] };
  }
}

async function saveJuryMembers(juryMembers) {
  try {
    await fs.writeFile(JURY_MEMBERS_FILE, JSON.stringify(juryMembers, null, 2));
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des membres du jury:', error);
    return false;
  }
}

// Fonctions pour les projets
async function loadProjets() {
  try {
    const data = await fs.readFile(PROJETS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erreur lors du chargement des projets:', error);
    return [];
  }
}

async function saveProjets(projets) {
  try {
    await fs.writeFile(PROJETS_FILE, JSON.stringify(projets, null, 2));
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des projets:', error);
    return false;
  }
}

// Middleware d'authentification
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  next();
}

// Middleware de vérification du rôle admin
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé - Admin uniquement' });
  }
  next();
}

// Middleware de vérification d'accès aux évaluations selon le rôle
function checkEvaluationAccess(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const userRole = req.session.user.role;
  const semestre = req.body.semestre || req.params.semestre;

  // Admin a accès à tout
  if (userRole === 'admin') {
    return next();
  }

  // Jury n'a accès qu'à la soutenance
  if (userRole === 'jury') {
    if (semestre !== 'soutenance') {
      return res.status(403).json({
        error: 'Accès refusé - Le jury n\'a accès qu\'aux évaluations de soutenance'
      });
    }
    return next();
  }

  // Rôle non reconnu
  return res.status(403).json({ error: 'Accès refusé' });
}

// Fonctions de validation des types
function validateString(value, fieldName, required = true, maxLength = 500) {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} est requis`);
    }
    return true;
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} doit être une chaîne de caractères`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} ne doit pas dépasser ${maxLength} caractères`);
  }
  return true;
}

function validateNumber(value, fieldName, required = true, min = null, max = null) {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} est requis`);
    }
    return true;
  }
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`${fieldName} doit être un nombre`);
  }
  if (min !== null && num < min) {
    throw new Error(`${fieldName} doit être au minimum ${min}`);
  }
  if (max !== null && num > max) {
    throw new Error(`${fieldName} doit être au maximum ${max}`);
  }
  return true;
}

function validateEnum(value, fieldName, allowedValues, required = true) {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} est requis`);
    }
    return true;
  }
  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} doit être l'une des valeurs: ${allowedValues.join(', ')}`);
  }
  return true;
}

function validateObject(value, fieldName, required = true) {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} est requis`);
    }
    return true;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} doit être un objet`);
  }
  return true;
}

// Validation du type de fichier par magic number (octets de signature)
async function validatePDFFile(filePath) {
  try {
    const buffer = Buffer.alloc(5);
    const fileHandle = await fs.open(filePath, 'r');
    await fileHandle.read(buffer, 0, 5, 0);
    await fileHandle.close();

    // Les fichiers PDF commencent par %PDF- (25 50 44 46 2D en hex)
    const pdfSignature = buffer.toString('utf8', 0, 5);
    if (pdfSignature !== '%PDF-') {
      throw new Error('Le fichier n\'est pas un PDF valide (signature invalide)');
    }
    return true;
  } catch (error) {
    throw new Error('Erreur lors de la validation du fichier PDF: ' + error.message);
  }
}

// Routes publiques (pas de middleware app.use(express.static))
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Route pour obtenir le token CSRF
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Routes d'authentification
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validation stricte des types pour éviter les injections
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
    }

    // Limiter la longueur des entrées
    if (username.length > 50 || password.length > 100) {
      return res.status(400).json({ error: 'Entrées invalides' });
    }

    const users = await loadUsers();
    const user = users.find(u => u.username === username);

    if (!user) {
      await logSecurityEvent('LOGIN_FAILED', { username, reason: 'user_not_found', ip: req.ip });
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    // Comparer le mot de passe avec bcrypt
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      await logSecurityEvent('LOGIN_FAILED', { username, reason: 'invalid_password', ip: req.ip });
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    req.session.user = {
      username: user.username,
      role: user.role,
      juryId: user.juryId || null
    };

    await logSecurityEvent('LOGIN_SUCCESS', { username, role: user.role, ip: req.ip });

    // Vérifier si l'utilisateur doit changer son mot de passe
    const mustChangePassword = user.mustChangePassword || false;

    res.json({
      success: true,
      user: { username: user.username, role: user.role, juryId: user.juryId || null },
      mustChangePassword
    });
  } catch (error) {
    console.error('Erreur de connexion:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
    }
    res.json({ success: true });
  });
});

// Route pour changer le mot de passe
app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const username = req.session.user.username;

    // Validation stricte des types
    try {
      validateString(currentPassword, 'Mot de passe actuel', true, 100);
      validateString(newPassword, 'Nouveau mot de passe', true, 100);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }

    // Charger les utilisateurs
    const users = await loadUsers();
    const userIndex = users.findIndex(u => u.username === username);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const user = users[userIndex];

    // Vérifier le mot de passe actuel
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Mettre à jour le mot de passe et retirer le flag mustChangePassword
    users[userIndex].password = hashedPassword;
    users[userIndex].mustChangePassword = false;

    // Sauvegarder les utilisateurs
    const saved = await saveUsers(users);
    if (!saved) {
      return res.status(500).json({ error: 'Erreur lors de la sauvegarde du nouveau mot de passe' });
    }

    await logSecurityEvent('PASSWORD_CHANGED', { username, ip: req.ip });

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('Erreur lors du changement de mot de passe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour réinitialiser le mot de passe d'un utilisateur (admin uniquement)
app.post('/api/reset-password', requireAdmin, async (req, res) => {
  try {
    const { username, newPassword } = req.body;

    if (!username || !newPassword) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et nouveau mot de passe requis' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }

    // Charger les utilisateurs
    const users = await loadUsers();
    const userIndex = users.findIndex(u => u.username === username);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Mettre à jour le mot de passe
    users[userIndex].password = hashedPassword;

    // Sauvegarder les utilisateurs
    const saved = await saveUsers(users);
    if (!saved) {
      return res.status(500).json({ error: 'Erreur lors de la sauvegarde du nouveau mot de passe' });
    }

    res.json({ success: true, message: `Mot de passe réinitialisé pour ${username}` });
  } catch (error) {
    console.error('Erreur lors de la réinitialisation du mot de passe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour obtenir la liste des utilisateurs (admin uniquement)
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await loadUsers();
    // Ne pas renvoyer les mots de passe
    const usersWithoutPasswords = users.map(u => ({
      username: u.username,
      role: u.role,
      juryId: u.juryId || null
    }));
    res.json(usersWithoutPasswords);
  } catch (error) {
    console.error('Erreur lors du chargement des utilisateurs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  res.json({ user: req.session.user });
});

// Routes pour servir les pages HTML (AVANT express.static)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/evaluation/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/evaluation.html'));
});

app.get('/recapitulatif/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/recapitulatif.html'));
});

app.get('/change-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/change-password.html'));
});

app.get('/projets', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/projets.html'));
});

// Servir les fichiers statiques avec vérification d'authentification
app.use(express.static(path.join(__dirname, '../public')));

// Routes protégées API

// GET /api/eleves - Récupérer la liste des élèves
app.get('/api/eleves', async (req, res) => {
  try {
    let eleves = await loadEleves();

    // Filtrer les élèves selon le jury connecté
    if (req.session && req.session.user) {
      const user = req.session.user;

      // Si c'est un jury spécifique (jury1 ou jury2), ne montrer que ses élèves
      if (user.role === 'jury' && user.juryId) {
        eleves = eleves.filter(eleve => eleve.jury === user.juryId);
      }
    }

    res.json(eleves);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du chargement des élèves' });
  }
});

// GET /api/eleves/:id - Récupérer un élève spécifique
app.get('/api/eleves/:id', async (req, res) => {
  try {
    const eleves = await loadEleves();
    const eleve = eleves.find(e => e.id === parseInt(req.params.id));
    if (!eleve) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    // Vérifier si le jury a accès à cet élève
    if (req.session && req.session.user) {
      const user = req.session.user;
      if (user.role === 'jury' && user.juryId && eleve.jury !== user.juryId) {
        return res.status(403).json({ error: 'Accès refusé - Cet élève n\'est pas assigné à votre jury' });
      }
    }

    res.json(eleve);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du chargement de l\'élève' });
  }
});

// DELETE /api/eleves/:id - Supprimer un élève
app.delete('/api/eleves/:id', requireAdmin, async (req, res) => {
  try {
    const eleveId = parseInt(req.params.id);
    const eleves = await loadEleves();
    const eleveIndex = eleves.findIndex(e => e.id === eleveId);

    if (eleveIndex === -1) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    const eleve = eleves[eleveIndex];

    // Supprimer l'élève de la liste
    eleves.splice(eleveIndex, 1);

    // Sauvegarder la liste mise à jour
    await saveEleves(eleves);

    // Optionnel: Supprimer le fichier Excel associé s'il existe
    try {
      const outputFileName = `${eleve.nom}_${eleve.prenom}_Evaluation.xlsx`;
      const outputPath = path.join(EXPORT_DIR, outputFileName);
      await fs.unlink(outputPath);
    } catch (error) {
      // Fichier n'existe pas, pas grave
    }

    res.json({ success: true, message: 'Élève supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'élève:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'élève' });
  }
});

// POST /api/eleves - Créer un nouvel élève
app.post('/api/eleves', async (req, res) => {
  try {
    const { nom, prenom, promotion, classe, numero, jury } = req.body;

    // Validation stricte des types
    try {
      validateString(nom, 'Nom', true, 100);
      validateString(prenom, 'Prénom', true, 100);
      validateString(numero, 'Numéro', true, 50);

      const promoValue = promotion || classe;
      validateString(promoValue, 'Promotion/Classe', true, 100);

      if (jury !== null && jury !== undefined && jury !== '') {
        validateEnum(jury, 'Jury', ['jury1', 'jury2'], false);
      }
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    // Validation - accepter promotion OU classe pour rétrocompatibilité
    const promoValue = promotion || classe;

    const eleves = await loadEleves();

    // Générer un nouvel ID
    const newId = eleves.length > 0 ? Math.max(...eleves.map(e => e.id)) + 1 : 1;

    // Créer le nouvel élève
    const newEleve = {
      id: newId,
      nom: nom.trim(),
      prenom: prenom.trim(),
      promotion: promoValue.trim(),
      numero: numero.trim(),
      jury: jury || null,
      evaluations: {}
    };

    eleves.push(newEleve);

    // Sauvegarder
    await fs.writeFile(ELEVES_FILE, JSON.stringify(eleves, null, 2));

    res.status(201).json(newEleve);
  } catch (error) {
    console.error('Erreur lors de la création de l\'élève:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'élève' });
  }
});

// PATCH /api/eleves/:id/jury - Mettre à jour le jury d'un élève
app.patch('/api/eleves/:id/jury', requireAdmin, async (req, res) => {
  try {
    const eleveId = parseInt(req.params.id);
    const { jury } = req.body;

    // Validation stricte des types
    try {
      if (jury !== null && jury !== undefined && jury !== '') {
        validateEnum(jury, 'Jury', ['jury1', 'jury2'], false);
      }
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const eleves = await loadEleves();
    const eleveIndex = eleves.findIndex(e => e.id === eleveId);

    if (eleveIndex === -1) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    // Mettre à jour le jury
    eleves[eleveIndex].jury = jury || null;

    await saveEleves(eleves);

    res.json({ success: true, message: 'Jury mis à jour', eleve: eleves[eleveIndex] });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du jury' });
  }
});

// POST /api/eleves/:id/evaluations - Sauvegarder une évaluation (brouillon)
app.post('/api/eleves/:id/evaluations', checkEvaluationAccess, async (req, res) => {
  try {
    const eleveId = parseInt(req.params.id);
    const { semestre, data } = req.body;

    // Validation stricte des types
    try {
      validateEnum(semestre, 'Semestre', ['stage', 'revue1', 'revue2', 'revue3', 'soutenance'], true);
      validateObject(data, 'Données d\'évaluation', true);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const eleves = await loadEleves();
    const eleveIndex = eleves.findIndex(e => e.id === eleveId);

    if (eleveIndex === -1) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    // Sauvegarder les données d'évaluation
    if (!eleves[eleveIndex].evaluations) {
      eleves[eleveIndex].evaluations = {};
    }
    eleves[eleveIndex].evaluations[semestre] = data;

    await saveEleves(eleves);
    res.json({ success: true, message: 'Évaluation sauvegardée' });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde de l\'évaluation' });
  }
});

// POST /api/eleves/:id/remplir-excel - Remplir l'Excel avec les données d'évaluation
app.post('/api/eleves/:id/remplir-excel', checkEvaluationAccess, async (req, res) => {
  let workbook = null;
  let outputFileName = null;
  try {
    const eleveId = parseInt(req.params.id);
    const { semestre } = req.body;

    const eleves = await loadEleves();
    const eleve = eleves.find(e => e.id === eleveId);

    if (!eleve) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    if (!eleve.evaluations || !eleve.evaluations[semestre]) {
      return res.status(400).json({ error: 'Aucune donnée d\'évaluation trouvée pour ce semestre' });
    }

    outputFileName = `${eleve.nom}_${eleve.prenom}_Evaluation.xlsx`;
    const outputPath = path.join(EXPORT_DIR, outputFileName);

    // Vérifier que le fichier existe
    try {
      await fs.access(outputPath);
    } catch {
      return res.status(404).json({ error: 'Fichier Excel non trouvé. Veuillez d\'abord générer le document.' });
    }

    // Acquérir le verrou pour éviter les écritures concurrentes
    await acquireExcelLock(outputFileName);

    // Charger le fichier Excel existant
    workbook = await XlsxPopulate.fromFileAsync(outputPath);

    // Récupérer le nom de l'onglet
    const sheetName = mapping.sheetNames[semestre];
    const sheet = workbook.sheet(sheetName);

    if (!sheet) {
      return res.status(400).json({ error: `Onglet non trouvé: ${sheetName}` });
    }

    // Récupérer les données d'évaluation
    const evalData = eleve.evaluations[semestre];

    if (!mapping.evaluations || !mapping.evaluations[semestre]) {
      return res.status(400).json({ error: `Mapping des compétences non trouvé pour ${semestre}` });
    }

    const semestreCompetences = mapping.evaluations[semestre].competences;

    // Effacer d'abord tous les "x" existants dans cette feuille
    const colonnes = ['C', 'D', 'E', 'F'];
    for (const compCode of Object.keys(semestreCompetences)) {
      const competence = semestreCompetences[compCode];
      for (const critere of competence.criteres) {
        for (const col of colonnes) {
          const cellAddress = `${col}${critere.ligne}`;
          try {
            const cell = sheet.cell(cellAddress);
            const value = cell.value();
            if (value === 'x' || value === 'X') {
              cell.value(null);
            }
          } catch (err) {
            // Ignorer les erreurs
          }
        }
      }
    }

    // Remplir les critères d'évaluation avec des "x"
    for (const compCode of Object.keys(semestreCompetences)) {
      const competence = semestreCompetences[compCode];

      for (const critere of competence.criteres) {
        const critereData = evalData[critere.id];
        if (critereData && critereData.niveau !== null && critereData.niveau !== undefined) {
          try {
            // Déterminer la colonne selon le niveau
            let colonne;
            const niveau = parseInt(critereData.niveau);

            switch (niveau) {
              case 0:
              case 1:
                colonne = mapping.niveaux.niveau_1.colonne;
                break;
              case 2:
                colonne = mapping.niveaux.niveau_2.colonne;
                break;
              case 3:
                colonne = mapping.niveaux.niveau_3.colonne;
                break;
              case 4:
                colonne = mapping.niveaux.niveau_4.colonne;
                break;
              default:
                continue;
            }

            // Écrire "x" dans la cellule appropriée
            const cellAddress = `${colonne}${critere.ligne}`;
            sheet.cell(cellAddress).value('x');
          } catch (err) {
            console.error(`❌ Erreur sur ${critere.id}:`, err.message);
          }
        }
      }
    }

    // Remplir le commentaire général si présent
    if (mapping.commentaires && mapping.commentaires.commentaire_global && mapping.commentaires.commentaire_global[semestre] && evalData.commentaireGeneral) {
      try {
        const commentCellAddress = mapping.commentaires.commentaire_global[semestre];
        sheet.cell(commentCellAddress).value(evalData.commentaireGeneral);
      } catch (err) {
        console.error('❌ Erreur commentaire général:', err.message);
      }
    }

    // Remplir les champs supplémentaires (bonus et note finale pour le stage)
    if (mapping.champs_supplementaires && mapping.champs_supplementaires[semestre]) {
      const champsSupp = mapping.champs_supplementaires[semestre];

      // Remplir le bonus
      if (champsSupp.bonus && evalData.bonus !== undefined) {
        try {
          const bonusCellAddress = champsSupp.bonus.cellule;
          sheet.cell(bonusCellAddress).value(parseFloat(evalData.bonus) || 0);
        } catch (err) {
          console.error('❌ Erreur bonus:', err.message);
        }
      }

      // Remplir la note finale
      if (champsSupp.note_finale && evalData.note_finale !== undefined && evalData.note_finale !== null) {
        try {
          const noteFinaleCellAddress = champsSupp.note_finale.cellule;
          sheet.cell(noteFinaleCellAddress).value(parseFloat(evalData.note_finale));
        } catch (err) {
          console.error('❌ Erreur note finale:', err.message);
        }
      }
    }

    // Sauvegarder le fichier
    await workbook.toFileAsync(outputPath);

    // Libérer le verrou
    releaseExcelLock(outputFileName);

    // Libérer la mémoire immédiatement
    workbook = null;
    if (global.gc) {
      global.gc();
    }

    res.json({
      success: true,
      message: 'Évaluation remplie dans le fichier Excel',
      filename: outputFileName
    });
  } catch (error) {
    console.error('❌ Erreur lors du remplissage Excel:', error);

    // Libérer le verrou en cas d'erreur
    if (outputFileName) {
      releaseExcelLock(outputFileName);
    }

    // Libérer la mémoire en cas d'erreur
    if (workbook) {
      workbook = null;
    }
    if (global.gc) {
      global.gc();
    }

    res.status(500).json({ error: 'Erreur lors du remplissage du fichier Excel: ' + error.message });
  }
});

// GET /api/download/:filename - Télécharger un fichier Excel (admin uniquement)
app.get('/api/download/:filename', requireAdmin, async (req, res) => {
  try {
    // Sanitiser le nom de fichier (protection path traversal)
    const filename = path.basename(req.params.filename);
    const filePath = path.join(EXPORT_DIR, filename);

    // Vérifier que le chemin résolu est bien dans EXPORT_DIR
    const resolvedPath = path.resolve(filePath);
    const resolvedExportDir = path.resolve(EXPORT_DIR);

    if (!resolvedPath.startsWith(resolvedExportDir)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Vérifier que le fichier existe
    await fs.access(filePath);

    res.download(filePath, filename);
  } catch (error) {
    console.error('Erreur lors du téléchargement:', error);
    res.status(404).json({ error: 'Fichier non trouvé' });
  }
});

// GET /api/eleves/:id/note-calculee/:semestre - Lire la note calculée depuis l'Excel
app.get('/api/eleves/:id/note-calculee/:semestre', async (req, res) => {
  try {
    const eleveId = parseInt(req.params.id);
    const semestre = req.params.semestre;

    const eleves = await loadEleves();
    const eleve = eleves.find(e => e.id === eleveId);

    if (!eleve) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    const outputFileName = `${eleve.nom}_${eleve.prenom}_Evaluation.xlsx`;
    const outputPath = path.join(EXPORT_DIR, outputFileName);

    // Vérifier que le fichier existe
    try {
      await fs.access(outputPath);
    } catch {
      return res.json({ note_calculee: null });
    }

    // Vérifier qu'il y a une note calculée configurée pour ce semestre
    if (!mapping.champs_supplementaires || !mapping.champs_supplementaires[semestre] || !mapping.champs_supplementaires[semestre].note_calculee) {
      return res.json({ note_calculee: null });
    }

    // Charger le fichier Excel
    const workbook = await XlsxPopulate.fromFileAsync(outputPath);
    const sheetName = mapping.sheetNames[semestre];
    const sheet = workbook.sheet(sheetName);

    if (!sheet) {
      return res.json({ note_calculee: null });
    }

    // Lire la note calculée
    const cellAddress = mapping.champs_supplementaires[semestre].note_calculee.cellule;
    const cell = sheet.cell(cellAddress);
    let noteCalculee = cell.value();

    // Si la valeur est undefined, calculer manuellement la formule
    // Formule Excel: IF(H64=3,(F27*A19+F39*A31+F50*A43+F62*A54)*20/3+C63,"croix à reprendre")
    // Mais F27, F39, F50, F62 contiennent des formules SUMPRODUCT qui ne sont pas calculées par xlsx-populate
    // Il faut donc tout recalculer manuellement
    if (noteCalculee === undefined) {
      try {
        // Fonction pour calculer la moyenne d'une compétence
        const calculerMoyenneCompetence = (lignes) => {
          let somme = 0;
          let count = 0;

          for (const ligne of lignes) {
            const c = sheet.cell(`C${ligne}`).value();
            const d = sheet.cell(`D${ligne}`).value();
            const e = sheet.cell(`E${ligne}`).value();
            const f = sheet.cell(`F${ligne}`).value();
            const a = sheet.cell(`A${ligne}`).value() || 0;

            // Convertir les "x" en valeurs numériques (comme la formule G)
            let valeur = null;
            if (c === 'x') valeur = 0;
            else if (d === 'x') valeur = 1;
            else if (e === 'x') valeur = 2;
            else if (f === 'x') valeur = 3;

            if (valeur !== null && a > 0) {
              somme += valeur * a;
              count += a;
            }
          }

          return count > 0 ? somme / count : 0;
        };

        // Configuration des lignes selon le type d'évaluation
        let lignesConfig;
        if (semestre === 'stage') {
          lignesConfig = {
            c01: [21, 22, 23, 24, 26],
            c03: [33, 34, 35, 36, 38],
            c08: [45, 46, 47, 49],
            c10: [56, 57, 58, 59, 61],
            poids: { c01: 'A19', c03: 'A31', c08: 'A43', c10: 'A54' }
          };
        } else if (semestre === 'revue1') {
          lignesConfig = {
            c01: [20, 21, 22, 23, 25],
            c03: [32, 33, 34, 35, 37],
            c08: null,
            c10: null,
            poids: { c01: 'A18', c03: 'A30', c08: null, c10: null }
          };
        } else if (semestre === 'revue2' || semestre === 'revue3' || semestre === 'soutenance') {
          lignesConfig = {
            c01: [20, 21, 22, 23, 25],
            c03: [32, 33, 34, 35, 37],
            c08: [44, 45, 46, 47, 49],
            c10: [56, 57, 58, 59, 61],
            poids: { c01: 'A18', c03: 'A30', c08: 'A42', c10: 'A54' }
          };
        }

        // Calculer les moyennes par compétence
        const moyenneC01 = calculerMoyenneCompetence(lignesConfig.c01);
        const moyenneC03 = calculerMoyenneCompetence(lignesConfig.c03);
        const moyenneC08 = lignesConfig.c08 ? calculerMoyenneCompetence(lignesConfig.c08) : 0;
        const moyenneC10 = lignesConfig.c10 ? calculerMoyenneCompetence(lignesConfig.c10) : 0;

        // Poids des compétences
        const poidsC01 = sheet.cell(lignesConfig.poids.c01).value() || 0;
        const poidsC03 = sheet.cell(lignesConfig.poids.c03).value() || 0;
        const poidsC08 = lignesConfig.poids.c08 ? (sheet.cell(lignesConfig.poids.c08).value() || 0) : 0;
        const poidsC10 = lignesConfig.poids.c10 ? (sheet.cell(lignesConfig.poids.c10).value() || 0) : 0;

        // Bonus
        const bonus = sheet.cell('C63').value() || 0;

        // Calcul final: (moyenne pondérée) * 20/3 + bonus
        noteCalculee = (moyenneC01 * poidsC01 + moyenneC03 * poidsC03 + moyenneC08 * poidsC08 + moyenneC10 * poidsC10) * 20 / 3 + bonus;
        noteCalculee = Math.round(noteCalculee * 100) / 100; // Arrondir à 2 décimales
      } catch (err) {
        console.error('Erreur calcul note:', err.message);
      }
    }

    res.json({ note_calculee: noteCalculee });
  } catch (error) {
    console.error('Erreur lors de la lecture de la note calculée:', error);
    res.status(500).json({ error: 'Erreur lors de la lecture de la note calculée' });
  }
});

// GET /api/mapping - Récupérer le mapping pour le frontend
app.get('/api/mapping', (req, res) => {
  res.json(mapping);
});

// GET /api/mapping/evaluation/:semestre - Récupérer le mapping d'une évaluation spécifique
app.get('/api/mapping/evaluation/:semestre', checkEvaluationAccess, (req, res) => {
  const semestre = req.params.semestre;
  if (!mapping.sheetNames[semestre]) {
    return res.status(404).json({ error: 'Évaluation non trouvée' });
  }
  if (!mapping.evaluations || !mapping.evaluations[semestre]) {
    return res.status(404).json({ error: 'Configuration d\'évaluation non trouvée pour ce semestre' });
  }
  const response = {
    nom: mapping.sheetNames[semestre],
    competences: mapping.evaluations[semestre].competences,
    niveaux: mapping.niveaux
  };

  // Ajouter les champs supplémentaires s'ils existent pour ce semestre
  if (mapping.champs_supplementaires && mapping.champs_supplementaires[semestre]) {
    response.champs_supplementaires = mapping.champs_supplementaires[semestre];
  }

  res.json(response);
});

// GET /api/observables - Récupérer les observables
app.get('/api/observables', async (req, res) => {
  try {
    const observablesPath = path.join(CONFIG_DIR, 'observables.json');
    const data = await fs.readFile(observablesPath, 'utf-8');
    const observables = JSON.parse(data);
    res.json(observables);
  } catch (error) {
    console.error('Erreur lors du chargement des observables:', error);
    res.status(500).json({ error: 'Erreur lors du chargement des observables' });
  }
});

// POST /api/eleves/:id/recapitulatif - Sauvegarder les données du récapitulatif
app.post('/api/eleves/:id/recapitulatif', async (req, res) => {
  try {
    const eleveId = parseInt(req.params.id);
    const { note_proposee, commentaires } = req.body;

    // Validation stricte des types
    try {
      if (note_proposee !== null && note_proposee !== undefined) {
        validateNumber(note_proposee, 'Note proposée', false, 0, 20);
      }
      if (commentaires !== null && commentaires !== undefined) {
        validateString(commentaires, 'Commentaires', false, 5000);
      }
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const eleves = await loadEleves();
    const eleveIndex = eleves.findIndex(e => e.id === eleveId);

    if (eleveIndex === -1) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    if (!eleves[eleveIndex].recapitulatif) {
      eleves[eleveIndex].recapitulatif = {};
    }

    eleves[eleveIndex].recapitulatif.note_proposee = note_proposee;
    eleves[eleveIndex].recapitulatif.commentaires = commentaires;

    await saveEleves(eleves);

    res.json({ success: true, message: 'Récapitulatif sauvegardé' });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du récapitulatif' });
  }
});

// POST /api/eleves/:id/generer-excel-complet - VERSION OPTIMISÉE: Générer l'Excel complet en un seul chargement
// Cette route remplace les 3 appels séparés (generer-excel + remplir-excel + remplir-excel-recap)
// AVANTAGE: 67% moins de mémoire (150 MB au lieu de 450 MB)
app.post('/api/eleves/:id/generer-excel-complet', requireAdmin, async (req, res) => {
  let workbook = null;
  let outputFileName = null;

  try {
    const eleveId = parseInt(req.params.id);
    const eleves = await loadEleves();
    const eleve = eleves.find(e => e.id === eleveId);

    if (!eleve) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    // Créer le dossier export si nécessaire
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    // Nom du fichier de sortie
    outputFileName = `${eleve.nom}_${eleve.prenom}_Evaluation.xlsx`;
    const outputPath = path.join(EXPORT_DIR, outputFileName);

    // Acquérir le verrou pour éviter les écritures concurrentes
    await acquireExcelLock(outputFileName);

    // ========== ÉTAPE 1: Charger le modèle Excel UNE SEULE FOIS ==========
    workbook = await XlsxPopulate.fromFileAsync(MODELE_FILE);

    // ========== ÉTAPE 2: Remplir l'identité dans tous les onglets ==========
    const identiteFields = {
      session: req.body.session || new Date().getFullYear().toString(),
      academie: req.body.academie || '',
      etablissement: req.body.etablissement || '',
      nom: eleve.nom || '',
      prenom: eleve.prenom || '',
      numero: eleve.numero || '',
      date: new Date().toLocaleDateString('fr-FR')
    };
    const sheets = ['stage', 'revue1', 'revue2', 'revue3', 'soutenance', 'recap'];

    for (const [field, value] of Object.entries(identiteFields)) {
      const fieldMapping = mapping.identite[field];
      if (!fieldMapping) {
        console.log(`⚠️  Pas de mapping pour le champ: ${field}`);
        continue;
      }

      for (const sheetKey of sheets) {
        const cellAddress = fieldMapping[sheetKey];
        if (!cellAddress) continue;

        const sheetName = mapping.sheetNames[sheetKey];
        if (!sheetName) continue;

        try {
          const sheet = workbook.sheet(sheetName);
          if (sheet) {
            sheet.cell(cellAddress).value(value);
            console.log(`✅ ${field} -> ${sheetName}:${cellAddress} = "${value}"`);
          }
        } catch (err) {
          console.error(`❌ Erreur identité ${sheetName}:${cellAddress}:`, err.message);
        }
      }
    }

    // ========== ÉTAPE 2.5: Remplir la session (SESSION 20xx) ==========
    const session = req.body.session || new Date().getFullYear().toString();

    const sessionSheets = [
      { name: 'E6 STAGE - IR', cell: 'A6' },
      { name: 'E6 SOUTENANCE - IR', cell: 'A5' },
      { name: 'E6 REVUES - IR - R1', cell: 'A5' },
      { name: 'E6 REVUES - IR - R2', cell: 'A5' },
      { name: 'E6 REVUES - IR - R3', cell: 'A5' }
    ];

    for (const info of sessionSheets) {
      try {
        const sheet = workbook.sheet(info.name);
        if (sheet) {
          const cell = sheet.cell(info.cell);
          const currentValue = cell.value();

          // Si c'est du rich text
          if (typeof currentValue === 'object' && currentValue.text) {
            const newText = currentValue.text().replace(/20xx/i, session);
            cell.value(newText);
          } else if (typeof currentValue === 'string') {
            const newText = currentValue.replace(/20xx/i, session);
            cell.value(newText);
          }
        }
      } catch (err) {
        console.error(`❌ Erreur SESSION ${info.name}:`, err.message);
      }
    }

    // Remplir la session dans le récapitulatif (B18) - format "SESSION 2026"
    try {
      const recapSheet = workbook.sheet('FICHE RECAPITULATIVE E6 -  IR');
      if (recapSheet) {
        recapSheet.cell('B18').value(`SESSION ${session}`);
        console.log(`✅ Session récapitulatif B18 = "SESSION ${session}"`);
      }
    } catch (err) {
      console.error(`❌ Erreur SESSION récapitulatif:`, err.message);
    }

    // ========== ÉTAPE 3: Remplir TOUTES les évaluations depuis eleves.json ==========
    const semestres = ['stage', 'revue1', 'revue2', 'revue3', 'soutenance'];

    for (const semestre of semestres) {
      if (!eleve.evaluations || !eleve.evaluations[semestre]) {
        continue; // Pas de données pour ce semestre
      }

      const evalData = eleve.evaluations[semestre];
      if (!mapping.evaluations || !mapping.evaluations[semestre]) {
        continue;
      }

      const sheetName = mapping.sheetNames[semestre];
      const sheet = workbook.sheet(sheetName);

      if (!sheet) {
        console.warn(`⚠️  Feuille non trouvée: ${sheetName}`);
        continue;
      }

      const semestreCompetences = mapping.evaluations[semestre].competences;

      // Effacer les "x" existants
      const colonnes = ['C', 'D', 'E', 'F'];
      for (const compCode of Object.keys(semestreCompetences)) {
        const competence = semestreCompetences[compCode];
        for (const critere of competence.criteres) {
          for (const col of colonnes) {
            try {
              const cell = sheet.cell(`${col}${critere.ligne}`);
              const value = cell.value();
              if (value === 'x' || value === 'X') {
                cell.value(null);
              }
            } catch (err) {
              // Ignorer
            }
          }
        }
      }

      // Remplir les critères avec des "x"
      for (const compCode of Object.keys(semestreCompetences)) {
        const competence = semestreCompetences[compCode];

        for (const critere of competence.criteres) {
          const critereData = evalData[critere.id];
          if (critereData && critereData.niveau !== null && critereData.niveau !== undefined) {
            try {
              let colonne;
              const niveau = parseInt(critereData.niveau);

              switch (niveau) {
                case 0:
                case 1:
                  colonne = mapping.niveaux.niveau_1.colonne;
                  break;
                case 2:
                  colonne = mapping.niveaux.niveau_2.colonne;
                  break;
                case 3:
                  colonne = mapping.niveaux.niveau_3.colonne;
                  break;
                case 4:
                  colonne = mapping.niveaux.niveau_4.colonne;
                  break;
                default:
                  continue;
              }

              sheet.cell(`${colonne}${critere.ligne}`).value('x');
            } catch (err) {
              console.error(`❌ Erreur ${critere.id}:`, err.message);
            }
          }
        }
      }

      // Remplir commentaire général
      if (mapping.commentaires && mapping.commentaires.commentaire_global &&
          mapping.commentaires.commentaire_global[semestre] && evalData.commentaireGeneral) {
        try {
          sheet.cell(mapping.commentaires.commentaire_global[semestre]).value(evalData.commentaireGeneral);
        } catch (err) {
          console.error('❌ Erreur commentaire:', err.message);
        }
      }

      // Remplir champs supplémentaires (bonus, note finale)
      if (mapping.champs_supplementaires && mapping.champs_supplementaires[semestre]) {
        const champsSupp = mapping.champs_supplementaires[semestre];

        if (champsSupp.bonus && evalData.bonus !== undefined) {
          try {
            sheet.cell(champsSupp.bonus.cellule).value(parseFloat(evalData.bonus) || 0);
          } catch (err) {
            console.error('❌ Erreur bonus:', err.message);
          }
        }

        if (champsSupp.note_finale && evalData.note_finale !== undefined && evalData.note_finale !== null) {
          try {
            sheet.cell(champsSupp.note_finale.cellule).value(parseFloat(evalData.note_finale));
          } catch (err) {
            console.error('❌ Erreur note finale:', err.message);
          }
        }
      }
    }

    // ========== ÉTAPE 4: Remplir la fiche récapitulative ==========
    const recapSheet = workbook.sheet('FICHE RECAPITULATIVE E6 -  IR');

    if (recapSheet) {
      // Notes finales des évaluations
      if (eleve.evaluations?.stage?.note_finale) {
        recapSheet.cell('F28').value(parseFloat(eleve.evaluations.stage.note_finale));
      }
      if (eleve.evaluations?.revue3?.note_finale) {
        recapSheet.cell('F30').value(parseFloat(eleve.evaluations.revue3.note_finale));
      }
      if (eleve.evaluations?.soutenance?.note_finale) {
        recapSheet.cell('F32').value(parseFloat(eleve.evaluations.soutenance.note_finale));
      }

      // Note proposée au jury
      if (eleve.recapitulatif?.note_proposee) {
        recapSheet.cell('C34').value(parseFloat(eleve.recapitulatif.note_proposee));
      }

      // Commentaires
      if (eleve.recapitulatif?.commentaires) {
        recapSheet.cell('B37').value(eleve.recapitulatif.commentaires);
      }

      // Membres du jury
      if (eleve.jury && mapping.jury_members?.recap) {
        try {
          const juryMembers = await loadJuryMembers();
          const members = juryMembers[eleve.jury] || [];
          const validMembers = members.filter(m => m.nom || m.prenom || m.qualite);

          if (validMembers.length > 0) {
            const juryMapping = mapping.jury_members.recap;

            validMembers.slice(0, 3).forEach((member, index) => {
              const memberNum = index + 1;
              const cellKey = `member${memberNum}`;

              if (juryMapping[cellKey]) {
                const parts = [];
                if (member.nom) parts.push(member.nom);
                if (member.prenom) parts.push(member.prenom);

                let fullText = parts.join(' ');
                if (member.qualite) {
                  fullText += fullText ? ` - ${member.qualite}` : member.qualite;
                }

                if (fullText) {
                  recapSheet.cell(juryMapping[cellKey]).value(fullText);
                }
              }
            });
          }
        } catch (error) {
          console.error('❌ Erreur jury members:', error.message);
        }
      }
    }

    // ========== ÉTAPE 5: Sauvegarder UNE SEULE FOIS ==========
    await workbook.toFileAsync(outputPath);

    // Libérer le verrou
    releaseExcelLock(outputFileName);

    // Libérer la mémoire
    workbook = null;
    if (global.gc) {
      global.gc();
    }

    console.log('✅ Excel généré');

    res.json({
      success: true,
      message: 'Fichier Excel complet généré avec succès',
      filename: outputFileName
    });

  } catch (error) {
    console.error('❌ Erreur génération Excel complète:', error);

    // Libérer le verrou en cas d'erreur
    if (outputFileName) {
      releaseExcelLock(outputFileName);
    }

    // Libérer la mémoire
    if (workbook) {
      workbook = null;
    }
    if (global.gc) {
      global.gc();
    }

    res.status(500).json({ error: 'Erreur lors de la génération du fichier Excel: ' + error.message });
  }
});

// Routes pour gérer les membres des jurys
// GET /api/jury-members - Récupérer les membres des jurys
app.get('/api/jury-members', requireAuth, async (req, res) => {
  try {
    const juryMembers = await loadJuryMembers();
    res.json(juryMembers);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du chargement des membres du jury' });
  }
});

// POST /api/jury-members - Sauvegarder les membres des jurys
app.post('/api/jury-members', requireAdmin, async (req, res) => {
  try {
    const juryMembers = req.body;

    // Validation basique
    if (!juryMembers.jury1 || !juryMembers.jury2) {
      return res.status(400).json({ error: 'Format invalide' });
    }

    await saveJuryMembers(juryMembers);
    res.json({ success: true, message: 'Membres des jurys enregistrés' });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde des membres du jury' });
  }
});

// GET /api/projets - Récupérer la liste des projets
app.get('/api/projets', requireAuth, async (req, res) => {
  try {
    const projets = await loadProjets();
    res.json(projets);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du chargement des projets' });
  }
});

// POST /api/projets - Ajouter un projet
app.post('/api/projets', requireAdmin, async (req, res) => {
  try {
    const { nom, description } = req.body;

    if (!nom || nom.trim() === '') {
      return res.status(400).json({ error: 'Le nom du projet est requis' });
    }

    const projets = await loadProjets();
    const newProjet = {
      id: Date.now().toString(),
      nom: nom.trim(),
      description: description ? description.trim() : ''
    };

    projets.push(newProjet);
    await saveProjets(projets);

    res.json({ success: true, projet: newProjet });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'ajout du projet' });
  }
});

// DELETE /api/projets/:id - Supprimer un projet
app.delete('/api/projets/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let projets = await loadProjets();

    const projetIndex = projets.findIndex(p => p.id === id);
    if (projetIndex === -1) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    projets.splice(projetIndex, 1);
    await saveProjets(projets);

    res.json({ success: true, message: 'Projet supprimé' });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du projet' });
  }
});

// PATCH /api/eleves/:id/projet - Assigner un projet à un élève
app.patch('/api/eleves/:id/projet', requireAdmin, async (req, res) => {
  try {
    const eleveId = parseInt(req.params.id);
    const { projetId } = req.body;

    let eleves = await loadEleves();
    const eleveIndex = eleves.findIndex(e => e.id === eleveId);

    if (eleveIndex === -1) {
      return res.status(404).json({ error: 'Élève non trouvé' });
    }

    eleves[eleveIndex].projetId = projetId || null;
    await saveEleves(eleves);

    res.json({ success: true, eleve: eleves[eleveIndex] });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'assignation du projet' });
  }
});

// Configuration de multer pour l'upload du cahier des charges PDF
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, RAPPORTS_DIR);
  },
  filename: function (req, file, cb) {
    // Générer un nom de fichier unique basé sur l'ID du projet
    const projetId = req.params.id;
    const timestamp = Date.now();
    cb(null, `cdc_${projetId}_${timestamp}.pdf`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    // N'accepter que les fichiers PDF
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // Limite à 10MB
  }
});

// POST /api/projets/:id/cahier-charges - Upload du cahier des charges PDF pour un projet
app.post('/api/projets/:id/cahier-charges', requireAdmin, upload.single('cahierCharges'), async (req, res) => {
  try {
    const projetId = req.params.id;

    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    // Validation stricte du fichier PDF par magic number
    const uploadedFilePath = path.join(RAPPORTS_DIR, req.file.filename);
    try {
      await validatePDFFile(uploadedFilePath);
    } catch (validationError) {
      // Supprimer le fichier invalide
      await fs.unlink(uploadedFilePath);
      return res.status(400).json({ error: validationError.message });
    }

    // Mettre à jour le projet avec le nom du fichier
    let projets = await loadProjets();
    const projetIndex = projets.findIndex(p => p.id === projetId);

    if (projetIndex === -1) {
      // Supprimer le fichier uploadé si le projet n'existe pas
      await fs.unlink(uploadedFilePath);
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    // Supprimer l'ancien cahier des charges s'il existe
    if (projets[projetIndex].cahierChargesFilename) {
      try {
        await fs.unlink(path.join(RAPPORTS_DIR, projets[projetIndex].cahierChargesFilename));
      } catch (err) {
        console.log('Ancien cahier des charges non trouvé, continuer...');
      }
    }

    projets[projetIndex].cahierChargesFilename = req.file.filename;
    projets[projetIndex].cahierChargesOriginalName = req.file.originalname;
    await saveProjets(projets);

    res.json({ success: true, filename: req.file.filename, originalName: req.file.originalname });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'upload du cahier des charges' });
  }
});

// GET /api/projets/:id/cahier-charges - Télécharger le cahier des charges PDF d'un projet
app.get('/api/projets/:id/cahier-charges', requireAuth, async (req, res) => {
  try {
    const projetId = req.params.id;
    const projets = await loadProjets();
    const projet = projets.find(p => p.id === projetId);

    if (!projet) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    if (!projet.cahierChargesFilename) {
      return res.status(404).json({ error: 'Aucun cahier des charges disponible pour ce projet' });
    }

    // Protection contre le path traversal : extraire uniquement le nom du fichier
    const sanitizedFilename = path.basename(projet.cahierChargesFilename);
    const filePath = path.join(RAPPORTS_DIR, sanitizedFilename);

    // Vérifier que le chemin résolu est bien dans RAPPORTS_DIR (double protection)
    const resolvedPath = path.resolve(filePath);
    const resolvedRapportsDir = path.resolve(RAPPORTS_DIR);
    if (!resolvedPath.startsWith(resolvedRapportsDir)) {
      console.error(`Tentative de path traversal détectée: ${projet.cahierChargesFilename}`);
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Vérifier si le fichier existe
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Fichier du cahier des charges introuvable' });
    }

    // Envoyer le fichier avec le nom original (également sanitisé)
    const sanitizedOriginalName = path.basename(projet.cahierChargesOriginalName || 'cahier-charges.pdf');
    res.download(filePath, sanitizedOriginalName);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors du téléchargement du cahier des charges' });
  }
});

// DELETE /api/projets/:id/cahier-charges - Supprimer le cahier des charges PDF d'un projet
app.delete('/api/projets/:id/cahier-charges', requireAdmin, async (req, res) => {
  try {
    const projetId = req.params.id;
    let projets = await loadProjets();
    const projetIndex = projets.findIndex(p => p.id === projetId);

    if (projetIndex === -1) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    if (!projets[projetIndex].cahierChargesFilename) {
      return res.status(404).json({ error: 'Aucun cahier des charges à supprimer' });
    }

    // Supprimer le fichier
    try {
      await fs.unlink(path.join(RAPPORTS_DIR, projets[projetIndex].cahierChargesFilename));
    } catch (err) {
      console.log('Fichier déjà supprimé ou introuvable');
    }

    // Mettre à jour le projet
    delete projets[projetIndex].cahierChargesFilename;
    delete projets[projetIndex].cahierChargesOriginalName;
    await saveProjets(projets);

    res.json({ success: true, message: 'Cahier des charges supprimé' });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du cahier des charges' });
  }
});

// ========== GESTION DU VERROUILLAGE DES ÉVALUATIONS ==========

const EVALUATION_LOCK_FILE = path.join(__dirname, '../data/evaluation-lock.json');

// Charger l'état du verrouillage
async function loadEvaluationLock() {
  try {
    const data = await fs.readFile(EVALUATION_LOCK_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {
      jury1: { isLocked: false, startDate: null, endDate: null, unlockedEarly: false },
      jury2: { isLocked: false, startDate: null, endDate: null, unlockedEarly: false }
    };
  }
}

// Sauvegarder l'état du verrouillage
async function saveEvaluationLock(lockData) {
  await fs.writeFile(EVALUATION_LOCK_FILE, JSON.stringify(lockData, null, 2));
}

// Vérifier si on est dans la période de verrouillage pour un jury spécifique
function isInLockPeriod(lockData, juryId) {
  const juryLock = lockData[juryId];
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

// GET /api/evaluation-lock - Récupérer l'état du verrouillage
app.get('/api/evaluation-lock', requireAuth, async (req, res) => {
  try {
    const lockData = await loadEvaluationLock();
    const userRole = req.session.user.role;
    const juryId = req.session.user.juryId;

    // Pour le jury: retourner seulement son verrouillage
    if (userRole === 'jury' && juryId) {
      const juryLock = lockData[juryId];
      const isLocked = isInLockPeriod(lockData, juryId);

      res.json({
        isLocked,
        lockData: juryLock,
        juryId,
        canManage: true
      });
    } else {
      // Pour l'admin: retourner tout
      res.json({
        lockData,
        canManage: false
      });
    }
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de l\'état du verrouillage' });
  }
});

// POST /api/evaluation-lock/set - Définir la période de verrouillage (jury uniquement)
app.post('/api/evaluation-lock/set', async (req, res) => {
  try {
    if (!req.session || !req.session.user || req.session.user.role !== 'jury') {
      return res.status(403).json({ error: 'Accès refusé. Seuls les jurys peuvent configurer le verrouillage.' });
    }

    const { startDate, endDate } = req.body;

    // Fallback pour Docker: utiliser username si juryId n'existe pas
    let juryId = req.session.user.juryId;
    if (!juryId && req.session.user.username) {
      juryId = req.session.user.username;
    }

    if (!juryId) {
      return res.status(400).json({ error: 'Jury ID manquant' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Les dates de début et de fin sont requises' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end <= start) {
      return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
    }

    const allLockData = await loadEvaluationLock();

    allLockData[juryId] = {
      isLocked: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      unlockedEarly: false
    };

    await saveEvaluationLock(allLockData);

    res.json({ success: true, message: 'Période de verrouillage définie', lockData: allLockData[juryId] });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la définition de la période de verrouillage' });
  }
});

// POST /api/evaluation-lock/unlock - Débloquer avant la fin (jury uniquement)
app.post('/api/evaluation-lock/unlock', async (req, res) => {
  try {
    if (!req.session || !req.session.user || req.session.user.role !== 'jury') {
      return res.status(403).json({ error: 'Accès refusé. Seuls les jurys peuvent débloquer.' });
    }

    // Fallback pour Docker: utiliser username si juryId n'existe pas
    let juryId = req.session.user.juryId;
    if (!juryId && req.session.user.username) {
      juryId = req.session.user.username;
    }

    if (!juryId) {
      return res.status(400).json({ error: 'Jury ID manquant' });
    }

    const allLockData = await loadEvaluationLock();
    allLockData[juryId].unlockedEarly = true;

    await saveEvaluationLock(allLockData);

    res.json({ success: true, message: 'Accès admin débloqué avec succès pour vos élèves' });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors du déblocage' });
  }
});

// POST /api/evaluation-lock/disable - Désactiver le verrouillage (jury uniquement)
app.post('/api/evaluation-lock/disable', async (req, res) => {
  try {
    if (!req.session || !req.session.user || req.session.user.role !== 'jury') {
      return res.status(403).json({ error: 'Accès refusé. Seuls les jurys peuvent désactiver le verrouillage.' });
    }

    const juryId = req.session.user.juryId;
    if (!juryId) {
      return res.status(400).json({ error: 'Jury ID manquant' });
    }

    const allLockData = await loadEvaluationLock();

    allLockData[juryId] = {
      isLocked: false,
      startDate: null,
      endDate: null,
      unlockedEarly: false
    };

    await saveEvaluationLock(allLockData);

    res.json({ success: true, message: 'Verrouillage désactivé' });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la désactivation du verrouillage' });
  }
});

// Démarrage du serveur
async function startServer() {
  try {
    await loadMapping();

    // Configuration HTTPS avec les certificats mkcert
    const httpsOptions = {
      key: fsSync.readFileSync(path.join(__dirname, '../certs/localhost+2-key.pem')),
      cert: fsSync.readFileSync(path.join(__dirname, '../certs/localhost+2.pem'))
    };

    https.createServer(httpsOptions, app).listen(PORT, () => {
      console.log(`\n🚀 Serveur démarré sur https://localhost:${PORT}`);
      console.log(`🔒 HTTPS activé avec certificats mkcert`);
      console.log(`📁 Dossier d'export: ${EXPORT_DIR}`);
      console.log(`📋 Fichier modèle: ${MODELE_FILE}`);
      console.log(`✨ Utilisation de xlsx-populate pour une meilleure compatibilité\n`);
    });
  } catch (error) {
    console.error('Erreur lors du démarrage du serveur:', error);
    process.exit(1);
  }
}

startServer();
