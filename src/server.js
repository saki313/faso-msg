// ============================================================================
// FasoMsg — src/server.js
// Point d'entrée : serveur HTTP (Express) + WebSocket + fichiers statiques.
// Déploiement en une commande : `docker compose up` (voir docker-compose.yml).
// ============================================================================

const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { db, DOSSIER_FICHIERS } = require('./db');
const api = require('./api');
const ws = require('./ws');

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '14mb' }));   // fichiers chiffrés jusqu'à ~10 Mo en base64

// ————— En-têtes de sécurité —————
// CSP stricte : aucun script externe, aucune iframe, aucune API tierce.
app.use((req, res, suite) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  suite();
});

// Les réponses API sont propres à la session et souvent volatiles (file
// to-device, membres, profil). Ne jamais laisser le navigateur réutiliser une
// réponse 304/cache qui pourrait masquer une clé nouvellement arrivée.
app.use('/api', (req, res, suite) => {
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  res.setHeader('Cache-Control', 'no-store');
  suite();
});

// API REST puis interface web (fichiers statiques).
app.use('/api', api);
app.use(express.static(path.join(__dirname, '..', 'public')));

const serveur = http.createServer(app);
ws.init(serveur);

// ————— Nettoyage périodique —————
// 1. Messages expirés (classification « Diffusion restreinte / Confidentiel ») :
//    suppression serveur dès que l'horodatage d'expiration est dépassé.
// 2. Fichiers chiffrés expirés : blob + ligne supprimés.
// 3. Sessions expirées.
// (FASOMSG_NETTOYAGE_MS permet aux tests automatisés d'accélérer le cycle.)
const INTERVALLE_NETTOYAGE = Number(process.env.FASOMSG_NETTOYAGE_MS || 60000);
function nettoyer() {
  const maintenant = new Date().toISOString();
  db.prepare("DELETE FROM messages WHERE expire_le IS NOT NULL AND expire_le < ?").run(maintenant);
  const expires = db.prepare('SELECT id, nom_chiffre FROM fichiers WHERE expire_le IS NOT NULL AND expire_le < ?').all(maintenant);
  for (const f of expires) {
    try { fs.unlinkSync(path.join(DOSSIER_FICHIERS, f.nom_chiffre)); } catch {}
    db.prepare('DELETE FROM fichiers WHERE id = ?').run(f.id);
  }
  db.prepare('DELETE FROM sessions WHERE expire_le < ?').run(maintenant);
}
setInterval(nettoyer, INTERVALLE_NETTOYAGE);
nettoyer();

// ————— Données de démonstration (optionnel) —————
// GRAINE_DEMO=0 pour désactiver. Par défaut, si la base est vide au démarrage,
// on crée les comptes fictifs du fichier COMPTE_DEMO.md (jamais de vraies
// données personnelles, conformément à l'appel à projets).
if (process.env.GRAINE_DEMO !== '0') {
  const nb = db.prepare('SELECT COUNT(*) AS n FROM agents').get().n;
  if (nb === 0) {
    // eslint-disable-next-line no-console
    console.log('[FasoMsg] Base vide : création des comptes de démonstration fictifs…');
    require('./seed').semer();
  }
}

// ————— Garde-fou : bundle client construit ? —————
// public/app.js et public/olm.wasm sont générés par `npm run build` et ne
// sont pas versionnés (voir .gitignore). Sans eux, la page resterait vide
// sans explication : on avertit explicitement plutôt que de laisser une
// page blanche silencieuse. L'API et les tests restent fonctionnels.
if (!fs.existsSync(path.join(__dirname, '..', 'public', 'app.js'))) {
  // eslint-disable-next-line no-console
  console.warn('[FasoMsg] ATTENTION : public/app.js est absent — la page web sera vide.');
  // eslint-disable-next-line no-console
  console.warn('[FasoMsg] Lancez :  npm install && npm run build   (ou utilisez Docker : docker compose up).');
}

serveur.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`FasoMsg démarré sur http://localhost:${PORT} — le serveur ne stocke que du chiffré.`);
});

module.exports = app;
