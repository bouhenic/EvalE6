# Image de base Node.js LTS
FROM node:18-alpine

# Installer OpenSSL pour générer des certificats auto-signés
RUN apk add --no-cache openssl

# Créer le répertoire de l'application
WORKDIR /app

# Copier les fichiers package.json et package-lock.json
COPY package*.json ./

# Installer les dépendances de production
RUN npm ci --only=production

# Copier le reste de l'application
COPY backend ./backend
COPY public ./public
COPY config ./config
COPY modeles ./modeles

# Créer les répertoires nécessaires
RUN mkdir -p /app/data /app/export /app/rapports /app/certs

# Copier les données initiales
COPY data ./data

# Générer des certificats auto-signés pour HTTPS
RUN openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout /app/certs/localhost+2-key.pem \
    -out /app/certs/localhost+2.pem \
    -days 365 \
    -subj "/C=FR/ST=France/L=Paris/O=BTS CIEL/OU=E6/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# Créer un utilisateur non-root pour exécuter l'application
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Changer les permissions des répertoires de données
RUN chown -R nodejs:nodejs /app/data /app/export /app/rapports /app/certs

# Utiliser l'utilisateur non-root
USER nodejs

# Exposer le port 3001
EXPOSE 3001

# Variable d'environnement pour Node.js
ENV NODE_ENV=production

# Commande de démarrage
CMD ["node", "--max-old-space-size=4096", "backend/server.js"]
