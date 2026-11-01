// ============================================================================
// FasoMsg — scripts/totp.js
// Affiche le code TOTP courant d'un compte de DÉMONSTRATION fictif
// (facilite les tests du jury et la vidéo de démonstration).
//
//   node scripts/totp.js admin.dgtd
//   node scripts/totp.js traore.k
//
// Fonctionne SANS `npm install` : il n'utilise que le module standard
// node:crypto et la liste des comptes (module de données pur
// src/agents_demo.js). Rôle limité à l'AFFICHAGE d'un code pour les comptes
// fictifs : la VÉRIFICATION serveur du second facteur reste assurée par la
// bibliothèque « otpauth » (MIT, RFC 6238) — voir src/auth.js. L'algorithme
// ici est celui de la RFC 6238 (HMAC-SHA1, 6 chiffres, période 30 s), validé
// contre otpauth sur les 7 comptes de démonstration.
//
// Les secrets listés dans src/agents_demo.js sont ceux, fixes, des comptes
// fictifs du fichier COMPTE_DEMO.md : aucune donnée réelle.
// ============================================================================

const crypto = require('node:crypto');
const { AGENTS_DEMO } = require('../src/agents_demo');

// ————— Base32 (RFC 4648, alphabet A-Z et 2-7) → octets —————
function decodBase32(chaine) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valeur = 0;
  const octets = [];
  for (const c of String(chaine).replace(/=+$/, '').toUpperCase()) {
    const indice = ALPHABET.indexOf(c);
    if (indice === -1) continue;
    valeur = (valeur << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

// ————— TOTP RFC 6238 : compteur 30 s, HMAC-SHA1, troncature dynamique —————
function codeTotp(secretBase32, instantMs = Date.now()) {
  const cle = decodBase32(secretBase32);
  const compteur = Math.floor(instantMs / 1000 / 30);
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(compteur));
  const hmac = crypto.createHmac('sha1', cle).update(tampon).digest();
  const decalage = hmac[hmac.length - 1] & 0xf;
  const binaire = ((hmac[decalage] & 0x7f) << 24) |
    (hmac[decalage + 1] << 16) | (hmac[decalage + 2] << 8) | hmac[decalage + 3];
  return String(binaire % 1e6).padStart(6, '0');
}

const identifiant = process.argv[2];
const agent = AGENTS_DEMO.find((a) => a.identifiant === identifiant);

if (!identifiant) {
  console.log('Usage : node scripts/totp.js <identifiant>');
  console.log('Comptes de démonstration :');
  for (const a of AGENTS_DEMO) console.log('   ', a.identifiant);
  process.exit(0);
}
if (!agent) {
  console.error(`Compte fictif inconnu : ${identifiant}`);
  process.exit(1);
}

console.log(`Code TOTP courant pour ${agent.identifiant} : ${codeTotp(agent.totp)}`);
console.log('(valide environ 30 secondes)');
