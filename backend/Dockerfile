# ── Stage unique : Node.js 20 Alpine ─────────────────────────────────────────
FROM node:20-alpine

# Dépendances système requises par Puppeteer / whatsapp-web.js + Chromium
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      udev \
      bash

# Indiquer à Puppeteer d'utiliser Chromium installé par Alpine (pas de téléchargement)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

WORKDIR /app

# Copier les manifestes en premier pour bénéficier du cache Docker
COPY package*.json ./

# Installer les dépendances de production uniquement
RUN npm ci --omit=dev

# Copier le code source
COPY src/ ./src/

# Créer le dossier uploads (volume monté en prod, mais doit exister à l'image build)
RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "src/index.js"]
