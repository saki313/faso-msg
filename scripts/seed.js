// ============================================================================
// FasoMsg — scripts/seed.js
// Crée (ou vérifie) les comptes de démonstration fictifs.
//   npm run seed
// ============================================================================

// require('../src/seed') ne suffit pas : src/seed.js n'appelle semer() que
// s'il est exécuté directement (require.main === module). On l'appelle ici
// explicitement pour que `npm run seed` crée réellement les comptes.
const { semer } = require('../src/seed');
const resultat = semer();
console.log(resultat.ok ? resultat.message : `Aucune création : ${resultat.message}`);
