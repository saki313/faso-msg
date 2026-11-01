// ============================================================================
// FasoMsg — src/auth.js
// Authentification : mots de passe (scrypt, bibliothèque standard Node.js),
// second facteur TOTP (RFC 6238, bibliothèque open source « otpauth », MIT),
// sessions (cookie HttpOnly, seul le hachage du jeton est stocké) et
// limitation des tentatives de connexion (anti-force brute).
//
// AUCUNE cryptographie « maison » : scrypt et sha256 viennent du module
// `crypto` de Node.js ; TOTP est conforme à la RFC 6238.
// ============================================================================

const crypto = require('node:crypto');
const { TOTP, Secret } = require('otpauth');
const { db, journaliser } = require('./db');

const DUREE_SESSION_HEURES = 12;
const MAX_ECHECS = 5;              // avant blocage temporaire
const DUREE_BLOCAGE_MIN = 15;

// ————— Mots de passe : scrypt (N=16384, r=8, p=1) —————
function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  const hachage = crypto.scryptSync(motDePasse, sel, 64).toString('hex');
  return { sel, hachage };
}

function verifierMotDePasse(motDePasse, sel, hachageAttendu) {
  const calcule = crypto.scryptSync(motDePasse, sel, 64);
  const attendu = Buffer.from(hachageAttendu, 'hex');
  return calcule.length === attendu.length &&
    crypto.timingSafeEqual(calcule, attendu);   // comparaison à temps constant
}

// ————— Second facteur : TOTP (RFC 6238, 6 chiffres, 30 s) —————
function creerTotp(identifiant, secretBase32) {
  return new TOTP({
    issuer: 'FasoMsg',
    label: encodeURIComponent(identifiant),
    algorithm: 'SHA1',     // algorithme standard des applications TOTP
    digits: 6,
    period: 30,
    secret: secretBase32 ? Secret.fromBase32(secretBase32) : new Secret({ size: 20 }),
  });
}

function codeTotpValide(secretBase32, identifiant, code) {
  try {
    const totp = creerTotp(identifiant, secretBase32);
    // window:1 tolère un décalage d'une période (30 s) d'horloge.
    return totp.validate({ token: String(code).trim(), window: 1 }) !== null;
  } catch {
    return false;
  }
}

// ————— Sessions : cookie HttpOnly, jeton aléatoire 256 bits —————
// Le serveur ne stocke que sha256(jeton) : une fuite de la base ne permet
// pas de rejouer une session.
function creerSession(agentId) {
  const jeton = crypto.randomBytes(32).toString('base64url');
  const jetonHache = crypto.createHash('sha256').update(jeton).digest('hex');
  const expire = new Date(Date.now() + DUREE_SESSION_HEURES * 3600e3).toISOString();
  db.prepare('INSERT INTO sessions (jeton_hache, agent_id, expire_le) VALUES (?, ?, ?)')
    .run(jetonHache, agentId, expire);
  return { jeton, expire };
}

function agentDepuisJeton(jeton) {
  if (!jeton) return null;
  const jetonHache = crypto.createHash('sha256').update(jeton).digest('hex');
  const ligne = db.prepare(`
    SELECT a.*, s.expire_le AS session_expire
    FROM sessions s JOIN agents a ON a.id = s.agent_id
    WHERE s.jeton_hache = ?`).get(jetonHache);
  if (!ligne) return null;
  if (ligne.session_expire < new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE jeton_hache = ?').run(jetonHache);
    return null;
  }
  if (ligne.statut !== 'actif') return null;    // agent révoqué => session morte
  return ligne;
}

function detruireSessions(agentId) {
  db.prepare('DELETE FROM sessions WHERE agent_id = ?').run(agentId);
}

function cookieSession(jeton) {
  return `fasomsg_jeton=${jeton}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${DUREE_SESSION_HEURES * 3600}`;
}

function lireJeton(req) {
  const entete = req.headers.cookie || '';
  for (const part of entete.split(';')) {
    const [nom, ...reste] = part.trim().split('=');
    if (nom === 'fasomsg_jeton') return decodeURIComponent(reste.join('='));
  }
  return null;
}

// ————— Limitation des tentatives (anti-force brute, en mémoire) —————
const tentatives = new Map(); // identifiant -> { echecs, bloque_jusqu_a }

function estBloque(identifiant) {
  const t = tentatives.get(identifiant);
  return !!t && t.bloque_jusqu_a > Date.now();
}

function enregistrerEchec(identifiant) {
  const t = tentatives.get(identifiant) || { echecs: 0, bloque_jusqu_a: 0 };
  t.echecs += 1;
  if (t.echecs >= MAX_ECHECS) {
    t.bloque_jusqu_a = Date.now() + DUREE_BLOCAGE_MIN * 60e3;
    t.echecs = 0;
    journaliser('blocage_tentatives', null, `identifiant=${identifiant}`);
  }
  tentatives.set(identifiant, t);
}

function reinitialiserTentatives(identifiant) {
  tentatives.delete(identifiant);
}

// ————— Middlewares Express —————
function authentifie(req, res, suite) {
  const agent = agentDepuisJeton(lireJeton(req));
  if (!agent) return res.status(401).json({ erreur: 'non_authentifie' });
  req.agent = agent;
  suite();
}

function exigerRole(...roles) {
  return (req, res, suite) => {
    if (!req.agent || !roles.includes(req.agent.role)) {
      return res.status(403).json({ erreur: 'role_insuffisant' });
    }
    suite();
  };
}

module.exports = {
  hacherMotDePasse, verifierMotDePasse,
  creerTotp, codeTotpValide,
  creerSession, agentDepuisJeton, detruireSessions, cookieSession, lireJeton,
  estBloque, enregistrerEchec, reinitialiserTentatives,
  authentifie, exigerRole,
};
