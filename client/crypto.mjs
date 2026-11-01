// ============================================================================
// FasoMsg — client/crypto.js
// Chiffrement de bout en bout, côté client (navigateur), avec la
// bibliothèque officielle du protocole Matrix : Olm/Megolm
// (@matrix-org/olm, Apache-2.0). AUCUNE cryptographie « maison ».
//
//   - Olm   : sessions 1-pour-1 (Double Ratchet) utilisées pour transporter
//             en toute confidentialité les clés de salon entre appareils ;
//   - Megolm : sessions de salon (1-pour-N) qui chiffrent les messages de
//             groupe, avec avancement de ratchet par message.
//
// Les clés privées ne quittent JAMAIS l'appareil : elles sont « picklées »
// (sérialisées chiffrées) dans le stockage local, scellées par une clé
// dérivée du mot de passe (PBKDF2-SHA256, 210 000 itérations).
//
// Ce module est volontairement indépendant du navigateur (interface de
// stockage injectée) : les tests automatisés (tests/) l'utilisent sous
// Node.js tel quel.
// ============================================================================

import * as OlmEspace from '@matrix-org/olm';

// Interopérabilité ESM/CommonJS : le paquet olm est un module CommonJS dont
// les classes n'apparaissent qu'après l'initialisation WebAssembly. L'espace
// de noms ESM est figé avant ; on utilise donc la référence vivante
// `.default` (= module.exports) sur laquelle les classes s'ajoutent ensuite.
const Olm = OlmEspace.Account ? OlmEspace : (OlmEspace.default ?? OlmEspace);

let initialise = false;

/** Charge la bibliothèque Olm (WebAssembly côté navigateur). */
export async function initOlm(locateFile) {
  if (!initialise) {
    await Olm.init(locateFile ? { locateFile } : undefined);
    initialise = true;
  }
}

/** Dérive la clé de scellement des clés privées locales (PBKDF2-SHA256). */
export async function deriverClePickle(motDePasse, selHex) {
  const enc = new TextEncoder();
  const cle = await crypto.subtle.importKey('raw', enc.encode(motDePasse), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(selHex), iterations: 210000 },
    cle, 256);
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ————— Chiffrement des fichiers : AES-GCM 256 (WebCrypto du navigateur) —————
// La clé de fichier voyage DANS le message Megolm : le serveur ne voit qu'un
// blob opaque. IV aléatoire de 96 bits à chaque fichier.
export async function chiffrerFichier(octets /* Uint8Array ou ArrayBuffer */, cleBrute /* Uint8Array 32o */) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cle = await crypto.subtle.importKey('raw', cleBrute, 'AES-GCM', false, ['encrypt']);
  const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, octets);
  return {
    chiffre: new Uint8Array(chiffre),
    iv: Array.from(iv),
  };
}

export async function dechiffrerFichier(chiffre, cleBrute, iv) {
  const cle = await crypto.subtle.importKey('raw', new Uint8Array(cleBrute), 'AES-GCM', false, ['decrypt']);
  const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, cle, chiffre);
  return new Uint8Array(clair);
}

export function cleAleatoire() {
  return crypto.getRandomValues(new Uint8Array(32));
}

// ============================================================================
// Gestionnaire crypto d'un appareil : compte Olm + sessions Olm + Megolm.
// ============================================================================
export class GestionnaireCrypto {

  /**
   * @param stockage interface {getItem, setItem, removeItem} SYNCHRONE
   *                 (localStorage dans le navigateur, Map dans les tests)
   * @param clePickle clé de scellement (dérivée du mot de passe)
   */
  constructor(stockage, clePickle) {
    this.stockage = stockage;
    this.clePickle = clePickle;
    this.compte = null;              // Olm.Account (clés privées de l'appareil)
    this._aPublier = [];             // clés jetables générées non encore publiées
  }

  _cle(nom) { return `fasomsg:${nom}`; }

  // ————— Compte Olm de l'appareil —————
  /** Charge le compte Olm picklé, ou en crée un nouveau (première fois). */
  ouvrirCompte() {
    const pickle = this.stockage.getItem(this._cle('compte'));
    this.compte = new Olm.Account();
    if (pickle) {
      this.compte.unpickle(this.clePickle, pickle);
    } else {
      this.compte.create();                       // clés curve25519 + ed25519
      this.stockage.setItem(this._cle('compte'), this.compte.pickle(this.clePickle));
    }
    const idents = JSON.parse(this.compte.identity_keys());
    return { curve25519: idents.curve25519, ed25519: idents.ed25519 };
  }

  identite() {
    const idents = JSON.parse(this.compte.identity_keys());
    return { curve25519: idents.curve25519, ed25519: idents.ed25519 };
  }

  empreinte() {  // clé publique ed25519, lisible par groupes de 4 caractères
    return this.identite().ed25519.replace(/(.{4})/g, '$1 ').trim();
  }

  // ————— Clés jetables (one-time keys) Olm —————
  /** Génère n clés jetables (publiées ensuite via /api/keys/upload). */
  genererClesJetables(n) {
    this.compte.generate_one_time_keys(n);
    // On re-scelle le compte : les parties privées des clés jetables
    // doivent survivre à un rechargement de la page.
    this.stockage.setItem(this._cle('compte'), this.compte.pickle(this.clePickle));
    const brutes = JSON.parse(this.compte.one_time_keys()).curve25519;
    const liste = Object.entries(brutes).map(([id, cle]) => ({ id, cle }));
    this._aPublier.push(...liste);
    return liste;
  }

  clesJetablesAPublier() {
    this.compte.mark_keys_as_published();
    this.stockage.setItem(this._cle('compte'), this.compte.pickle(this.clePickle));
    return this._aPublier.splice(0, this._aPublier.length);
  }

  // ————— Signature ed25519 (authenticité des clés de salon partagées) —————
  signer(texte) {
    return this.compte.sign(texte);
  }

  /** Vérifie une signature ed25519 avec la clé publique de l'émetteur. */
  verifierSignature(cleEd25519, message, signature) {
    const utilitaire = new Olm.Utility();
    try {
      utilitaire.ed25519_verify(cleEd25519, message, signature);
      return true;
    } catch {
      return false;
    }
  }

  // ————— Sessions Olm 1-pour-1 (transport des clés de salon) —————

  /**
   * Chiffre `texte` pour l'appareil distant décrit par `appareil`
   * ({id, cle_curve25519}). Réutilise la session Olm existante vers cet
   * appareil, sinon en établit une nouvelle grâce à sa clé jetable
   * `cleJetable`. Retourne l'enveloppe {type, body} sérialisée.
   */
  chiffrerPourAppareil(appareil, cleJetable, texte) {
    const cleStockage = this._cle(`olm:dest:${appareil.id}`);
    let session = new Olm.Session();
    let corps = this.stockage.getItem(cleStockage);

    if (corps) {
      try { session.unpickle(this.clePickle, corps); }
      catch { corps = null; }
    }
    if (!corps) {
      if (!cleJetable) return null;     // pas de clé jetable disponible
      session.create_outbound(this.compte, appareil.cle_curve25519, cleJetable);
    }

    const resultat = session.encrypt(texte);
    this.stockage.setItem(cleStockage, session.pickle(this.clePickle));

    // Enveloppe transportée telle quelle vers le serveur (opaque pour lui).
    return JSON.stringify({ type: resultat.type, body: resultat.body });
  }

  /**
   * Déchiffre un message to-device entrant : essaie les sessions Olm
   * existantes ; si le message est un « prekey message » (type 0), établit
   * une nouvelle session entrante. Retourne le texte clair ou null.
   */
  dechiffrerDepuisAppareil(ciphertext) {
    let envelope;
    try { envelope = JSON.parse(ciphertext); } catch { return null; }
    const ids = JSON.parse(this.stockage.getItem(this._cle('olm:sessions')) || '[]');

    for (const id of ids) {
      const session = new Olm.Session();
      try {
        session.unpickle(this.clePickle, this.stockage.getItem(this._cle(`olm:sess:${id}`)));
        const clair = session.decrypt(envelope.type, envelope.body);
        return clair;
      } catch { /* essaie la session suivante */ }
    }

    if (envelope.type === 0) {           // prekey message : nouvelle session
      try {
        const session = new Olm.Session();
        session.create_inbound(this.compte, envelope.body);
        const clair = session.decrypt(envelope.type, envelope.body);
        const id = session.session_id();
        this.stockage.setItem(this._cle(`olm:sess:${id}`), session.pickle(this.clePickle));
        this.stockage.setItem(this._cle('olm:sessions'), JSON.stringify([...new Set([...ids, id])]));
        return clair;
      } catch { return null; }
    }
    return null;
  }

  // ————— Sessions Megolm (chiffrement des salons) —————

  /**
   * Retourne la session sortante Megolm du salon pour l'epoch courant ;
   * en crée une neuve (rotation) si l'epoch a changé — c'est le mécanisme
   * clé de la RÉVOCATION et de l'arrivée d'un membre.
   * Retourne {session_id, session_key|null} : session_key n'est fournie
   * que lors d'une création (à partager aux autres appareils).
   *
   * NB : la clé est exportée AVANT tout chiffrement, conformément au
   * fonctionnement de Megolm (index 0).
   */
  sessionSortante(salonId, epoch) {
    const cleStockage = this._cle(`sort:${salonId}:${epoch}`);
    const session = new Olm.OutboundGroupSession();
    let pickle = this.stockage.getItem(cleStockage);
    let sessionKey = null;

    if (pickle) {
      session.unpickle(this.clePickle, pickle);
    } else {
      session.create();
      sessionKey = session.session_key();          // export à l'index 0
      pickle = session.pickle(this.clePickle);
      this.stockage.setItem(cleStockage, pickle);
      // Mon propre appareil doit pouvoir relire ses messages : on installe
      // aussi la session entrante correspondante.
      this.ajouterSessionEntrante(session.session_id(), sessionKey);
    }
    return { session_id: session.session_id(), session_key: sessionKey, session };
  }

  /** Chiffre un message pour un salon. */
  chiffrerPourSalon(salonId, epoch, texteClair) {
    const { session_id, session_key } = this.sessionSortante(salonId, epoch);
    // (recharge la session picklée pour chiffrer)
    const session = new Olm.OutboundGroupSession();
    session.unpickle(this.clePickle, this.stockage.getItem(this._cle(`sort:${salonId}:${epoch}`)));
    const ciphertext = session.encrypt(texteClair);
    this.stockage.setItem(this._cle(`sort:${salonId}:${epoch}`), session.pickle(this.clePickle));
    return { session_id, ciphertext, session_key };
  }

  /** Installe une clé de salon reçue (via Olm) d'un autre appareil. */
  ajouterSessionEntrante(sessionId, sessionKey) {
    if (!sessionId || !sessionKey) return false;
    const cleStockage = this._cle(`entr:${sessionId}`);
    if (this.stockage.getItem(cleStockage)) return true;   // déjà connue
    try {
      const session = new Olm.InboundGroupSession();
      try { 
        session.create(sessionKey); 
      } catch {
        session.import_session(sessionKey);
      }
      if (session.session_id() !== sessionId) return false;  // incohérence
      this.stockage.setItem(cleStockage, session.pickle(this.clePickle));
      return true;
    } catch {
      return false;
    }
  }

  /** Déchiffre un message de salon ; retourne {plaintext, message_index} ou null. */
  dechiffrerSalon(sessionId, ciphertext) {
    const pickle = this.stockage.getItem(this._cle(`entr:${sessionId}`));
    if (!pickle) return null;                     // clé de salon pas encore reçue
    try {
      const session = new Olm.InboundGroupSession();
      session.unpickle(this.clePickle, pickle);
      const r = session.decrypt(ciphertext);
      this.stockage.setItem(this._cle(`entr:${sessionId}`), session.pickle(this.clePickle));
      return r;
    } catch {
      return null;
    }
  }

    /**
   * Exporte, à l'index 0, la clé d'une session de salon connue localement.
   * Sert au RATTRAPAGE : un appareil qui a manqué le partage initial peut
   * recevoir cette clé et déchiffrer TOUTE l'historique de la session.
   * Retourne la clé exportée, ou null si la session est inconnue.
   */
  exporterCleSalon(sessionId) {
    const pickle = this.stockage.getItem(this._cle(`entr:${sessionId}`));
    if (!pickle) return null;
    try {
      const session = new Olm.InboundGroupSession();
      session.unpickle(this.clePickle, pickle);
      return session.export_session(0);
    } catch {
      return null;
    }
  }

  /**
   * Clé (exportée à l'index 0) de la session SORTANTE d'un salon pour
   * l'epoch donné, SANS la créer. Retourne {session_id, cle} ou null si
   * aucune session sortante n'existe encore (aucun message envoyé).
   */
  cleSortanteExistante(salonId, epoch) {
    const pickle = this.stockage.getItem(this._cle(`sort:${salonId}:${epoch}`));
    if (!pickle) return null;
    try {
      const session = new Olm.OutboundGroupSession();
      session.unpickle(this.clePickle, pickle);
      const identifiant = session.session_id();
      return { session_id: identifiant, cle: this.exporterCleSalon(identifiant) };
    } catch {
      return null;
    }
  }
}

/** Échappement HTML — utilisé par l'interface (protection XSS). */
export function esc(texte) {
  return String(texte ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
