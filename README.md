# Application E6 BTS CIEL - Version Docker

Application web pour la gestion et l'évaluation des étudiants BTS CIEL pour l'épreuve E6: Valorisation de la donnée et cybersécurité.

## Prérequis

- Docker Engine 20.10 ou supérieur
- Docker Compose 2.0 ou supérieur

## Installation et démarrage rapide

### 1. Construction de l'image Docker

```bash
docker-compose build
```

### 2. Démarrage de l'application

```bash
docker-compose up -d
```

L'application sera accessible sur : **https://localhost:3001**

### 3. Arrêt de l'application

```bash
docker-compose down
```

## Identifiants par défaut

L'application est initialisée avec trois comptes par défaut :

| Utilisateur | Mot de passe | Rôle  |
|-------------|--------------|-------|
| `admin`     | `admin123`   | Admin |
| `jury1`     | `jury1123`   | Jury  |
| `jury2`     | `jury2123`   | Jury  |

**IMPORTANT** : Changez ces mots de passe après la première connexion !

## Gestion des données

### Volumes Docker

Les données sont stockées dans des volumes Docker persistants :

- `evale6_e6-data` : Données des étudiants, utilisateurs, jurys et projets
- `evale6_e6-export` : Fichiers Excel générés
- `evale6_e6-rapports` : Cahiers des charges (PDF) des projets

### Sauvegarde des données

Pour sauvegarder les données :

```bash
# Créer un dossier de sauvegarde
mkdir -p ./backup

# Sauvegarder le volume data
docker run --rm -v evale6_e6-data:/data -v $(pwd)/backup:/backup alpine tar czf /backup/e6-data-backup.tar.gz -C /data .

# Sauvegarder le volume export
docker run --rm -v evale6_e6-export:/data -v $(pwd)/backup:/backup alpine tar czf /backup/e6-export-backup.tar.gz -C /data .

# Sauvegarder le volume rapports
docker run --rm -v evale6_e6-rapports:/data -v $(pwd)/backup:/backup alpine tar czf /backup/e6-rapports-backup.tar.gz -C /data .
```

### Restauration des données

Pour restaurer une sauvegarde :

```bash
# Arrêter l'application
docker-compose down

# Restaurer le volume data
docker run --rm -v evale6_e6-data:/data -v $(pwd)/backup:/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/e6-data-backup.tar.gz -C /data"

# Restaurer le volume export
docker run --rm -v evale6_e6-export:/data -v $(pwd)/backup:/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/e6-export-backup.tar.gz -C /data"

# Restaurer le volume rapports
docker run --rm -v evale6_e6-rapports:/data -v $(pwd)/backup:/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/e6-rapports-backup.tar.gz -C /data"

# Redémarrer l'application
docker-compose up -d
```

## Commandes utiles

### Voir les logs

```bash
# Logs en temps réel
docker-compose logs -f

# Derniers logs
docker-compose logs --tail=100
```

### Redémarrer l'application

```bash
docker-compose restart
```

### Mettre à jour l'application

```bash
# Arrêter l'application
docker-compose down

# Reconstruire l'image
docker-compose build --no-cache

# Redémarrer l'application
docker-compose up -d
```

### Accéder au conteneur

```bash
docker-compose exec e6-app sh
```

### Vérifier l'état de santé

```bash
docker-compose ps
```

## Configuration

### Variable d'environnement SESSION_SECRET

L'application utilise une clé secrète pour sécuriser les sessions utilisateur. Par défaut, une clé est définie dans `docker-compose.yml`.

**IMPORTANT pour la production** : Changez la valeur de `SESSION_SECRET` dans `docker-compose.yml` avant de déployer en production :

```yaml
environment:
  - SESSION_SECRET=votre_clé_secrète_sécurisée_minimum_32_caractères
```

Pour générer une clé sécurisée :
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Configuration HTTPS

L'application génère automatiquement des certificats SSL auto-signés au démarrage du conteneur.

**Note** : Votre navigateur affichera un avertissement de sécurité. C'est normal pour les certificats auto-signés. Vous pouvez accepter l'exception de sécurité pour continuer.

### Pour une utilisation en production

Pour une utilisation en production avec des certificats valides :

1. Obtenez un certificat SSL valide (Let's Encrypt, etc.)
2. Montez vos certificats dans le conteneur en modifiant `docker-compose.yml` :

```yaml
services:
  e6-app:
    volumes:
      - ./certs:/app/certs:ro  # Ajoutez cette ligne
```

3. Placez vos certificats dans le dossier `./certs` :
   - `localhost+2.pem` : Certificat
   - `localhost+2-key.pem` : Clé privée

## Dépannage

### Le port 3001 est déjà utilisé

Si le port 3001 est déjà utilisé, modifiez le dans `docker-compose.yml` :

```yaml
ports:
  - "8443:3001"  # Changez 3001 par le port souhaité
```

### Réinitialiser complètement l'application

Pour repartir de zéro (supprime TOUTES les données) :

```bash
# Arrêter et supprimer les conteneurs
docker-compose down

# Supprimer les volumes
docker volume rm evale6_e6-data evale6_e6-export evale6_e6-rapports

# Reconstruire et redémarrer
docker-compose up -d
```

### Problèmes de permissions

Si vous rencontrez des problèmes de permissions :

```bash
# Redémarrer le conteneur
docker-compose restart

# Si le problème persiste, reconstruire l'image
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Architecture

### Structure des fichiers

```
DockerE6/
├── backend/              # Code serveur Node.js
├── public/               # Fichiers frontend (HTML, CSS, JS)
├── config/               # Configuration (mapping Excel, observables)
├── modeles/              # Template Excel GRILLE_E6.xlsx
├── data/                 # Données (étudiants, utilisateurs, jurys)
├── export/               # Fichiers Excel générés
├── rapports/             # Cahiers des charges (PDF)
├── certs/                # Certificats SSL
├── Dockerfile            # Configuration Docker
├── docker-compose.yml    # Orchestration Docker
└── README.md             # Ce fichier
```

### Ports utilisés

- `3001` : Port HTTPS de l'application

## Fonctionnalités

### Pour l'administrateur

- Gestion des étudiants (ajout, modification, suppression)
- Gestion des jurys et de leurs membres
- Gestion des projets
- Upload/download des cahiers des charges
- Évaluations complètes (stage, revues, soutenance)
- Génération automatique des fichiers Excel
- Configuration de l'établissement et de l'académie
- Impression des tableaux récapitulatifs

### Pour les jurys

- Accès restreint aux étudiants assignés
- Évaluation de la soutenance uniquement
- Téléchargement des cahiers des charges
- Consultation des fiches récapitulatives

## Sécurité

- Mots de passe hashés avec bcrypt
- Sessions sécurisées
- Protection CSRF
- HTTPS obligatoire
- Isolation des jurys
- Validation des entrées

## Support

Pour toute question ou problème :

1. Consultez les logs : `docker-compose logs -f`
2. Vérifiez l'état de santé : `docker-compose ps`
3. Redémarrez l'application : `docker-compose restart`

## Licence

Application développée pour l'évaluation BTS CIEL - Épreuve E6.
