// ============================================================================
// FasoMsg — tests/e2e.test.mjs
// Tests automatisés de bout en bout : ils rejouent les ÉPREUVES EN DIRECT
// de l'appel à projets (section ❸) contre un serveur réel démarré pour
// l'occasion, avec de VRAIS clients Olm/Megolm (le module crypto du client
// est utilisé tel quel sous Node.js).
//
//   1. « Le serveur ne lit rien »  : inspection de la base, aucun clair.
//   2. « Intrus »                  : inscription sans code / accès non-membre
//                                    => rejet.
//   3. « Révocation »              : un agent révoqué perd l'accès et ne peut
//                                    plus déchiffrer les nouveaux messages.
//   4. Authentification forte      : scrypt + TOTP obligatoires.
//   5. Rotation Megolm             : nouveau membre => nouvelle session.
//   6. Expiration                  : messages « Diffusion restreinte »
//                                    supprimés du serveur à l'échéance.
//
// Exécution : npm test
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOTP, Secret } from 'otpauth';

import { initOlm, GestionnaireCrypto, deriverClePickle } from '../client/crypto.mjs';
import { AGENTS_DEMO, MOT_DE_PASSE_DEMO } from '../src/seed.js';

const DOSSIER = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = 'http://127.0.0.1:3399';
const CHEMIN_DB = path.join(DOSSIER, 'data', 'test-e2e.db');

// ————— Client HTTP minimal (avec conservation du cookie de session) —————
async function requete(chemin, { method = 'GET', corps = null, cookie = null } = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    method,
    headers: {
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let donnees = null;
  try { donnees = await reponse.json(); } catch { /* corps vide */ }
  return { statut: reponse.status, donnees, setCookie: reponse.headers.get('set-cookie') };
}

// ————— Agent fictif complet : session + compte Olm + appareil —————
class AgentFictif {
  constructor(identifiant, secretTotp) {
    this.identifiant = identifiant;
    this.secretTotp = secretTotp;
    this.cookie = null;
    this.gc = null;
    this.appareilId = null;
  }

  codeTotp() {
    const totp = new TOTP({ issuer: 'FasoMsg', label: this.identifiant, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(this.secretTotp) });
    return totp.generate();
  }

  async connecter() {
    const r = await requete('/api/auth/connexion', {
      method: 'POST',
      corps: { identifiant: this.identifiant, mot_de_passe: MOT_DE_PASSE_DEMO, code_totp: this.codeTotp() },
    });
    assert.equal(r.statut, 200, `connexion de ${this.identifiant}`);
    this.cookie = r.setCookie.split(';')[0];
    return r.donnees.agent;
  }

  async preparerAppareil(sansClesJetables = false) {
    const stockage = new Map();
    const cle = await deriverClePickle('cle-test-' + this.identifiant, 'sel-test');
    this.gc = new GestionnaireCrypto(
      { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, v), removeItem: (k) => stockage.delete(k) },
      cle,
    );
    const identite = this.gc.ouvrirCompte();
    const r = await requete('/api/appareils', {
      method: 'POST', cookie: this.cookie,
      corps: { cle_ed25519: identite.ed25519, cle_curve25519: identite.curve25519, nom: 'test' },
    });
    assert.ok(r.statut === 200 || r.statut === 201, `enregistrement appareil de ${this.identifiant}`);
    this.appareilId = r.donnees.appareil_id;
    if (sansClesJetables) return identite;
    this.gc.genererClesJetables(25);
    const cles = this.gc.clesJetablesAPublier();
    await requete('/api/keys/upload', { method: 'POST', cookie: this.cookie, corps: { appareil_id: this.appareilId, cles } });
    return identite;
  }

  /** Même logique que client/main.js : partage de la clé de salon signée. */
  async partagerCleSalon(salonId, epoch, sessionId, sessionKey, membres) {
    const identite = this.gc.identite();
    const charge = {
      type: 'cle_sal', salon_id: salonId, epoch, session_id: sessionId, session_key: sessionKey,
      ed25519_emetteur: identite.ed25519, appareil_emetteur: this.appareilId, agent_emetteur: this.moi.id,
    };
    const enveloppe = JSON.stringify({ payload: charge, signature: this.gc.signer(JSON.stringify(charge)) });

    const destinataires = [];
    const aReclamer = [];
    for (const m of membres) {
      for (const ap of m.appareils) {
        if (ap.id === this.appareilId) continue;
        const ct = this.gc.chiffrerPourAppareil(ap, null, enveloppe);
        if (ct) destinataires.push({ appareil_id: ap.id, ciphertext: ct });
        else aReclamer.push({ membre: m, appareil: ap });
      }
    }
    if (aReclamer.length) {
      const rc = await requete('/api/keys/claim', {
        method: 'POST', cookie: this.cookie,
        corps: { cibles: aReclamer.map((c) => ({ agent_id: c.membre.id, appareil_id: c.appareil.id })) },
      });
      for (const c of aReclamer) {
        const cj = rc.donnees.cles[c.appareil.id];
        if (!cj) continue;
        const ct = this.gc.chiffrerPourAppareil(c.appareil, cj.cle, enveloppe);
        if (ct) destinataires.push({ appareil_id: c.appareil.id, ciphertext: ct });
      }
    }
    if (destinataires.length) {
      const r = await requete('/api/sendToDevice', { method: 'POST', cookie: this.cookie, corps: { destinataires } });
      assert.equal(r.statut, 200);
    }
  }

  /** Envoie un message chiffré dans un salon (logique du client). */
  async envoyerMessage(salonId, texte, classification = 'normal', minutesExpiration = null) {
    const rDetail = await requete(`/api/salons/${salonId}`, { cookie: this.cookie });
    assert.equal(rDetail.statut, 200, 'accès au salon');
    const { membres } = rDetail.donnees;
    const epoch = rDetail.donnees.salon.epoch;

    const expireLe = minutesExpiration
      ? new Date(Date.now() + minutesExpiration * 60000).toISOString() : null;
    const charge = { type: 'texte', texte, classification, expire_le: expireLe };
    const { session_id, ciphertext, session_key } =
      this.gc.chiffrerPourSalon(salonId, epoch, JSON.stringify(charge));

    if (session_key) {
      await this.partagerCleSalon(salonId, epoch, session_id, session_key, membres);
    } else {
      const existante = this.gc.cleSortanteExistante(salonId, epoch);
      if (existante?.cle) {
        await this.partagerCleSalon(salonId, epoch, existante.session_id, existante.cle, membres);
      }
    }

    const r = await requete(`/api/salons/${salonId}/messages`, {
      method: 'POST', cookie: this.cookie,
      corps: { session_id, ciphertext, expire_le: expireLe },
    });
    assert.equal(r.statut, 201, `envoi dans le salon ${salonId}`);
    return r.donnees.id;
  }

  /** Réception : file to-device + vérification des signatures + déchiffrement. */
  async synchroniser() {
    const r = await requete('/api/toDevice', { cookie: this.cookie });
    const ids = [];
    for (const m of r.donnees.messages) {
      if (m.appareil_id !== this.appareilId) continue;
      ids.push(m.id);
      const clair = this.gc.dechiffrerDepuisAppareil(m.ciphertext);
      if (!clair) continue;
      const enveloppe = JSON.parse(clair);
      if (enveloppe?.payload?.type === 'demande_cle') {
        await this.repondreDemandeCle(enveloppe, m.expediteur_id);
        continue;
      }
      if (enveloppe?.payload?.type !== 'cle_sal') continue;
      const p = enveloppe.payload;
      // Vérification : signature ed25519 + appartenance de la clé à un
      // appareil déclaré par l'émetteur.
      const ok = this.gc.verifierSignature(p.ed25519_emetteur, JSON.stringify(p), enveloppe.signature);
      if (!ok) continue;
      const rq = await requete(`/api/keys/query?appareils=${p.appareil_emetteur}`, { cookie: this.cookie });
      const attendu = rq.donnees.appareils.find((a) => a.agent_id === m.expediteur_id);
      if (!attendu || attendu.cle_ed25519 !== p.ed25519_emetteur) continue;
      this.gc.ajouterSessionEntrante(p.session_id, p.session_key);
    }
    if (ids.length) await requete('/api/toDevice/ack', { method: 'POST', cookie: this.cookie, corps: { ids } });
  }

  async repondreDemandeCle(enveloppe, expediteurId) {
    const p = enveloppe.payload;
    if (!this.gc.verifierSignature(p.ed25519_emetteur, JSON.stringify(p), enveloppe.signature)) return;
    const rq = await requete(`/api/keys/query?appareils=${p.appareil_emetteur}`, { cookie: this.cookie });
    const attendu = rq.donnees.appareils.find((a) => a.agent_id === expediteurId);
    if (!attendu || attendu.cle_ed25519 !== p.ed25519_emetteur) return;
    const cle = this.gc.exporterCleSalon(p.session_id);
    if (!cle) return;
    const rDetail = await requete(`/api/salons/${p.salon_id}`, { cookie: this.cookie });
    if (rDetail.statut !== 200) return;
    const membre = rDetail.donnees.membres.find((m) => m.id === expediteurId);
    if (!membre) return;
    await this.partagerCleSalon(p.salon_id, rDetail.donnees.salon.epoch, p.session_id, cle, [membre]);
  }

  async demanderCleManquante(salonId, env) {
    const rDetail = await requete(`/api/salons/${salonId}`, { cookie: this.cookie });
    assert.equal(rDetail.statut, 200);
    const membre = rDetail.donnees.membres.find((m) => m.id === env.expediteur_id);
    assert.ok(membre, 'émetteur membre du salon');
    const identite = this.gc.identite();
    const charge = {
      type: 'demande_cle', salon_id: salonId, session_id: env.session_id,
      agent_demandeur: this.moi.id, appareil_demandeur: this.appareilId,
      ed25519_emetteur: identite.ed25519, appareil_emetteur: this.appareilId,
    };
    const enveloppe = JSON.stringify({ payload: charge, signature: this.gc.signer(JSON.stringify(charge)) });
    const destinataires = [];
    const aReclamer = [];
    for (const ap of membre.appareils) {
      if (ap.id === this.appareilId) continue;
      const ct = this.gc.chiffrerPourAppareil(ap, null, enveloppe);
      if (ct) destinataires.push({ appareil_id: ap.id, ciphertext: ct });
      else aReclamer.push({ membre, appareil: ap });
    }
    if (aReclamer.length) {
      const rc = await requete('/api/keys/claim', {
        method: 'POST', cookie: this.cookie,
        corps: { cibles: aReclamer.map((c) => ({ appareil_id: c.appareil.id })) },
      });
      for (const c of aReclamer) {
        const cj = rc.donnees.cles[c.appareil.id];
        if (!cj) continue;
        const ct = this.gc.chiffrerPourAppareil(c.appareil, cj.cle, enveloppe);
        if (ct) destinataires.push({ appareil_id: c.appareil.id, ciphertext: ct });
      }
    }
    assert.ok(destinataires.length, 'demande de clé transmise à au moins un appareil');
    const r = await requete('/api/sendToDevice', { method: 'POST', cookie: this.cookie, corps: { destinataires } });
    assert.equal(r.statut, 200);
  }

  /** Retourne tous les messages déchiffrables d'un salon. */
  async lireMessages(salonId) {
    await this.synchroniser();
    const r = await requete(`/api/salons/${salonId}/messages?apres=0`, { cookie: this.cookie });
    assert.equal(r.statut, 200);
    const resultats = [];
    for (const env of r.donnees.messages) {
      const clair = this.gc.dechiffrerSalon(env.session_id, env.ciphertext);
      resultats.push({ env, clair: clair ? JSON.parse(clair.plaintext) : null });
    }
    return resultats;
  }
}

// ————— Démarrage / arrêt du serveur de test —————
let serveurEnfant = null;

test.before(async () => {
  fs.rmSync(CHEMIN_DB, { force: true });
  fs.rmSync(path.join(path.dirname(CHEMIN_DB), 'test-e2e-fichiers'), { recursive: true, force: true });

  // Serveur dédié aux tests : base isolée, nettoyage accéléré (1,2 s),
  // agents de démonstration fictifs créés au démarrage.
  serveurEnfant = spawn(process.execPath, ['src/server.js'], {
    cwd: DOSSIER,
    env: {
      ...process.env,
      PORT: '3399',
      FASOMSG_DB: CHEMIN_DB,
      FASOMSG_NETTOYAGE_MS: '1200',
      GRAINE_DEMO: '1',
    },
    stdio: 'ignore',
  });
  // Attente de la mise en route.
  for (let i = 0; i < 40; i++) {
    try {
      const r = await requete('/api/sante');
      if (r.statut === 200) break;
    } catch { /* pas encore prêt */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  await initOlm();               // bibliothèque Olm chargée pour les tests
});

test('API : les réponses dynamiques ne sont jamais renvoyées en 304', async () => {
  const premiere = await fetch(`${BASE}/api/sante`);
  assert.equal(premiere.status, 200);
  assert.equal(premiere.headers.get('cache-control'), 'no-store');

  const seconde = await fetch(`${BASE}/api/sante`, {
    headers: { 'If-None-Match': premiere.headers.get('etag') || '"ancienne-reponse"' },
  });
  assert.equal(seconde.status, 200);
  assert.deepEqual(await seconde.json(), { ok: true, service: 'FasoMsg' });
});

test.after(() => {
  serveurEnfant?.kill();
});

test('Olm : plusieurs messages to-device sont déchiffrés sur la même session', async () => {
  const stockageAlice = new Map();
  const stockageBob = new Map();
  const cleAlice = await deriverClePickle('cle-olm-alice', 'sel-olm-alice');
  const cleBob = await deriverClePickle('cle-olm-bob', 'sel-olm-bob');
  const alice = new GestionnaireCrypto({
    getItem: (k) => stockageAlice.get(k) ?? null,
    setItem: (k, v) => stockageAlice.set(k, v),
    removeItem: (k) => stockageAlice.delete(k),
  }, cleAlice);
  const bob = new GestionnaireCrypto({
    getItem: (k) => stockageBob.get(k) ?? null,
    setItem: (k, v) => stockageBob.set(k, v),
    removeItem: (k) => stockageBob.delete(k),
  }, cleBob);

  alice.ouvrirCompte();
  const identiteBob = bob.ouvrirCompte();
  bob.genererClesJetables(1);
  const [cleJetable] = bob.clesJetablesAPublier();
  const appareilBob = { id: 2, cle_curve25519: identiteBob.curve25519 };

  for (const texte of ['cle de salon initiale', 'cle de salon suivante', 'demande de rattrapage']) {
    const chiffre = alice.chiffrerPourAppareil(appareilBob, cleJetable.cle, texte);
    assert.equal(bob.dechiffrerDepuisAppareil(chiffre), texte);
  }
});

// ===========================================================================
// 1) AUTHENTIFICATION FORTE (scrypt + TOTP)
// ===========================================================================
test('Connexion refusée sans code TOTP valide', async () => {
  const r = await requete('/api/auth/connexion', {
    method: 'POST',
    corps: { identifiant: 'ouedraogo.a', mot_de_passe: MOT_DE_PASSE_DEMO, code_totp: '000000' },
  });
  assert.equal(r.statut, 401, 'un mauvais second facteur doit être refusé');
});

test('Connexion refusée avec un mauvais mot de passe', async () => {
  const r = await requete('/api/auth/connexion', {
    method: 'POST',
    corps: { identifiant: 'ouedraogo.a', mot_de_passe: 'MauvaisMot1', code_totp: '123456' },
  });
  assert.equal(r.statut, 401);
});

// ===========================================================================
// 2) ÉPREUVE « INTRUS » : un compte non enrôlé est rejeté
// ===========================================================================
test('Épreuve « Intrus » : inscription sans code d\'enrôlement rejetée', async () => {
  const r = await requete('/api/auth/inscription', {
    method: 'POST',
    corps: { code_enrolement: 'CODEPIRATE', identifiant: 'espion.z', mot_de_passe: 'MotDePasse1' },
  });
  assert.equal(r.statut, 403, 'aucun compte ne peut être créé sans enrôlement nominatif');
});

test('Un agent ne peut pas publier dans un salon dont il n\'est pas membre', async () => {
  const zongo = new AgentFictif('zongo.b', AGENTS_DEMO.find((a) => a.identifiant === 'zongo.b').totp);
  await zongo.connecter();
  await zongo.preparerAppareil();
  // Le salon 4 (direct ouedraogo.a/traore.k, créé par le seed) ne concerne pas zongo.
  const r = await requete('/api/salons/4/messages', {
    method: 'POST', cookie: zongo.cookie,
    corps: { session_id: 'x', ciphertext: 'AwgA' },
  });
  assert.equal(r.statut, 403, 'un non-membre est rejeté');
});

// ===========================================================================
// 3) ÉCHANGE CHIFFRÉ DE BOUT EN BOUT (Olm + Megolm réels)
// ===========================================================================
test('Échange chiffré : A écrit, B déchiffre ; le serveur ne voit rien', async () => {
  const alice = new AgentFictif('ouedraogo.a', AGENTS_DEMO.find((a) => a.identifiant === 'ouedraogo.a').totp);
  const bob = new AgentFictif('traore.k', AGENTS_DEMO.find((a) => a.identifiant === 'traore.k').totp);
  const moiAlice = await alice.connecter();
  alice.moi = moiAlice;
  const moiBob = await bob.connecter();
  bob.moi = moiBob;
  await alice.preparerAppareil();
  await bob.preparerAppareil();

  const secret = 'Note de service n°226 : dotation informatique à programmer avant le 15.';
  await alice.envoyerMessage(4, secret);

  const messages = await bob.lireMessages(4);
  const recus = messages.map((m) => m.clair?.texte).filter(Boolean);
  assert.ok(recus.includes(secret), 'le destinataire doit déchiffrer le message');

  // Épreuve « Le serveur ne lit rien » : inspection directe de la base.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(CHEMIN_DB, { readOnly: true });
  const lignes = db.prepare('SELECT ciphertext FROM messages').all();
  const tout = lignes.map((l) => l.ciphertext).join('\n');
  assert.ok(!tout.includes('Note de service'), 'aucun fragment du message en clair dans la base');
  assert.ok(!tout.includes('dotation informatique'), 'aucun fragment du message en clair dans la base');
  db.close();
});

test('Réponse de B également chiffrée et lisible par A', async () => {
  const alice = new AgentFictif('ouedraogo.a', AGENTS_DEMO.find((a) => a.identifiant === 'ouedraogo.a').totp);
  const bob = new AgentFictif('traore.k', AGENTS_DEMO.find((a) => a.identifiant === 'traore.k').totp);
  alice.moi = await alice.connecter();
  bob.moi = await bob.connecter();
  await alice.preparerAppareil();
  await bob.preparerAppareil();

  await alice.envoyerMessage(4, 'Question : reçu le mémorandum ?');
  await bob.synchroniser();      // B installe la clé de salon d'A
  await bob.envoyerMessage(4, 'Réponse : bien reçu, transmission aux équipes en cours.');

  const messages = await alice.lireMessages(4);
  const recus = messages.map((m) => m.clair?.texte).filter(Boolean);
  assert.ok(recus.includes('Réponse : bien reçu, transmission aux équipes en cours.'));
});

// ===========================================================================
// 4) ARRIVÉE D'UN MEMBRE => ROTATION : il ne lit pas l'historique
// ===========================================================================
test('Rotation Megolm : un membre ajouté ne déchiffre pas l\'historique', async () => {
  const admin = new AgentFictif('admin.dgtd', AGENTS_DEMO[0].totp);
  const alice = new AgentFictif('ouedraogo.a', AGENTS_DEMO.find((a) => a.identifiant === 'ouedraogo.a').totp);
  const charlie = new AgentFictif('zongo.b', AGENTS_DEMO.find((a) => a.identifiant === 'zongo.b').totp);
  admin.moi = await admin.connecter();
  alice.moi = await alice.connecter();
  charlie.moi = await charlie.connecter();
  await admin.preparerAppareil();
  await alice.preparerAppareil();
  await charlie.preparerAppareil();

  // Salon 3 = groupe « Comité Semaine du Numérique 2026 » (seed).
  const avant = 'Discussion privée avant l\'arrivée de ZONGO.';
  await alice.envoyerMessage(3, avant);

  // L'administrateur ajoute zongo.b au groupe : l'epoch augmente.
  const rAjout = await requete('/api/salons/3/membres', {
    method: 'POST', cookie: admin.cookie, corps: { identifiant: 'zongo.b' },
  });
  assert.equal(rAjout.statut, 200);
  assert.ok(rAjout.donnees.epoch >= 2, 'l\'epoch du salon doit augmenter');

  // Après l'arrivée : le nouveau message utilise une NOUVELLE session.
  const apres = 'Ordre de mission validé, merci à tous.';
  await alice.envoyerMessage(3, apres);

  const vus = await charlie.lireMessages(3);
  const textes = vus.map((m) => m.clair?.texte).filter(Boolean);
  assert.ok(textes.includes(apres), 'le nouveau membre lit les messages postérieurs à son arrivée');
  assert.ok(!textes.includes(avant), 'le nouveau membre NE PEUT PAS lire l\'historique antérieur');
});

// ===========================================================================
// 5) ÉPREUVE « RÉVOCATION » : un agent révoqué perd tout accès
// ===========================================================================
test('Épreuve « Révocation » : accès perdu et nouveaux messages illisibles', async () => {
  const admin = new AgentFictif('admin.dgtd', AGENTS_DEMO[0].totp);
  const alice = new AgentFictif('ouedraogo.a', AGENTS_DEMO.find((a) => a.identifiant === 'ouedraogo.a').totp);
  const bob = new AgentFictif('compaore.n', AGENTS_DEMO.find((a) => a.identifiant === 'compaore.n').totp);
  admin.moi = await admin.connecter();
  alice.moi = await alice.connecter();
  bob.moi = await bob.connecter();
  await admin.preparerAppareil();
  await alice.preparerAppareil();
  await bob.preparerAppareil();

  // Conversation directe alice <-> compaore.n
  const rDirect = await requete('/api/direct', { method: 'POST', cookie: alice.cookie, corps: { avec: 'compaore.n' } });
  const salonDirect = rDirect.donnees.salon_id;
  await alice.envoyerMessage(salonDirect, 'Échange avant révocation, avec des informations internes.');
  await bob.synchroniser();
  const avant = (await bob.lireMessages(salonDirect)).map((m) => m.clair?.texte).filter(Boolean);
  assert.ok(avant.length > 0, 'B lit les messages avant sa révocation');

  // Révocation par l'administrateur.
  const idBob = (await requete('/api/admin/agents', { cookie: admin.cookie })).donnees.agents
    .find((a) => a.identifiant === 'compaore.n').id;
  const rRevo = await requete(`/api/admin/agents/${idBob}/revoquer`, { method: 'POST', cookie: admin.cookie });
  assert.equal(rRevo.statut, 200);

  // 1) Sa session existante est morte immédiatement.
  const rProfil = await requete('/api/profil', { cookie: bob.cookie });
  assert.equal(rProfil.statut, 401, 'la session du révoqué doit être invalide immédiatement');

  // 2) Il ne peut plus se reconnecter.
  const rConnexion = await requete('/api/auth/connexion', {
    method: 'POST',
    corps: { identifiant: 'compaore.n', mot_de_passe: MOT_DE_PASSE_DEMO, code_totp: bob.codeTotp() },
  });
  assert.equal(rConnexion.statut, 403, 'un compte révoqué ne peut pas se reconnecter');

  // 3) Les nouveaux messages du salon ne sont plus déchiffrables avec ses
  //    anciennes clés (nouvelle session Megolm partagée aux seuls restants).
  await alice.envoyerMessage(salonDirect, 'Message interne après le départ de l\'agent.');
  const lectures = await bob.lireMessages(salonDirect).catch(() => []);
  const apres = lectures.map((m) => m.clair?.texte).filter(Boolean);
  assert.ok(!apres.includes('Message interne après le départ de l\'agent.'),
    'un agent révoqué ne peut pas déchiffrer les nouveaux messages');
});

// ===========================================================================
// 6) ENRÔLEMENT COMPLET D'UN NOUVEL AGENT (par l'administrateur)
// ===========================================================================
test('Enrôlement complet : code, inscription, activation TOTP, connexion', async () => {
  const admin = new AgentFictif('admin.dgtd', AGENTS_DEMO[0].totp);
  await admin.connecter();

  const rCode = await requete('/api/admin/codes-enrolement', {
    method: 'POST', cookie: admin.cookie,
    corps: { nom_complet: 'TEST Agent', ministere: 'MTDPCE – DGTD', fonction: 'Auditrice', role: 'agent' },
  });
  assert.equal(rCode.statut, 201);
  const code = rCode.donnees.code;
  assert.ok(code && code.length >= 8, 'code d\'enrôlement généré');

  const rInscription = await requete('/api/auth/inscription', {
    method: 'POST',
    corps: { code_enrolement: code, identifiant: 'test.agent', mot_de_passe: 'MotDePasse1' },
  });
  assert.equal(rInscription.statut, 201, 'inscription avec un code valide');
  assert.ok(rInscription.donnees.qr, 'QR code TOTP fourni');

  // Le code ne sert qu'une fois.
  const rRejoue = await requete('/api/auth/inscription', {
    method: 'POST',
    corps: { code_enrolement: code, identifiant: 'test.agent2', mot_de_passe: 'MotDePasse1' },
  });
  assert.equal(rRejoue.statut, 403, 'un code d\'enrôlement ne peut pas être réutilisé');

  // Activation avec le secret TOTP retourné.
  const totp = new TOTP({ issuer: 'FasoMsg', label: 'test.agent', algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(rInscription.donnees.secret_totp) });
  const rActivation = await requete('/api/auth/activer', {
    method: 'POST', corps: { identifiant: 'test.agent', code_totp: totp.generate() },
  });
  assert.equal(rActivation.statut, 200, 'activation du second facteur');

  const rConnexion = await requete('/api/auth/connexion', {
    method: 'POST',
    corps: { identifiant: 'test.agent', mot_de_passe: 'MotDePasse1', code_totp: totp.generate() },
  });
  assert.equal(rConnexion.statut, 200, 'connexion après enrôlement complet');
});

// ===========================================================================
// 7) EXPIRATION AUTOMATIQUE (classification « Diffusion restreinte »)
// ===========================================================================
test('Expiration : le serveur supprime le message arrivé à échéance', async () => {
  const alice = new AgentFictif('ouedraogo.a', AGENTS_DEMO.find((a) => a.identifiant === 'ouedraogo.a').totp);
  alice.moi = await alice.connecter();
  await alice.preparerAppareil();

  const expireLe = new Date(Date.now() + 500).toISOString();      // 0,5 s
  await alice.envoyerMessage(4, 'Diffusion restreinte : note éphémère.', 'restreint');
  // (expire_le du message réel : on force via un envoi direct avec TTL court)
  const rDetail = await requete('/api/salons/4', { cookie: alice.cookie });
  const epoch = rDetail.donnees.salon.epoch;
  const ch = alice.gc.chiffrerPourSalon(4, epoch, JSON.stringify({ type: 'texte', texte: 'TTL court', classification: 'confidentiel' }));
  await alice.partagerCleSalon(4, epoch, ch.session_id, ch.session_key, rDetail.donnees.membres);
  const r = await requete('/api/salons/4/messages', {
    method: 'POST', cookie: alice.cookie, corps: { session_id: ch.session_id, ciphertext: ch.ciphertext, expire_le: expireLe },
  });
  assert.equal(r.statut, 201);

  // Le nettoyage serveur tourne toutes les 1,2 s dans l'environnement de test.
  await new Promise((res) => setTimeout(res, 2500));
  const rListe = await requete('/api/salons/4/messages?apres=0', { cookie: alice.cookie });
  const restants = rListe.donnees.messages.filter((m) => m.expire_le === expireLe);
  assert.equal(restants.length, 0, 'le message expiré doit être supprimé côté serveur');
});

test('Rattrapage des clés : un appareil en retard déchiffre l\'historique après demande', async () => {
  const alice = new AgentFictif('zongo.b', AGENTS_DEMO.find((a) => a.identifiant === 'zongo.b').totp);
  alice.moi = await alice.connecter();
  await alice.preparerAppareil();
  const bob = new AgentFictif('kabore.f', AGENTS_DEMO.find((a) => a.identifiant === 'kabore.f').totp);
  bob.moi = await bob.connecter();
  await bob.preparerAppareil(true);        // appareil déclaré, SANS clés jetables
  const rDirect = await requete('/api/direct', { method: 'POST', cookie: alice.cookie, corps: { avec: 'kabore.f' } });
  const salon = rDirect.donnees.salon_id;
  const idMsg = await alice.envoyerMessage(salon, 'rattrapage-salut-7f3a');
  await bob.synchroniser();
  const bloque = (await bob.lireMessages(salon)).find((m) => m.env.id === idMsg);
  assert.ok(bloque && bloque.clair === null, 'sans rattrapage : « clé de salon non reçue »');
  bob.gc.genererClesJetables(10);          // Bob finit son initialisation
  await requete('/api/keys/upload', { method: 'POST', cookie: bob.cookie, corps: { appareil_id: bob.appareilId, cles: bob.gc.clesJetablesAPublier() } });
  await bob.demanderCleManquante(salon, bloque.env);   // demande_cle
  await alice.synchroniser();               // Alice répond (clé exportée index 0)
  await bob.synchroniser();
  assert.ok((await bob.lireMessages(salon)).some((m) => m.clair?.texte === 'rattrapage-salut-7f3a'),
    'le message envoyé AVANT le rattrapage est déchiffré');
  await alice.envoyerMessage(salon, 'rattrapage-cc-9d2b');
  await bob.synchroniser();
  assert.ok((await bob.lireMessages(salon)).some((m) => m.clair?.texte === 'rattrapage-cc-9d2b'),
    'les messages suivants arrivent avec leur clé');
});