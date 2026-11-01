// ============================================================================
// FasoMsg — src/api.js
// API REST du serveur. Le serveur est un « relais aveugle » :
//   - il vérifie les identités (enrôlement, sessions, rôles) ;
//   - il achemine et stocke des enveloppes CHIFFRÉES (Olm/Megolm) ;
//   - il ne peut déchiffrer aucun message ni fichier (aucune clé privée).
//
// Les routes suivent la logique du protocole Matrix (clés d'appareils,
// clés jetables « one-time keys », messages « to-device »), adaptée au
// contexte de l'administration burkinabè (enrôlement, rôles, canaux).
// ============================================================================

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');

const { db, DOSSIER_FICHIERS, journaliser } = require('./db');
const auth = require('./auth');
const ws = require('./ws');

const routeur = express.Router();

// ————— Utilitaires —————
function membre(salonId, agentId) {
  return !!db.prepare('SELECT 1 FROM membres WHERE salon_id = ? AND agent_id = ?').get(salonId, agentId);
}

function membresDuSalon(salonId) {
  return db.prepare(`
    SELECT a.id, a.identifiant, a.nom_complet, a.ministere, a.fonction, a.role
    FROM membres m JOIN agents a ON a.id = m.agent_id
    WHERE m.salon_id = ?`).all(salonId);
}

function notifierSalon(salonId, objet) {
  for (const m of membresDuSalon(salonId)) ws.pousser(m.id, objet);
}

function estEncadrant(agent) {
  return agent.role === 'admin' || agent.role === 'superviseur';
}

const ALPHABET_CODE = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // sans I, L, O, U (peu lisibles)
function genererCodeEnrolement() {
  const octets = crypto.randomBytes(10);
  let code = '';
  for (const o of octets) code += ALPHABET_CODE[o % ALPHABET_CODE.length];
  return code;
}

// ===========================================================================
// 1) AUTHENTIFICATION ET ENRÔLEMENT
//    « Identité vérifiée : seuls des agents préalablement enrôlés peuvent
//      rejoindre la messagerie » (appel à projets, socle de sécurité).
// ===========================================================================

// L'administrateur génère un code d'enrôlement nominatif (transmis par une
// voie de confiance à l'agent, jamais par la messagerie elle-même).
routeur.post('/admin/codes-enrolement', auth.authentifie, auth.exigerRole('admin'), (req, res) => {
  const { nom_complet, ministere, fonction, role } = req.body || {};
  if (!nom_complet || !ministere || !fonction) {
    return res.status(400).json({ erreur: 'champs_manquants' });
  }
  const roleValide = ['agent', 'superviseur', 'admin'].includes(role) ? role : 'agent';
  const code = genererCodeEnrolement();
  db.prepare(`INSERT INTO codes_enrolement (hachage, nom_complet, ministere, fonction, role, genere_par)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.createHash('sha256').update(code).digest('hex'),
      nom_complet, ministere, fonction, roleValide, req.agent.id);
  journaliser('code_enrolement', req.agent.id, `pour ${nom_complet} (${ministere})`);
  res.status(201).json({ code, nom_complet, ministere, fonction, role: roleValide });
});

// Inscription : exige un code d'enrôlement valide et non utilisé.
// ÉPREUVE « INTRUS » : un compte non enrôlé est rejeté ici (403).
routeur.post('/auth/inscription', (req, res) => {
  const { code_enrolement, identifiant, mot_de_passe } = req.body || {};
  if (!code_enrolement || !identifiant || !mot_de_passe) {
    return res.status(400).json({ erreur: 'champs_manquants' });
  }
  if (!/^[a-z0-9._-]{3,30}$/.test(identifiant)) {
    return res.status(400).json({ erreur: 'identifiant_invalide' });
  }
  if (typeof mot_de_passe !== 'string' || mot_de_passe.length < 8) {
    return res.status(400).json({ erreur: 'mot_de_passe_trop_court' });
  }
  const hachage = crypto.createHash('sha256').update(String(code_enrolement)).digest('hex');
  const code = db.prepare('SELECT * FROM codes_enrolement WHERE hachage = ? AND utilise = 0').get(hachage);
  if (!code) {
    journaliser('inscription_refusee', null, `code invalide pour identifiant=${identifiant}`);
    return res.status(403).json({ erreur: 'code_enrolement_invalide' });
  }
  if (db.prepare('SELECT 1 FROM agents WHERE identifiant = ?').get(identifiant)) {
    return res.status(409).json({ erreur: 'identifiant_deja_pris' });
  }

  const { sel, hachage: hachageMdp } = auth.hacherMotDePasse(mot_de_passe);
  const secretTotp = new (require('otpauth').Secret)({ size: 20 }).base32;
  db.prepare(`INSERT INTO agents (identifiant, nom_complet, ministere, fonction, role, statut, sel, hachage_mot_de_passe, secret_totp)
              VALUES (?, ?, ?, ?, ?, 'en_attente_activation', ?, ?, ?)`)
    .run(identifiant, code.nom_complet, code.ministere, code.fonction, code.role, sel, hachageMdp, secretTotp);
  db.prepare('UPDATE codes_enrolement SET utilise = 1 WHERE id = ?').run(code.id);

  // Le secret TOTP n'est montré qu'une fois, à l'inscription : l'agent le
  // scanne (QR) dans son application d'authentification, puis active son compte.
  const totp = auth.creerTotp(identifiant, secretTotp);
  const uri = totp.toString();
  QRCode.toDataURL(uri, { width: 220, margin: 1 })
    .then((qr) => {
      journaliser('inscription', null, `identifiant=${identifiant} (${code.ministere})`);
      res.status(201).json({ identifiant, secret_totp: secretTotp, uri_totp: uri, qr });
    })
    .catch(() => res.status(201).json({ identifiant, secret_totp: secretTotp, uri_totp: uri, qr: null }));
});

// Activation du second facteur : l'agent prouve qu'il a bien enregistré le
// secret TOTP en fournissant un code valide.
routeur.post('/auth/activer', (req, res) => {
  const { identifiant, code_totp } = req.body || {};
  const agent = db.prepare('SELECT * FROM agents WHERE identifiant = ?').get(identifiant || '');
  if (!agent || agent.statut !== 'en_attente_activation') {
    return res.status(403).json({ erreur: 'activation_impossible' });
  }
  if (!auth.codeTotpValide(agent.secret_totp, agent.identifiant, code_totp || '')) {
    return res.status(401).json({ erreur: 'code_totp_invalide' });
  }
  db.prepare("UPDATE agents SET statut = 'actif' WHERE id = ?").run(agent.id);
  journaliser('activation_2fa', agent.id, '');
  res.json({ ok: true });
});

// Connexion : mot de passe + code TOTP (authentification forte).
routeur.post('/auth/connexion', (req, res) => {
  const { identifiant, mot_de_passe, code_totp } = req.body || {};
  if (auth.estBloque(identifiant || '')) {
    return res.status(429).json({ erreur: 'trop_de_tentatives' });
  }
  const agent = db.prepare('SELECT * FROM agents WHERE identifiant = ?').get(identifiant || '');
  if (!agent) {
    auth.enregistrerEchec(identifiant || '');
    return res.status(401).json({ erreur: 'identifiants_invalides' });
  }
  if (agent.statut === 'revoque') {
    journaliser('connexion_refusee', agent.id, 'compte révoqué');
    return res.status(403).json({ erreur: 'compte_revoque' });
  }
  if (agent.statut === 'en_attente_activation') {
    return res.status(403).json({ erreur: 'activation_requise' });
  }
  const mdpOk = auth.verifierMotDePasse(String(mot_de_passe || ''), agent.sel, agent.hachage_mot_de_passe);
  const totpOk = auth.codeTotpValide(agent.secret_totp, agent.identifiant, code_totp || '');
  if (!mdpOk || !totpOk) {
    auth.enregistrerEchec(agent.identifiant);
    journaliser('echec_connexion', agent.id, '');
    return res.status(401).json({ erreur: 'identifiants_invalides' });
  }
  auth.reinitialiserTentatives(agent.identifiant);
  const { jeton } = auth.creerSession(agent.id);
  res.setHeader('Set-Cookie', auth.cookieSession(jeton));
  journaliser('connexion', agent.id, '');
  res.json({
    agent: {
      id: agent.id, identifiant: agent.identifiant, nom_complet: agent.nom_complet,
      ministere: agent.ministere, fonction: agent.fonction, role: agent.role,
    },
  });
});

routeur.post('/auth/deconnexion', auth.authentifie, (req, res) => {
  const jeton = auth.lireJeton(req);
  db.prepare('DELETE FROM sessions WHERE jeton_hache = ?')
    .run(crypto.createHash('sha256').update(jeton).digest('hex'));
  res.setHeader('Set-Cookie', 'fasomsg_jeton=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

routeur.get('/profil', auth.authentifie, (req, res) => {
  const appareils = db.prepare(
    'SELECT id, cle_ed25519, cle_curve25519, nom, cree_le FROM appareils WHERE agent_id = ? ORDER BY id')
    .all(req.agent.id);
  const a = req.agent;
  res.json({
    agent: { id: a.id, identifiant: a.identifiant, nom_complet: a.nom_complet, ministere: a.ministere, fonction: a.fonction, role: a.role },
    appareils,
  });
});

// ===========================================================================
// 2) APPAREILS ET CLÉS (protocole Matrix adapté)
//    Clés PUBLIQUES uniquement côté serveur ; les clés privées ne quittent
//    jamais le navigateur (picklées dans localStorage).
// ===========================================================================

// Enregistrement de l'appareil (navigateur) d'un agent.
routeur.post('/appareils', auth.authentifie, (req, res) => {
  const { cle_ed25519, cle_curve25519, nom } = req.body || {};
  if (!cle_ed25519 || !cle_curve25519) {
    return res.status(400).json({ erreur: 'cles_manquantes' });
  }
  const existant = db.prepare(
    'SELECT id FROM appareils WHERE agent_id = ? AND cle_ed25519 = ?').get(req.agent.id, cle_ed25519);
  if (existant) return res.json({ appareil_id: existant.id, deja_vu: true });
  const info = db.prepare(
    'INSERT INTO appareils (agent_id, cle_ed25519, cle_curve25519, nom) VALUES (?, ?, ?, ?)')
    .run(req.agent.id, cle_ed25519, cle_curve25519, String(nom || 'appareil').slice(0, 80));
  journaliser('appareil_ajoute', req.agent.id, `appareil=${info.lastInsertRowid}`);
  res.status(201).json({ appareil_id: info.lastInsertRowid });
});

// Publication de clés jetables (one-time keys) Olm — parties publiques.
routeur.post('/keys/upload', auth.authentifie, (req, res) => {
  const { appareil_id, cles } = req.body || {};
  const appareil = db.prepare('SELECT id FROM appareils WHERE id = ? AND agent_id = ?')
    .get(appareil_id, req.agent.id);
  if (!appareil) return res.status(403).json({ erreur: 'appareil_inconnu' });
  const ajouter = db.prepare('INSERT OR REPLACE INTO cles_jetables (appareil_id, cle_id, cle) VALUES (?, ?, ?)');
  for (const k of Array.isArray(cles) ? cles : []) {
    if (typeof k.id === 'string' && typeof k.cle === 'string') ajouter.run(appareil_id, k.id.slice(0, 64), k.cle.slice(0, 128));
  }
  const restantes = db.prepare('SELECT COUNT(*) AS n FROM cles_jetables WHERE appareil_id = ?').get(appareil_id).n;
  res.json({ restantes });
});

// Réservation (claim) d'une clé jetable : consommée et renvoyée une seule
// fois. C'est le mécanisme du protocole Matrix/Olm pour établir une session
// 1-pour-1 avec un appareil distant.
routeur.post('/keys/claim', auth.authentifie, (req, res) => {
  const { cibles } = req.body || {};
  const resultat = {};
  const prendre = db.prepare(
    'SELECT cle_id, cle FROM cles_jetables WHERE appareil_id = ? ORDER BY cle_id LIMIT 1');
  const effacer = db.prepare('DELETE FROM cles_jetables WHERE appareil_id = ? AND cle_id = ?');
  for (const c of Array.isArray(cibles) ? cibles : []) {
    const appareil = db.prepare(`
      SELECT ap.id FROM appareils ap JOIN agents a ON a.id = ap.agent_id
      WHERE ap.id = ? AND a.statut = 'actif'`).get(c.appareil_id);
    if (!appareil) continue;               // appareil inconnu ou agent révoqué
    const cle = prendre.get(c.appareil_id);
    if (cle) {
      effacer.run(c.appareil_id, cle.cle_id);
      resultat[c.appareil_id] = { cle_id: cle.cle_id, cle: cle.cle };
    }
  }
  res.json({ cles: resultat });
});

// Clés d'identité PUBLIQUES d'appareils (pour chiffrer vers eux).
routeur.get('/keys/query', auth.authentifie, (req, res) => {
  const ids = String(req.query.appareils || '').split(',').filter(Boolean).map(Number);
  const resultat = [];
  const requete = db.prepare(`
    SELECT ap.id, ap.agent_id, ap.cle_ed25519, ap.cle_curve25519, a.identifiant, a.statut
    FROM appareils ap JOIN agents a ON a.id = ap.agent_id WHERE ap.id = ?`);
  for (const id of ids) {
    const ligne = requete.get(id);
    if (ligne && ligne.statut === 'actif') resultat.push(ligne);
  }
  res.json({ appareils: resultat });
});

// ===========================================================================
// 3) MESSAGES « TO-DEVICE » (acheminement des clés de salon, chiffrés Olm)
// ===========================================================================

routeur.post('/sendToDevice', auth.authentifie, (req, res) => {
  const { destinataires } = req.body || {};
  const inserer = db.prepare(
    'INSERT INTO messages_appareil (agent_id, appareil_id, expediteur_id, ciphertext) VALUES (?, ?, ?, ?)');
  const stmtAgent = db.prepare('SELECT agent_id FROM appareils WHERE id = ?');
  const stmtActif = db.prepare("SELECT statut FROM agents WHERE id = ?");
  let n = 0;
  for (const d of Array.isArray(destinataires) ? destinataires : []) {
    const appareil = stmtAgent.get(d.appareil_id);
    if (!appareil) continue;
    if (stmtActif.get(appareil.agent_id).statut !== 'actif') continue;   // révoqué : rien à recevoir
    if (typeof d.ciphertext !== 'string' || d.ciphertext.length > 70000) continue;
    inserer.run(appareil.agent_id, d.appareil_id, req.agent.id, d.ciphertext);
    ws.pousser(appareil.agent_id, { t: 'toDevice' });
    n += 1;
  }
  res.json({ envoyes: n });
});

// File d'attente « to-device » de MES appareils (poll + poussé par WebSocket).
routeur.get('/toDevice', auth.authentifie, (req, res) => {
  const lignes = db.prepare(`
    SELECT ma.id, ma.appareil_id, ma.expediteur_id, ma.ciphertext, a.identifiant AS expediteur_identifiant
    FROM messages_appareil ma LEFT JOIN agents a ON a.id = ma.expediteur_id
    WHERE ma.agent_id = ? ORDER BY ma.id LIMIT 300`).all(req.agent.id);
  res.json({ messages: lignes });
});

routeur.post('/toDevice/ack', auth.authentifie, (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 300);
  const effacer = db.prepare('DELETE FROM messages_appareil WHERE id = ? AND agent_id = ?');
  for (const id of ids) effacer.run(Number(id), req.agent.id);
  res.json({ ok: true });
});

// ===========================================================================
// 4) SALONS : conversations directes, groupes de travail, canaux
// ===========================================================================

routeur.get('/salons', auth.authentifie, (req, res) => {
  const salons = db.prepare(`
    SELECT s.id, s.nom, s.type, s.ministere, s.ecriture, s.epoch,
           (SELECT COUNT(*) FROM membres m2 WHERE m2.salon_id = s.id) AS nb_membres,
           COALESCE((SELECT MAX(m.id) FROM messages m WHERE m.salon_id = s.id), 0) AS dernier_id
    FROM salons s
    JOIN membres m ON m.salon_id = s.id AND m.agent_id = ?
    ORDER BY dernier_id DESC, s.id DESC`).all(req.agent.id);
  res.json({ salons });
});

// Trouve (ou crée) la conversation directe avec un autre agent.
routeur.post('/direct', auth.authentifie, (req, res) => {
  const { avec } = req.body || {};
  const autre = db.prepare("SELECT * FROM agents WHERE identifiant = ? AND statut = 'actif'").get(avec || '');
  if (!autre || autre.id === req.agent.id) return res.status(400).json({ erreur: 'destinataire_invalide' });

  const existant = db.prepare(`
    SELECT s.id FROM salons s
    WHERE s.type = 'direct'
      AND (SELECT COUNT(*) FROM membres m WHERE m.salon_id = s.id) = 2
      AND EXISTS (SELECT 1 FROM membres m WHERE m.salon_id = s.id AND m.agent_id = ?)
      AND EXISTS (SELECT 1 FROM membres m WHERE m.salon_id = s.id AND m.agent_id = ?)`)
    .get(req.agent.id, autre.id);
  if (existant) return res.json({ salon_id: existant.id, deja_vu: true });

  const info = db.prepare("INSERT INTO salons (type, cree_par) VALUES ('direct', ?)").run(req.agent.id);
  db.prepare('INSERT INTO membres (salon_id, agent_id) VALUES (?, ?)').run(info.lastInsertRowid, req.agent.id);
  db.prepare('INSERT INTO membres (salon_id, agent_id) VALUES (?, ?)').run(info.lastInsertRowid, autre.id);
  notifierSalon(info.lastInsertRowid, { t: 'salons' });
  res.status(201).json({ salon_id: info.lastInsertRowid });
});

// Création d'un groupe ou d'un canal institutionnel.
routeur.post('/salons', auth.authentifie, (req, res) => {
  const { type, nom, membres, ecriture } = req.body || {};
  const stmtActif = db.prepare("SELECT id FROM agents WHERE identifiant = ? AND statut = 'actif'");

  if (type === 'groupe') {
    if (!nom || typeof nom !== 'string') return res.status(400).json({ erreur: 'nom_manquant' });
    const ids = new Set([req.agent.id]);
    for (const ident of Array.isArray(membres) ? membres.slice(0, 50) : []) {
      const a = stmtActif.get(ident);
      if (a) ids.add(a.id);
    }
    const info = db.prepare("INSERT INTO salons (nom, type, ecriture, cree_par) VALUES (?, 'groupe', 'tous', ?)")
      .run(nom.slice(0, 80), req.agent.id);
    const ajouter = db.prepare('INSERT INTO membres (salon_id, agent_id) VALUES (?, ?)');
    for (const id of ids) ajouter.run(info.lastInsertRowid, id);
    notifierSalon(info.lastInsertRowid, { t: 'salons' });
    journaliser('salon_cree', req.agent.id, `groupe « ${nom} »`);
    return res.status(201).json({ salon_id: info.lastInsertRowid });
  }

  if (type === 'canal') {
    // Canal institutionnel : réservé aux encadrants (admin/superviseur).
    if (!estEncadrant(req.agent)) return res.status(403).json({ erreur: 'role_insuffisant' });
    if (!nom) return res.status(400).json({ erreur: 'nom_manquant' });
    const ecr = ['tous', 'encadrants'].includes(ecriture) ? ecriture : 'encadrants';
    const info = db.prepare("INSERT INTO salons (nom, type, ministere, ecriture, cree_par) VALUES (?, 'canal', ?, ?, ?)")
      .run(nom.slice(0, 80), (req.body?.ministere || req.agent.ministere).slice(0, 80), ecr, req.agent.id);
    const ajouter = db.prepare('INSERT INTO membres (salon_id, agent_id) VALUES (?, ?)');
    ajouter.run(info.lastInsertRowid, req.agent.id);
    for (const ident of Array.isArray(membres) ? membres.slice(0, 200) : []) {
      const a = stmtActif.get(ident);
      if (a) ajouter.run(info.lastInsertRowid, a.id);
    }
    notifierSalon(info.lastInsertRowid, { t: 'salons' });
    journaliser('canal_cree', req.agent.id, `canal « ${nom} »`);
    return res.status(201).json({ salon_id: info.lastInsertRowid });
  }

  return res.status(400).json({ erreur: 'type_invalide' });
});

// Détail d'un salon : membres + clés PUBLIQUES de leurs appareils + epoch.
routeur.get('/salons/:id', auth.authentifie, (req, res) => {
  const id = Number(req.params.id);
  const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(id);
  if (!salon || !membre(id, req.agent.id)) return res.status(403).json({ erreur: 'salon_inaccessible' });
  const stmtAppareils = db.prepare(
    'SELECT id, cle_ed25519, cle_curve25519 FROM appareils WHERE agent_id = ?');
  const membres = membresDuSalon(id).map((m) => ({ ...m, appareils: stmtAppareils.all(m.id) }));
  res.json({ salon, membres });
});

// Ajout d'un membre (propriétaire du salon ou encadrant).
// ÉPREUVE « INTRUS » : personne ne peut s'ajouter seul à un salon.
routeur.post('/salons/:id/membres', auth.authentifie, (req, res) => {
  const id = Number(req.params.id);
  const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(id);
  if (!salon || !membre(id, req.agent.id)) return res.status(403).json({ erreur: 'salon_inaccessible' });
  if (salon.type === 'direct') return res.status(400).json({ erreur: 'salon_direct_immuable' });
  if (salon.cree_par !== req.agent.id && !estEncadrant(req.agent)) {
    return res.status(403).json({ erreur: 'role_insuffisant' });
  }
  const cible = db.prepare("SELECT * FROM agents WHERE identifiant = ? AND statut = 'actif'")
    .get(req.body?.identifiant || '');
  if (!cible) return res.status(404).json({ erreur: 'agent_introuvable' });
  if (membre(id, cible.id)) return res.json({ ok: true, deja_membre: true });

  db.prepare('INSERT INTO membres (salon_id, agent_id) VALUES (?, ?)').run(id, cible.id);
  // Changement de membre => rotation obligatoire de la session Megolm.
  db.prepare('UPDATE salons SET epoch = epoch + 1 WHERE id = ?').run(id);
  const epoch = db.prepare('SELECT epoch FROM salons WHERE id = ?').get(id).epoch;
  notifierSalon(id, { t: 'membres', salon_id: id, epoch });
  journaliser('membre_ajoute', req.agent.id, `salon=${id} agent=${cible.identifiant}`);
  res.json({ ok: true, epoch });
});

// Retrait d'un membre (propriétaire/encadrant, ou départ volontaire).
routeur.post('/salons/:id/retrait', auth.authentifie, (req, res) => {
  const id = Number(req.params.id);
  const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(id);
  if (!salon || !membre(id, req.agent.id)) return res.status(403).json({ erreur: 'salon_inaccessible' });
  const cible = db.prepare('SELECT * FROM agents WHERE identifiant = ?').get(req.body?.identifiant || '');
  if (!cible || !membre(id, cible.id)) return res.status(404).json({ erreur: 'agent_introuvable' });
  if (cible.id !== req.agent.id && salon.cree_par !== req.agent.id && !estEncadrant(req.agent)) {
    return res.status(403).json({ erreur: 'role_insuffisant' });
  }
  db.prepare('DELETE FROM membres WHERE salon_id = ? AND agent_id = ?').run(id, cible.id);
  db.prepare('UPDATE salons SET epoch = epoch + 1 WHERE id = ?').run(id);
  const epoch = db.prepare('SELECT epoch FROM salons WHERE id = ?').get(id).epoch;
  notifierSalon(id, { t: 'membres', salon_id: id, epoch });
  ws.pousser(cible.id, { t: 'salons' });
  journaliser('membre_retire', req.agent.id, `salon=${id} agent=${cible.identifiant}`);
  res.json({ ok: true, epoch });
});

// Envoi d'un message (ENVELOPPE CHIFFRÉE Megolm uniquement).
routeur.post('/salons/:id/messages', auth.authentifie, (req, res) => {
  const id = Number(req.params.id);
  const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(id);
  if (!salon || !membre(id, req.agent.id)) return res.status(403).json({ erreur: 'salon_inaccessible' });
  if (salon.ecriture === 'encadrants' && !estEncadrant(req.agent)) {
    return res.status(403).json({ erreur: 'canal_en_lecture_seule' });
  }
  const { session_id, ciphertext, expire_le } = req.body || {};
  if (!session_id || typeof ciphertext !== 'string' || ciphertext.length === 0 || ciphertext.length > 131072) {
    return res.status(400).json({ erreur: 'message_invalide' });
  }
  // TTL serveur : horodatage brut, sans libellé de classification (minimisation).
  let expiration = null;
  if (expire_le) {
    const t = Date.parse(expire_le);
    if (Number.isNaN(t)) return res.status(400).json({ erreur: 'expiration_invalide' });
    const max = Date.now() + 30 * 24 * 3600e3;
    expiration = new Date(Math.min(t, max)).toISOString();
  }
  const info = db.prepare(
    'INSERT INTO messages (salon_id, expediteur_id, session_id, ciphertext, expire_le) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.agent.id, String(session_id).slice(0, 64), ciphertext, expiration);
  const message = {
    id: info.lastInsertRowid, salon_id: id, expediteur_id: req.agent.id,
    session_id, ciphertext, expire_le: expiration,
    envoye_le: new Date().toISOString(),
  };
  notifierSalon(id, { t: 'message', salon_id: id, message });
  res.status(201).json({ id: info.lastInsertRowid });
});

// Historique d'un salon (enveloppes chiffrées), pour rattrapage hors ligne.
routeur.get('/salons/:id/messages', auth.authentifie, (req, res) => {
  const id = Number(req.params.id);
  if (!membre(id, req.agent.id)) return res.status(403).json({ erreur: 'salon_inaccessible' });
  const apres = Number(req.query.apres || 0);
  const messages = db.prepare(`
    SELECT id, salon_id, expediteur_id, session_id, ciphertext, expire_le, envoye_le
    FROM messages WHERE salon_id = ? AND id > ? ORDER BY id LIMIT 200`).all(id, apres);
  res.json({ messages });
});

// ===========================================================================
// 5) FICHIERS CHIFFRÉS (AES-GCM côté client, clé transportée dans le message)
// ===========================================================================

const TAILLE_MAX_FICHIER = 10 * 1024 * 1024; // 10 Mo de blob chiffré

routeur.post('/fichiers', auth.authentifie, (req, res) => {
  const { salon_id, contenu, empreinte, expire_le } = req.body || {};
  if (!membre(Number(salon_id), req.agent.id)) return res.status(403).json({ erreur: 'salon_inaccessible' });
  if (typeof contenu !== 'string') return res.status(400).json({ erreur: 'contenu_manquant' });
  const octets = Buffer.from(contenu, 'base64');
  if (octets.length === 0 || octets.length > TAILLE_MAX_FICHIER) {
    return res.status(413).json({ erreur: 'fichier_trop_volumineux' });
  }
  const id = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(DOSSIER_FICHIERS, `${id}.bin`), octets);
  db.prepare('INSERT INTO fichiers (id, salon_id, nom_chiffre, taille, empreinte, expire_le) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, Number(salon_id), `${id}.bin`, octets.length, String(empreinte || '').slice(0, 128), expire_le || null);
  res.status(201).json({ id, taille: octets.length });
});

routeur.get('/fichiers/:id', auth.authentifie, (req, res) => {
  const f = db.prepare('SELECT * FROM fichiers WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ erreur: 'fichier_introuvable' });
  if (!membre(f.salon_id, req.agent.id)) return res.status(403).json({ erreur: 'acces_refuse' });
  const chemin = path.join(DOSSIER_FICHIERS, f.nom_chiffre);
  if (!fs.existsSync(chemin)) return res.status(404).json({ erreur: 'fichier_absent' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', f.taille);
  fs.createReadStream(chemin).pipe(res);
});

// ===========================================================================
// 6) ANNUAIRE OFFICIEL (par ministère et par fonction)
// ===========================================================================

routeur.get('/annuaire', auth.authentifie, (req, res) => {
  const agents = db.prepare(`
    SELECT id, identifiant, nom_complet, ministere, fonction, role
    FROM agents WHERE statut = 'actif' ORDER BY ministere, nom_complet`).all();
  res.json({ agents });
});

// ===========================================================================
// 7) ADMINISTRATION : agents, révocation immédiate, journal d'audit
// ===========================================================================

routeur.get('/admin/agents', auth.authentifie, auth.exigerRole('admin'), (req, res) => {
  const agents = db.prepare(`
    SELECT id, identifiant, nom_complet, ministere, fonction, role, statut, cree_le
    FROM agents ORDER BY ministere, nom_complet`).all();
  res.json({ agents });
});

routeur.get('/admin/codes-enrolement', auth.authentifie, auth.exigerRole('admin'), (req, res) => {
  const codes = db.prepare(`
    SELECT c.id, c.nom_complet, c.ministere, c.fonction, c.role, c.utilise, c.genere_le, a.identifiant AS genere_par
    FROM codes_enrolement c LEFT JOIN agents a ON a.id = c.genere_par
    ORDER BY c.id DESC LIMIT 100`).all();
  res.json({ codes });
});

// RÉVOCATION IMMÉDIATE (épreuve en direct du jury) :
//  1. le compte passe au statut « révoqué » => plus aucune connexion possible ;
//  2. toutes ses sessions sont détruites => API immédiatement inaccessible ;
//  3. ses clés jetables et sa file to-device sont purgées ;
//  4. il est retiré de tous les salons et l'epoch de chaque salon augmente :
//     les membres restants DOIVENT recréer une session Megolm neuve, dont la
//     clé n'est partagée qu'aux membres restants => l'agent révoqué ne peut
//     déchiffrer AUCUN nouveau message, même en possession de ses anciennes
//     clés ;
//  5. ses connexions WebSocket reçoivent « revocation » (effacement local des
//     données à distance) puis sont fermées.
routeur.post('/admin/agents/:id/revoquer', auth.authentifie, auth.exigerRole('admin'), (req, res) => {
  const cible = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(req.params.id));
  if (!cible) return res.status(404).json({ erreur: 'agent_introuvable' });
  if (cible.id === req.agent.id) return res.status(400).json({ erreur: 'auto_revocation_interdite' });
  if (cible.statut === 'revoque') return res.json({ ok: true, deja_revoque: true });

  db.prepare("UPDATE agents SET statut = 'revoque' WHERE id = ?").run(cible.id);
  auth.detruireSessions(cible.id);
  db.prepare('DELETE FROM cles_jetables WHERE appareil_id IN (SELECT id FROM appareils WHERE agent_id = ?)').run(cible.id);
  db.prepare('DELETE FROM messages_appareil WHERE agent_id = ?').run(cible.id);

  const salons = db.prepare('SELECT salon_id FROM membres WHERE agent_id = ?').all(cible.id);
  db.prepare('DELETE FROM membres WHERE agent_id = ?').run(cible.id);
  const majEpoch = db.prepare('UPDATE salons SET epoch = epoch + 1 WHERE id = ?');
  const lireEpoch = db.prepare('SELECT epoch FROM salons WHERE id = ?');
  for (const { salon_id } of salons) {
    majEpoch.run(salon_id);
    notifierSalon(salon_id, { t: 'rotation', salon_id, epoch: lireEpoch.get(salon_id).epoch });
  }
  ws.fermerAgent(cible.id);
  journaliser('revocation', req.agent.id, `agent=${cible.identifiant} (${cible.ministere})`);
  res.json({ ok: true });
});

routeur.get('/admin/journal', auth.authentifie, auth.exigerRole('admin'), (req, res) => {
  const lignes = db.prepare(`
    SELECT j.evenement, j.details, j.date, a.identifiant
    FROM journal j LEFT JOIN agents a ON a.id = j.agent_id
    ORDER BY j.id DESC LIMIT 200`).all();
  res.json({ journal: lignes });
});

routeur.get('/sante', (req, res) => res.json({ ok: true, service: 'FasoMsg' }));

module.exports = routeur;
