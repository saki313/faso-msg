// ============================================================================
// FasoMsg — client/main.js
// Orchestrateur : démarrage, authentification, partage des clés de salon,
// envoi/réception chiffrés, révocation, administration.
//
// FLUX DE CHIFFREMENT (vue d'ensemble, voir docs/EXPLICATION_CODE.md) :
//  1. Chaque navigateur crée un compte Olm (clés privées scellées localement).
//  2. Pour écrire dans un salon, l'appareil crée une session Megolm et
//     partage sa clé aux autres appareils via des sessions Olm 1-pour-1
//     (« to-device »), signées ed25519.
//  3. Les messages sont chiffrés Megolm ; le serveur relaie sans rien lire.
//  4. À chaque changement de membre (ajout, départ, révocation), l'« epoch »
//     du salon augmente : nouvelle session Megolm obligatoire.
// ============================================================================

import {
  initOlm, GestionnaireCrypto, deriverClePickle,
  chiffrerFichier, dechiffrerFichier, cleAleatoire, esc,
} from './crypto.js';
import * as api from './api.js';
import { t, setLangue, getLangue } from './i18n.js';
import * as ui from './ui.js';

const etat = {
  agent: null,            // agent connecté
  appareilId: null,       // id de l'appareil courant (navigateur)
  gc: null,               // GestionnaireCrypto (Olm/Megolm)
  salons: [],
  salonActifId: null,
  detail: null,           // détail du salon actif (membres, appareils, epoch)
  detailHorodatage: 0,
  messages: {},           // salonId -> [ {env, contenu, expediteur} | {echec} | {expiré} ]
  vus: {},                // salonId -> dernier id rendu
  badges: {},
  ws: null,
  ongletAdmin: 'agents',
  fichierEnAttente: null, // { nom, mime, taille, octets }
};

const stockageLocal = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};

const $ = (sel) => document.querySelector(sel);
const panneau = () => $('#panneau-principal');

// ————— Démarrage —————
async function demarrer() {
  setLangue((() => { try { return localStorage.getItem('fasomsg:langue') || 'fr'; } catch { return 'fr'; } })());
  await initOlm(() => 'olm.wasm');       // bibliothèque Olm compilée en WebAssembly
  try {
    const p = await api.profil();
    const cle = (() => { try { return sessionStorage.getItem('fasomsg:cle'); } catch { return null; } })();
    if (cle) return ouvrirSession(p.agent, cle);
    return montrerConnexion('deverrouillage');
  } catch {
    montrerConnexion('connexion');
  }
}

function montrerConnexion(mode, options = {}) {
  document.body.innerHTML = ui.pageConnexion({ mode, ...options });
  const formulaire = $('form.carte-connexion');
  formulaire?.addEventListener('submit', (e) => { e.preventDefault(); soumettreFormulaire(mode, formulaire); });
}

async function soumettreFormulaire(mode, formulaire) {
  const f = new FormData(formulaire);
  const identifiant = String(f.get('identifiant') || '');
  const motDePasse = String(f.get('mot_de_passe') || '');
  try {
    if (mode === 'connexion') {
      const r = await api.connexion(identifiant, motDePasse, String(f.get('code_totp') || ''));
      const cle = await preparerCleLocale(motDePasse);
      ouvrirSession(r.agent, cle);
    } else if (mode === 'deverrouillage') {
      const cle = await preparerCleLocale(motDePasse);
      const p = await api.profil();
      ouvrirSession(p.agent, cle);
    } else if (mode === 'inscription') {
      const r = await api.inscription(String(f.get('code_enrolement') || ''), identifiant, motDePasse);
      montrerConnexion('activation', { qr: r.qr, secret: r.secret_totp, identifiant: r.identifiant });
    } else if (mode === 'activation') {
      await api.activer(identifiant, String(f.get('code_totp') || ''));
      montrerConnexion('connexion', { info: 'Compte activé. Connectez-vous avec votre mot de passe et un code de votre application d\u2019authentification.' });
    }
  } catch (erreur) {
    console.error('[FasoMsg] erreur de formulaire', erreur);
    alert(messageErreur(erreur));
  }
}

/** Sel local + clé de scellement dérivée du mot de passe (PBKDF2). */
async function preparerCleLocale(motDePasse) {
  let sel = localStorage.getItem('fasomsg:sel');
  if (!sel) {
    sel = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('fasomsg:sel', sel);
  }
  const cle = await deriverClePickle(motDePasse, sel);
  try { sessionStorage.setItem('fasomsg:cle', cle); } catch {}
  return cle;
}

function messageErreur(erreur) {
  const table = {
    identifiants_invalides: 'Identifiants invalides (vérifiez le mot de passe et le code à 6 chiffres).',
    compte_revoque: 'Ce compte a été révoqué.',
    activation_requise: 'Activez d\u2019abord votre second facteur (TOTP).',
    trop_de_tentatives: 'Trop de tentatives. Réessayez dans 15 minutes.',
    code_enrolement_invalide: 'Code d\u2019enrôlement inconnu ou déjà utilisé.',
    identifiant_deja_pris: 'Cet identifiant existe déjà.',
    code_totp_invalide: 'Code TOTP invalide.',
  };
  return table[erreur.message] || `Erreur : ${erreur.message}`;
}

// ————— Ouverture de session (après authentification) —————
async function ouvrirSession(agent, clePickle) {
  etat.agent = agent;
  etat.gc = new GestionnaireCrypto(stockageLocal, clePickle);

  let identite;
  try {
    identite = etat.gc.ouvrirCompte();       // charge ou crée les clés de l'appareil
  } catch (erreur) {
    console.error('[FasoMsg] ouverture du compte Olm impossible', erreur);
    alert('Mot de passe incorrect : impossible de déverrouiller les clés locales.');
    try { sessionStorage.removeItem('fasomsg:cle'); } catch {}
    return montrerConnexion('deverrouillage');
  }

  const appareil = await api.enregistrerAppareil(identite.ed25519, identite.curve25519,
    (navigator.userAgent || 'appareil').slice(0, 60));
  etat.appareilId = appareil.appareil_id;

  await completerClesJetables(25);
  await rafraichirSalons();
  connecterWebSocket();

  document.body.innerHTML = ui.squelette(agent);
  rendreBarreLaterale();
  if (etat.salons.length) ouvrirSalon(etat.salons[0].id);
  else { panneau().innerHTML = `<div class="fil-vide">${esc(t('aucun_salon'))}</div>`; }
}

async function completerClesJetables(n) {
  etat.gc.genererClesJetables(n);
  const aPublier = etat.gc.clesJetablesAPublier();
  if (aPublier.length) await api.publierCles(etat.appareilId, aPublier);
}

async function rafraichirSalons() {
  const r = await api.salons();
  etat.salons = r.salons;
  // Nom lisible des conversations directes : l'autre membre.
  for (const s of etat.salons) {
    if (s.type === 'direct' && !s.nom_autre) s.nom_autre = await nomDirect(s.id);
  }
}

async function nomDirect(salonId) {
  const d = await api.salon(salonId).catch(() => null);
  if (!d) return 'Conversation';
  const autre = d.membres.find((m) => m.id !== etat.agent.id);
  return autre ? autre.nom_complet : 'Conversation';
}

function rendreBarreLaterale() {
  $('#barre-laterale').innerHTML = ui.listeSalons({
    salons: etat.salons, actifId: etat.salonActifId,
    badges: etat.badges, agent: etat.agent,
  });
  const recherche = $('#recherche-salon');
  recherche?.addEventListener('input', () => rendreBarreLateraleAvecFiltre(recherche.value));
}

function rendreBarreLateraleAvecFiltre(filtre) {
  const min = (filtre || '').toLowerCase();
  etat.salonsFiltres = etat.salons.filter((s) => {
    const nom = s.type === 'direct' ? (s.nom_autre || '') : s.nom;
    return !min || nom.toLowerCase().includes(min);
  });
  $('#barre-laterale').innerHTML = ui.listeSalons({
    salons: etat.salonsFiltres ?? etat.salons, actifId: etat.salonActifId,
    badges: etat.badges, agent: etat.agent, recherche: filtre,
  });
  $('#recherche-salon')?.addEventListener('input', (e) => rendreBarreLateraleAvecFiltre(e.target.value));
  $('#recherche-salon')?.focus();
}

// ————— Ouverture d'un salon —————
async function ouvrirSalon(id) {
  etat.salonActifId = id;
  try {
    etat.detail = await api.salon(id);
    etat.detailHorodatage = Date.now();
  } catch (e) { return alert(messageErreur(e)); }

  await traiterMessagesAppareil();          // récupérer les clés de salon en attente
  etat.messages[id] = [];
  const { messages } = await api.historique(id, etat.vus[id] || 0);
  for (const env of messages) ajouterMessageRendu(id, env);
  etat.badges[id] = 0;
  rendreBarreLaterale();
  rendreSalon();
  defilerFil();
}

function rendreSalon() {
  if (!etat.detail) return;
  panneau().innerHTML = ui.panneauSalon({
    detail: etat.detail,
    messages: etat.messages[etat.salonActifId] || [],
    moi: etat.agent,
  });
  brancherCompositeur();
}

function defilerFil() {
  const fil = $('#fil-messages');
  if (fil) fil.scrollTop = fil.scrollHeight;
}

/** Déchiffre une enveloppe et l'ajoute au fil (ou marque l'échec). */
async function ajouterMessageRendu(salonId, env) {
  if (env.expire_le && new Date(env.expire_le) < new Date()) {
    etat.messages[salonId].push({ expiré: true });
    etat.vus[salonId] = env.id;
    return;
  }
  const r = etat.gc.dechiffrerSalon(env.session_id, env.ciphertext);
  if (!r) {
    etat.messages[salonId].push({ echec: true, env });
    etat.vus[salonId] = env.id;
    return;
  }
  let contenu;
  try { contenu = JSON.parse(r.plaintext); } catch { contenu = { type: 'texte', texte: '' }; }
  const expediteur = etat.detail?.membres.find((m) => m.id === env.expediteur_id)
    || { nom_complet: '—' };
  etat.messages[salonId].push({ env, contenu, expediteur });
  etat.vus[salonId] = env.id;
}

// ————— WebSocket : événements temps réel —————
function connecterWebSocket() {
  const protocole = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocole}://${location.host}/ws`);
  etat.ws = ws;
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'message') recevoirMessage(msg);
    else if (msg.t === 'toDevice') traiterMessagesAppareil();
    else if (msg.t === 'membres' || msg.t === 'rotation') surChangementMembres(msg);
    else if (msg.t === 'salons') rafraichirSalons().then(rendreBarreLaterale);
    else if (msg.t === 'revocation') surRevocation();
  };
  ws.onclose = () => { if (etat.ws) setTimeout(() => { if (etat.ws) connecterWebSocket(); }, 3000); };
}

async function recevoirMessage(msg) {
  const { salon_id, message } = msg;
  if (salon_id === etat.salonActifId && etat.detail) {
    await traiterMessagesAppareil();
    await ajouterMessageRendu(salon_id, message);
    rendreSalon();
    defilerFil();
  } else {
    etat.badges[salon_id] = (etat.badges[salon_id] || 0) + 1;
  }
  await rafraichirSalons();
  rendreBarreLaterale();
}

async function surChangementMembres(msg) {
  if (etat.salonActifId === msg.salon_id) {
    etat.detail = await api.salon(msg.salon_id);      // nouvel epoch, nouvelle liste
    etat.detailHorodatage = Date.now();
    // Message système : rotation de la session de chiffrement
    etat.messages[msg.salon_id] = [
      ...(etat.messages[msg.salon_id] || []),
      { env: { id: Date.now(), expediteur_id: -1, envoye_le: new Date().toISOString(), session_id: '' },
        contenu: { type: 'texte', texte: t('rotation_info'), classification: 'normal' },
        expediteur: { nom_complet: '' }, systeme: true },
    ];
    rendreSalon();
  }
  await rafraichirSalons();
  rendreBarreLaterale();
}

/** RÉVOCATION : effacement local à distance, toutes les clés détruites. */
function surRevocation() {
  effacerDonneesLocales();
  alert(t('agent_revoque_titre') + ' — ' + t('agent_revoque_texte'));
  location.reload();
}

function effacerDonneesLocales() {
  const aGarder = [];
  for (let i = 0; i < localStorage.length; i++) {
    const cle = localStorage.key(i);
    if (cle && cle.startsWith('fasomsg:')) aGarder.push(cle);
  }
  for (const cle of aGarder) localStorage.removeItem(cle);
  try { sessionStorage.clear(); } catch {}
  try { etat.ws?.close(); } catch {}
}

// ————— To-device : réception et vérification des clés de salon —————
async function traiterMessagesAppareil() {
  const r = await api.messagesAppareil().catch(() => null);
  if (!r) return;
  const pourMoi = r.messages.filter((m) => m.appareil_id === etat.appareilId);
  const ids = [];
  for (const m of pourMoi) {
    ids.push(m.id);
    const clair = etat.gc.dechiffrerDepuisAppareil(m.ciphertext);
    if (!clair) continue;
    let enveloppe; try { enveloppe = JSON.parse(clair); } catch { continue; }
    if (enveloppe.type !== 'cle_sal') continue;
    await verifierEtInstallerCle(enveloppe, m.expediteur_id);
  }
  if (ids.length) await api.acquitterAppareil(ids).catch(() => {});
}

async function verifierEtInstallerCle(enveloppe, expediteurId) {
  const p = enveloppe.payload;
  if (!p || !enveloppe.signature) return;
  // 1) La signature ed25519 prouve que la clé vient bien de l'appareil
  //    émetteur (clé privée correspondante dans son navigateur).
  if (!etat.gc.verifierSignature(p.ed25519_emetteur, JSON.stringify(p), enveloppe.signature)) return;
  // 2) La clé publique annoncée doit correspondre à un appareil déclaré
  //    par l'agent émetteur (annuaire du serveur).
  try {
    const { appareils } = await api.clesPubliques([p.appareil_emetteur]);
    const attendu = appareils.find((a) => a.agent_id === expediteurId);
    if (!attendu || attendu.cle_ed25519 !== p.ed25519_emetteur) return;
  } catch { return; }
  // 3) Installation de la session entrante Megolm.
  etat.gc.ajouterSessionEntrante(p.session_id, p.session_key);
}

// ————— Envoi d'un message —————
function brancherCompositeur() {
  const form = $('#form-envoi');
  if (!form) return;
  form.addEventListener('submit', (e) => { e.preventDefault(); envoyerMessage(); });

  const classification = $('#classification');
  const expiration = $('#expiration');
  classification?.addEventListener('change', () => {
    expiration.style.display = classification.value === 'normal' ? 'none' : 'inline-block';
  });

  $('#fichier-a-envoyer')?.addEventListener('change', async (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    if (fichier.size > 10 * 1024 * 1024) return alert('Fichier trop volumineux (max 10 Mo).');
    etat.fichierEnAttente = {
      nom: fichier.name, mime: fichier.type, taille: fichier.size,
      octets: new Uint8Array(await fichier.arrayBuffer()),
    };
    $('#fichier-attente').style.display = 'flex';
    $('#nom-fichier-attente').textContent = fichier.name;
  });

  const zone = $('#zone-texte');
  zone?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyerMessage(); }
  });
}

async function envoyerMessage() {
  const zone = $('#zone-texte');
  const texte = (zone?.value || '').trim();
  const classification = $('#classification')?.value || 'normal';
  const minutes = Number($('#expiration')?.value || 60);
  if (!texte && !etat.fichierEnAttente) return;

  if (classification === 'confidentiel' && !confirm(t('confidentialite_avertissement'))) return;
  const expire_le = classification === 'normal'
    ? null
    : new Date(Date.now() + minutes * 60000).toISOString();

  try {
    // Rafraîchir le détail si nécessaire (epoch, membres, appareils).
    if (!etat.detail || Date.now() - etat.detailHorodatage > 10000) {
      etat.detail = await api.salon(etat.salonActifId);
      etat.detailHorodatage = Date.now();
    }
    const salonId = etat.salonActifId;
    const epoch = etat.detail.salon.epoch;

    // 1. Fichier éventuel : chiffrement AES-GCM côté client.
    let payloadFichier = null;
    if (etat.fichierEnAttente) {
      const cle = cleAleatoire();
      const { chiffre, iv } = await chiffrerFichier(etat.fichierEnAttente.octets, cle);
      const b64 = octetsVersBase64(chiffre);
      const empreinte = await crypto.subtle.digest('SHA-256', chiffre).then((h) =>
        Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, '0')).join(''));
      const r = await api.televerserFichier(salonId, b64, empreinte, expire_le);
      payloadFichier = {
        id: r.id, nom: etat.fichierEnAttente.nom, mime: etat.fichierEnAttente.mime,
        taille: etat.fichierEnAttente.taille, cle: Array.from(cle), iv,
      };
      etat.fichierEnAttente = null;
      $('#fichier-attente').style.display = 'none';
    }

    // 2. Chiffrement Megolm du message complet.
    const contenu = {
      type: payloadFichier ? 'fichier' : 'texte', texte,
      fichier: payloadFichier, classification, expire_le,
    };
    const { session_id, ciphertext, session_key } =
      etat.gc.chiffrerPourSalon(salonId, epoch, JSON.stringify(contenu));

    // 3. Nouvelle session (création ou rotation) : partager la clé de salon
    //    aux autres appareils via Olm, AVANT d'envoyer le message.
    if (session_key) await partagerCleSalon(session_id, session_key, epoch);

    // 4. Envoi de l'enveloppe chiffrée au serveur (relais aveugle).
    const r = await api.envoyerMessage(salonId, session_id, ciphertext, expire_le);
    etat.vus[salonId] = r.id;

    zone.value = '';
    await rafraichirSalons();
    rendreBarreLaterale();
  } catch (erreur) {
    alert(messageErreur(erreur));
  }
}

/** Partage la clé Megolm d'un salon à tous les appareils des membres. */
async function partagerCleSalon(sessionId, sessionKey, epoch) {
  const identite = etat.gc.identite();
  const payload = {
    type: 'cle_sal', salon_id: etat.salonActifId, epoch, session_id: sessionId,
    session_key: sessionKey, ed25519_emetteur: identite.ed25519,
    appareil_emetteur: etat.appareilId, agent_emetteur: etat.agent.id,
  };
  const aSigner = JSON.stringify(payload);
  const signature = etat.gc.signer(aSigner);
  const enveloppe = JSON.stringify({ payload, signature });

  // Tous les appareils des membres, y compris MES autres appareils,
  // sauf l'appareil courant (il installe sa clé localement).
  const cibles = [];
  for (const m of etat.detail.membres) {
    for (const ap of m.appareils) {
      if (ap.id === etat.appareilId) continue;
      cibles.push({ membre: m, appareil: ap });
    }
  }

  const destinataires = [];
  const aReclamer = [];
  for (const c of cibles) {
    const ct = etat.gc.chiffrerPourAppareil(c.appareil, null, enveloppe);   // session existante ?
    if (ct) destinataires.push({ appareil_id: c.appareil.id, ciphertext: ct });
    else aReclamer.push(c);
  }
  if (aReclamer.length) {
    const { cles } = await api.reclamerCles(aReclamer.map((c) => ({ agent_id: c.membre.id, appareil_id: c.appareil.id })));
    for (const c of aReclamer) {
      const cj = cles[c.appareil.id];
      if (!cj) continue;                       // appareil hors ligne sans clé : il rattrapera
      const ct = etat.gc.chiffrerPourAppareil(c.appareil, cj.cle, enveloppe);
      if (ct) destinataires.push({ appareil_id: c.appareil.id, ciphertext: ct });
    }
  }
  if (destinataires.length) await api.envoyerAuxAppareils(destinataires);
  await completerClesJetables(Math.min(5, cibles.length));   // reconstitution du stock
}

function octetsVersBase64(octets) {
  let binaire = '';
  const tranche = 32768;
  for (let i = 0; i < octets.length; i += tranche) {
    binaire += String.fromCharCode(...octets.subarray(i, i + tranche));
  }
  return btoa(binaire);
}

// ————— Téléchargement d'un fichier (déchiffrement local) —————
async function telechargerFichier(id, cleBrute, iv, nom) {
  try {
    const chiffre = await api.telechargerFichier(id);
    const clair = await dechiffrerFichier(chiffre, new Uint8Array(cleBrute.split(',').map(Number)), iv.split(',').map(Number));
    const url = URL.createObjectURL(new Blob([clair]));
    const a = document.createElement('a');
    a.href = url; a.download = nom || 'fichier';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    alert('Fichier indisponible (expiré ou accès refusé).');
  }
}

// ————— Vues : annuaire, administration, profil —————
async function voirAnnuaire() {
  etat.salonActifId = null;
  const r = await api.annuaire();
  const ecouter = () => {
    const champ = $('#recherche-annuaire');
    champ?.addEventListener('input', () => {
      panneau().innerHTML = ui.panneauAnnuaire(r.agents, champ.value);
      ecouter();
      $('#recherche-annuaire')?.focus();
    });
  };
  panneau().innerHTML = ui.panneauAnnuaire(r.agents);
  ecouter();
}

async function voirAdmin(onglet = etat.ongletAdmin) {
  etat.ongletAdmin = onglet;
  etat.salonActifId = null;
  const donnees = {};
  if (onglet === 'agents') Object.assign(donnees, { agents: (await api.adminAgents()).agents });
  if (onglet === 'enrôlement') Object.assign(donnees, { codes: (await api.adminCodes()).codes });
  if (onglet === 'journal') Object.assign(donnees, { journal: (await api.adminJournal()).journal });
  panneau().innerHTML = ui.panneauAdmin({ onglet, ...donnees });

  $('#forme-enrolement')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api.adminCreerCode(
        String(f.get('nom_complet')), String(f.get('ministere')),
        String(f.get('fonction')), String(f.get('role') || 'agent'));
      $('#code-genere').innerHTML =
        `<div class="bandeau-code">${esc(t('code_genere_info'))}<br><code>${esc(r.code)}</code></div>`;
      e.target.reset();
    } catch (erreur) { alert(messageErreur(erreur)); }
  });
}

async function voirProfil() {
  etat.salonActifId = null;
  const p = await api.profil();
  panneau().innerHTML = ui.panneauProfil({
    agent: p.agent, appareils: p.appareils, empreinte: etat.gc.empreinte(),
  });
}

// ————— Modales : nouveau groupe / nouveau canal —————
async function modaleNouveauGroupe() {
  const r = await api.annuaire();
  const autres = r.agents.filter((a) => a.identifiant !== etat.agent.identifiant);
  document.body.insertAdjacentHTML('beforeend', ui.modale(t('nouveau_groupe'), `
    <form id="forme-groupe">
      <label>${esc(t('nom_groupe'))} <input name="nom" required></label>
      <div class="liste-choix">${autres.map((a) => `
        <label class="choix"><input type="checkbox" name="membre" value="${esc(a.identifiant)}">
          ${esc(a.nom_complet)} <em>${esc(a.ministere)}</em></label>`).join('')}</div>
      <button class="principal">${esc(t('creer_groupe'))}</button>
    </form>`));
  $('#forme-groupe').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const membres = f.getAll('membre');
    try {
      const r2 = await api.creerGroupe(String(f.get('nom')), membres);
      fermerModale();
      await rafraichirSalons(); rendreBarreLaterale(); ouvrirSalon(r2.salon_id);
    } catch (erreur) { alert(messageErreur(erreur)); }
  });
}

function modaleNouveauCanal() {
  document.body.insertAdjacentHTML('beforeend', ui.modale(t('creer_canal'), `
    <form id="forme-canal">
      <label>${esc(t('nom_groupe'))} <input name="nom" required></label>
      <label class="choix"><input type="radio" name="ecriture" value="encadrants" checked> ${esc(t('ecriture_encadrants'))}</label>
      <label class="choix"><input type="radio" name="ecriture" value="tous"> ${esc(t('ecriture_tous'))}</label>
      <button class="principal">${esc(t('creer_canal'))}</button>
    </form>`));
  $('#forme-canal').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api.creerCanal(String(f.get('nom')), String(f.get('ecriture')), []);
      fermerModale();
      await rafraichirSalons(); rendreBarreLaterale(); ouvrirSalon(r.salon_id);
    } catch (erreur) { alert(messageErreur(erreur)); }
  });
}

function fermerModale() { document.querySelector('.voile')?.remove(); }

// ————— Gestion des clics (délégation d'événements) —————
document.addEventListener('click', async (e) => {
  const cible = e.target.closest('[data-action]');
  if (!cible) return;
  const action = cible.dataset.action;
  try {
    if (action === 'mode-connexion') montrerConnexion('connexion');
    else if (action === 'mode-inscription') montrerConnexion('inscription');
    else if (action === 'langue-fr') { setLangue('fr'); location.reload(); }
    else if (action === 'langue-mos') { setLangue('mos'); location.reload(); }
    else if (action === 'basculer-langue') { setLangue(getLangue() === 'fr' ? 'mos' : 'fr'); location.reload(); }
    else if (action === 'deconnexion') { await api.deconnexion().catch(() => {}); effacerDonneesLocales(); location.reload(); }
    else if (action === 'ouvrir-salon') ouvrirSalon(Number(cible.dataset.id));
    else if (action === 'voir-annuaire') voirAnnuaire();
    else if (action === 'voir-admin') voirAdmin();
    else if (action === 'voir-profil') voirProfil();
    else if (action === 'onglet-admin') voirAdmin(cible.dataset.id);
    else if (action === 'nouveau-groupe') modaleNouveauGroupe();
    else if (action === 'nouveau-canal') modaleNouveauCanal();
    else if (action === 'fermer-modale') { if (e.target === cible) fermerModale(); }
    else if (action === 'annuler-fichier') { etat.fichierEnAttente = null; $('#fichier-attente').style.display = 'none'; }
    else if (action === 'telecharger-fichier') telechargerFichier(cible.dataset.id, cible.dataset.cle, cible.dataset.iv, cible.dataset.nom);
    else if (action === 'ecrire-a') {
      const r = await api.creerDirect(cible.dataset.id);
      await rafraichirSalons(); rendreBarreLaterale(); ouvrirSalon(r.salon_id);
    }
    else if (action === 'ajouter-membre') {
      const ident = $('#identifiant-membre').value.trim();
      await api.ajouterMembre(Number(cible.dataset.salon), ident);
      await ouvrirSalon(etat.salonActifId);
    }
    else if (action === 'retirer-membre') {
      await api.retirerMembre(Number(cible.dataset.salon), cible.dataset.id);
      await ouvrirSalon(etat.salonActifId);
    }
    else if (action === 'revoquer-agent') {
      if (confirm(t('confirmer_revocation'))) {
        await api.adminRevoquer(Number(cible.dataset.id));
        voirAdmin('agents');
      }
    }
    else if (action === 'effacer-local') {
      if (confirm('Effacer toutes les clés et messages locaux de cet appareil ?')) {
        effacerDonneesLocales(); location.reload();
      }
    }
  } catch (erreur) { alert(messageErreur(erreur)); }
});

// Blocage de la copie pour les messages à diffusion restreinte/confidentiels.
document.addEventListener('copy', (e) => {
  const selection = document.getSelection();
  if (selection?.anchorNode?.parentElement?.closest('.sans-copie')) e.preventDefault();
});

demarrer();
