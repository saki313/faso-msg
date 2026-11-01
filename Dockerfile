# =============================================================================
# FasoMsg — Dockerfile
# Image légère Node.js 24 : aucune dépendance native à compiler (SQLite est
# fourni par le module standard node:sqlite, Olm est en WebAssembly).
# =============================================================================
FROM node:24-bookworm-slim

WORKDIR /app

# Dépendances : uniquement les paquets nécessaires à l'exécution + esbuild
# pour construire le client (à l'image, pas au démarrage).
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Code source
COPY src ./src
COPY client ./client
COPY public ./public
COPY scripts ./scripts

# Construction du bundle client (public/app.js + public/olm.wasm)
RUN npm run build

# Base et fichiers chiffrés : volume hôte
ENV FASOMSG_DB=/app/data/fasomsg.db
ENV GRAINE_DEMO=1
RUN mkdir -p /app/data
VOLUME /app/data

ENV PORT=3000
EXPOSE 3000

# Vérification de santé simple
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
