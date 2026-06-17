# Application E6 BTS CIEL — Version Docker

Application web pour la gestion et l'évaluation des étudiants BTS CIEL pour l'épreuve **E6 : Valorisation de la donnée et cybersécurité**.

## Prérequis

- Docker Engine 20.10 ou supérieur
- Docker Compose v2 (commande `docker compose`)
- `git`

## Installation et démarrage rapide

### 1. Récupérer le code

```bash
git clone https://github.com/bouhenic/EvalE6.git
cd EvalE6
```

### 2. Construire l'image

```bash
docker compose build
```

### 3. Démarrer l'application

```bash
docker compose up -d
```

### 4. Arrêter l'application

```bash
docker compose down
```

## Accès à l'application

L'application écoute en **HTTPS sur le port 3001**. Le frontend détecte automatiquement
l'adresse utilisée (il s'appuie sur `window.location.origin`), donc l'application
fonctionne quelle que soit la façon dont on y accède :

| Contexte d'accès | URL |
|---|---|
| Sur la machine qui héberge le conteneur | `https://localhost:3001` |
| Depuis un autre poste (VM, serveur distant) | `https://<IP-ou-domaine-du-serveur>:3001` |

> ℹ️ Les versions antérieures avaient les URLs d'API codées en dur sur `https://localhost:3001`,
> ce qui provoquait une erreur **« load failed »** dès qu'on accédait à l'application par une
> IP/un domaine distant (mauvaise cible + blocage CSP `connect-src`). C'est corrigé : les
> requêtes visent désormais la même origine que la page.

### Certificat HTTPS

L'application génère un **certificat auto-signé** au démarrage du conteneur. Le navigateur
affichera donc un avertissement de sécurité — c'est normal, accepter l'exception pour continuer.

⚠️ Le certificat est émis pour `localhost` / `127.0.0.1` **uniquement**. En accès par IP ou
domaine distant, l'avertissement réapparaîtra à chaque fois. Pour un usage propre, fournir un
certificat valide (voir [Pour la production](#pour-une-utilisation-en-production)) ou régénérer
le certificat avec votre IP/domaine dans les SAN.

## Première connexion

L'application est initialisée avec trois comptes :

| Utilisateur | Rôle  |
|-------------|-------|
| `admin`     | Admin |
| `jury1`     | Jury  |
| `jury2`     | Jury  |

Les mots de passe initiaux **ne sont volontairement pas publiés** ici : ils doivent être
transmis hors-dépôt (canal séparé). Les trois comptes ont le flag `mustChangePassword: true` :
**à la première connexion, chaque utilisateur est redirigé vers une page imposant le choix de
son propre mot de passe**. Il n'y a pas d'écran d'inscription — on se connecte avec
l'identifiant initial, puis on définit son mot de passe.

> ⚠️ Réinitialiser un mot de passe oublié : l'admin peut réinitialiser celui d'un jury depuis
> l'interface (« Gérer les utilisateurs »). Pour le compte admin lui-même, il faut éditer le
> hash bcrypt dans `data/users.json` (voir [Réinitialiser les comptes](#réinitialiser-les-comptes)).
> Génération d'un hash :
> `node -e "require('bcryptjs').hash('VotreMotDePasse', 10).then(h=>console.log(h))"`

## Gestion des données

### Volumes Docker

Les données sont stockées dans des **volumes Docker persistants** (préfixés par le nom du
projet, soit `evale6` si le dossier s'appelle `EvalE6`) :

- `evale6_e6-data` : étudiants, utilisateurs, jurys et projets (`data/`)
- `evale6_e6-export` : fichiers Excel générés (`export/`)
- `evale6_e6-rapports` : cahiers des charges PDF (`rapports/`)

> ⚠️ **Important — le seed n'est copié qu'à la création du volume.** Docker n'initialise un
> volume nommé qu'à sa **première** création (à partir du contenu `data/` de l'image). Un
> `docker compose up --build` reconstruit bien l'image et le **code** (frontend `public/`,
> backend), mais **ne met pas à jour le contenu des volumes** déjà existants. Conséquence : un
> ancien `data/users.json` figé dans le volume continue d'être utilisé. Pour repartir du seed,
> il faut recréer le volume (voir [Réinitialiser les comptes](#réinitialiser-les-comptes)).

### Sauvegarde

```bash
mkdir -p ./backup
docker run --rm -v evale6_e6-data:/data    -v $(pwd)/backup:/backup alpine tar czf /backup/e6-data-backup.tar.gz    -C /data .
docker run --rm -v evale6_e6-export:/data  -v $(pwd)/backup:/backup alpine tar czf /backup/e6-export-backup.tar.gz  -C /data .
docker run --rm -v evale6_e6-rapports:/data -v $(pwd)/backup:/backup alpine tar czf /backup/e6-rapports-backup.tar.gz -C /data .
```

### Restauration

```bash
docker compose down
docker run --rm -v evale6_e6-data:/data    -v $(pwd)/backup:/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/e6-data-backup.tar.gz    -C /data"
docker run --rm -v evale6_e6-export:/data  -v $(pwd)/backup:/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/e6-export-backup.tar.gz  -C /data"
docker run --rm -v evale6_e6-rapports:/data -v $(pwd)/backup:/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/e6-rapports-backup.tar.gz -C /data"
docker compose up -d
```

## Mettre à jour l'application

```bash
git pull
docker compose up -d --build
```

Le rebuild met à jour le **code** (frontend et backend, copiés dans l'image). Les **données**
des volumes (`data/`, `export/`, `rapports/`) sont conservées et **ne sont pas** réécrites par
la mise à jour. Si une mise à jour change le schéma du seed (`data/users.json`), voir la section
suivante.

## Commandes utiles

```bash
docker compose logs -f            # logs en temps réel
docker compose logs --tail=100    # derniers logs
docker compose restart            # redémarrer (vide aussi le compteur de rate-limiting en mémoire)
docker compose ps                 # état / santé des conteneurs
docker compose exec e6-app sh     # shell dans le conteneur
```

## Configuration

### SESSION_SECRET

L'application **exige** une clé secrète de session au démarrage. Une valeur est fournie dans
`docker-compose.yml` pour le développement.

**IMPORTANT en production** : remplacer la valeur de `SESSION_SECRET` dans `docker-compose.yml` :

```yaml
environment:
  - SESSION_SECRET=votre_clé_secrète_minimum_32_caractères
```

Générer une clé :
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Pour une utilisation en production

1. Obtenir un certificat SSL valide (Let's Encrypt, etc.).
2. Monter les certificats dans le conteneur via `docker-compose.yml` :

   ```yaml
   services:
     e6-app:
       volumes:
         - ./certs:/app/certs:ro
   ```

3. Placer les fichiers dans `./certs` :
   - `localhost+2.pem` : certificat
   - `localhost+2-key.pem` : clé privée

## Dépannage

### « load failed » au login

Symptôme : la page de connexion s'affiche mais la connexion échoue avec « load failed »
(console : *Refused to connect … connect-src*). Cause : version antérieure avec URLs d'API
codées en dur sur `localhost`. **Corrigé dans la version actuelle** — faire `git pull` puis
`docker compose up -d --build`, et recharger la page en vidant le cache (Ctrl+Shift+R).

### Impossible de se connecter avec les identifiants attendus

Le plus souvent, le volume `evale6_e6-data` contient un **ancien `data/users.json`** (le seed
de l'image n'écrase pas un volume existant — voir [Volumes Docker](#volumes-docker)). Vérifier
ce que voit réellement le conteneur :

```bash
docker compose exec e6-app cat /app/data/users.json
```

Si ce n'est pas le seed attendu, voir [Réinitialiser les comptes](#réinitialiser-les-comptes).

> Après plusieurs tentatives échouées, le rate-limiting peut bloquer temporairement le login
> (5 essais). Un `docker compose restart e6-app` remet le compteur à zéro.

### Réinitialiser les comptes

Pour réappliquer le seed du dépôt (⚠️ **supprime les données du volume `data`**) :

```bash
docker compose down
docker volume rm evale6_e6-data      # si "volume is in use", supprimer d'abord le conteneur qui le retient
docker compose up -d --build
```

### Le port 3001 est déjà utilisé

Modifier le mapping dans `docker-compose.yml` :

```yaml
ports:
  - "8443:3001"   # accès via le port 8443
```

### Réinitialiser complètement (toutes les données)

```bash
docker compose down
docker volume rm evale6_e6-data evale6_e6-export evale6_e6-rapports
docker compose up -d --build
```

## Architecture

### Structure des fichiers

```
EvalE6/
├── backend/            # Serveur Node.js / Express (HTTPS)
├── public/             # Frontend (HTML, CSS, JS)
├── config/             # mapping Excel + observables
├── modeles/            # Template Excel GRILLE_E6.xlsx
├── data/               # Données seed (étudiants, utilisateurs, jurys, projets)
├── Dockerfile
├── docker-compose.yml
└── README.md
```

> Les certificats SSL et les fichiers `export/` / `rapports/` sont générés à l'exécution
> (dans le conteneur / les volumes), pas versionnés dans le dépôt.

### Ports

- `3001` : HTTPS de l'application

## Fonctionnalités

### Administrateur

- Gestion des étudiants (ajout, modification, suppression, affectation jury/projet)
- Gestion des jurys et de leurs membres
- Gestion des projets et des cahiers des charges (upload/download)
- Évaluations complètes (stage, revues, soutenance)
- Génération automatique des fichiers Excel
- Configuration établissement / académie

### Jurys

- Accès restreint aux étudiants assignés
- Évaluation de la soutenance uniquement
- Téléchargement des cahiers des charges
- Consultation des fiches récapitulatives

## Sécurité

- Mots de passe hashés avec bcrypt + changement forcé à la première connexion
- Sessions sécurisées (cookies `httpOnly` / `secure` / `sameSite: strict`), `SESSION_SECRET` requis au boot
- Protection CSRF (`csrf-csrf`, double-submit) et CSP (`script-src 'self'`)
- HTTPS, rate-limiting du login, isolation des jurys, validation des entrées
- Conteneur exécuté en utilisateur non-root

## Licence

Application développée pour l'évaluation BTS CIEL — Épreuve E6.
