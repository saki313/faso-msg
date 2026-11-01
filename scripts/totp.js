// ============================================================================
// FasoMsg — scripts/totp.js
// Affiche le code TOTP courant d'un compte de DÉMONSTRATION fictif
// (facilite les tests du jury et la vidéo de démonstration).
//
//   node scripts/totp.js admin.dgtd
//   node scripts/totp.js traore.k
//
// Les secrets listés ici sont ceux, fixes, des comptes fictifs du fichier
// COMPTE_DEMO.md : aucune donnée réelle.
// ============================================================================

const { TOTP, Secret } = require('otpauth');
const { AGENTS_DEMO } = require('../src/seed');

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

const totp = new TOTP({
  issuer: 'FasoMsg', label: agent.identifiant,
  algorithm: 'SHA1', digits: 6, period: 30,
  secret: Secret.fromBase32(agent.totp),
});

console.log(`Code TOTP courant pour ${agent.identifiant} : ${totp.generate()}`);
console.log(`(valide environ ${totp.period} secondes)`);
