// ============================================================================
// FasoMsg — src/ws.js
// WebSocket : pousse les événements vers les clients connectés.
//
// Le canal WebSocket n'achemine QUE :
//   - des enveloppes CHIFFRÉES (messages Megolm, clés Olm « to-device ») ;
//   - des notifications de changement (membres, rotation, révocation).
// Le serveur relaie sans jamais pouvoir déchiffrer : il ne détient aucune
// clé privée (elles restent dans le navigateur de chaque agent).
// ============================================================================

const { WebSocketServer } = require('ws');
const { agentDepuisJeton } = require('./auth');

// agent_id -> Set<WebSocket>
const connexions = new Map();

function init(serveurHttp) {
  const wss = new WebSocketServer({ server: serveurHttp, path: '/ws' });

  wss.on('connection', (ws, requete) => {
    // Authentification : le jeton de session vient du cookie HttpOnly
    // (envoyé automatiquement par le navigateur lors du handshake) ou,
    // à défaut, du paramètre d'URL (tests automatisés).
    const url = new URL(requete.url, 'http://localhost');
    let jeton = url.searchParams.get('jeton');
    if (!jeton && requete.headers.cookie) {
      for (const part of requete.headers.cookie.split(';')) {
        const [nom, ...reste] = part.trim().split('=');
        if (nom === 'fasomsg_jeton') jeton = decodeURIComponent(reste.join('='));
      }
    }
    const agent = agentDepuisJeton(jeton);
    if (!agent) { ws.close(4001, 'non_authentifie'); return; }

    const id = agent.id;
    if (!connexions.has(id)) connexions.set(id, new Set());
    connexions.get(id).add(ws);
    ws.on('pong', () => {});
    ws.on('close', () => {
      const ensemble = connexions.get(id);
      if (ensemble) { ensemble.delete(ws); if (!ensemble.size) connexions.delete(id); }
    });
    ws.send(JSON.stringify({ t: 'connecte', agent: id }));
  });

  // Battement de cœur : purge des connexions mortes toutes les 30 s.
  const timer = setInterval(() => {
    for (const ensemble of connexions.values()) {
      for (const ws of ensemble) { if (ws.readyState === ws.OPEN) ws.ping(); }
    }
  }, 30000);
  wss.on('close', () => clearInterval(timer));
  return wss;
}

// Pousse un objet JSON à tous les appareils connectés d'un agent.
function pousser(agentId, objet) {
  const ensemble = connexions.get(agentId);
  if (!ensemble) return;
  const texte = JSON.stringify(objet);
  for (const ws of ensemble) {
    if (ws.readyState === ws.OPEN) ws.send(texte);
  }
}

// Révocation : on notifie l'agent (effacement local à distance) puis on ferme
// brutalement toutes ses connexions.
function fermerAgent(agentId) {
  pousser(agentId, { t: 'revocation' });
  const ensemble = connexions.get(agentId);
  if (ensemble) {
    for (const ws of ensemble) { try { ws.close(4003, 'revoque'); } catch {} }
    connexions.delete(agentId);
  }
}

module.exports = { init, pousser, fermerAgent };
