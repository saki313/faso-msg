// ============================================================================
// FasoMsg — src/seed.js
// Création des comptes de démonstration FICTIFS (cf. COMPTE_DEMO.md).
// Aucune donnée réelle : conformément à l'appel à projets, seuls des comptes
// et données fictives sont utilisés. Les secrets TOTP sont fixes afin que le
// jury puisse générer les codes avec n'importe quelle application TOTP.
// ============================================================================

const { db, journaliser } = require('./db');
const { hacherMotDePasse } = require('./auth');

const MOT_DE_PASSE_DEMO = 'Faso@2026';

const AGENTS_DEMO = [
  { identifiant: 'admin.dgtd',  nom_complet: 'DIALLO Fatoumata',      ministere: 'MTDPCE – DGTD',                          fonction: 'Administratrice de la messagerie',        role: 'admin',        totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' },
  { identifiant: 'sawadogo.m',  nom_complet: 'SAWADOGO Mariam',       ministere: 'Ministère de la Santé',                   fonction: 'Directrice des systèmes d\u2019information', role: 'superviseur', totp: 'MFRGGZDFMZTWQ2LKONXW4ZDFMFRGGZDF' },
  { identifiant: 'ouedraogo.a', nom_complet: 'OUÉDRAOGO Adama',       ministere: 'MTDPCE – DGTD',                          fonction: 'Chargé de projet numérique',              role: 'agent',        totp: 'NBSWY3DPFQQFO33SM5XCA3DFNBSWY3DP' },
  { identifiant: 'traore.k',    nom_complet: 'TRAORÉ Korotoum',       ministere: 'Ministère de l\u2019Éducation nationale',  fonction: 'Inspectrice pédagogique',                 role: 'agent',        totp: 'ONSWG43FMZSXIZLOORUWG33SNZZGK3DF' },
  { identifiant: 'zongo.b',     nom_complet: 'ZONGO Boukary',         ministere: 'Ministère de l\u2019Agriculture',          fonction: 'Ingénieur statisticien',                  role: 'agent',        totp: 'OVQXG5CTM5XCA3LUMVQXG5CTM5XCA3LU' },
  { identifiant: 'compaore.n',  nom_complet: 'COMPAORÉ Nassara',      ministere: 'Ministère de l\u2019Action sociale',       fonction: 'Assistante sociale',                      role: 'agent',        totp: 'NVSQ2ZLBORUGK3TFMVSQ2ZLBORUGK3TF' },
  { identifiant: 'kabore.f',    nom_complet: 'KABORÉ Fabrice',        ministere: 'Ministère de l\u2019Économie et des Finances', fonction: 'Contrôleur budgétaire',               role: 'agent',        totp: 'NFXGS3TPO5XCA3LUNFXGS3TPO5XCA3LU' },
];

function semer() {
  const dejaLa = db.prepare('SELECT COUNT(*) AS n FROM agents').get().n;
  if (dejaLa > 0) return { ok: false, message: 'base déjà remplie' };

  const stmtAgent = db.prepare(`
    INSERT INTO agents (identifiant, nom_complet, ministere, fonction, role, statut, sel, hachage_mot_de_passe, secret_totp)
    VALUES (?, ?, ?, ?, ?, 'actif', ?, ?, ?)`);
  const ids = {};
  for (const a of AGENTS_DEMO) {
    const { sel, hachage } = hacherMotDePasse(MOT_DE_PASSE_DEMO);
    const info = stmtAgent.run(a.identifiant, a.nom_complet, a.ministere, a.fonction, a.role, sel, hachage, a.totp);
    ids[a.identifiant] = info.lastInsertRowid;
  }

  // Un code d'enrôlement de démonstration, non utilisé, pour tester
  // l'inscription d'un nouvel agent sans passer par l'administrateur.
  const crypto = require('node:crypto');
  db.prepare(`INSERT INTO codes_enrolement (hachage, nom_complet, ministere, fonction, role, genere_par)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.createHash('sha256').update('DEMO2262026').digest('hex'),
      'ILBOUDO Rahamata', 'MTDPCE – DGTD', 'Stagiaire développeuse', 'agent', ids['admin.dgtd']);

  // Salons de démonstration
  const stmtSalon = db.prepare('INSERT INTO salons (nom, type, ministere, ecriture, cree_par) VALUES (?, ?, ?, ?, ?)');
  const stmtMembre = db.prepare('INSERT INTO membres (salon_id, agent_id) VALUES (?, ?)');

  const canal1 = stmtSalon.run('Instructions DGTD', 'canal', 'MTDPCE – DGTD', 'encadrants', ids['admin.dgtd']).lastInsertRowid;
  for (const u of ['admin.dgtd', 'sawadogo.m', 'ouedraogo.a', 'traore.k', 'zongo.b', 'kabore.f']) {
    stmtMembre.run(canal1, ids[u]);
  }

  const canal2 = stmtSalon.run('Alertes cybersécurité', 'canal', 'MTDPCE – DGTD', 'encadrants', ids['admin.dgtd']).lastInsertRowid;
  for (const u of Object.keys(ids)) stmtMembre.run(canal2, ids[u]);

  const groupe = stmtSalon.run('Comité Semaine du Numérique 2026', 'groupe', null, 'tous', ids['admin.dgtd']).lastInsertRowid;
  for (const u of ['admin.dgtd', 'sawadogo.m', 'ouedraogo.a', 'traore.k']) stmtMembre.run(groupe, ids[u]);

  const direct = stmtSalon.run('', 'direct', null, 'tous', ids['ouedraogo.a']).lastInsertRowid;
  stmtMembre.run(direct, ids['ouedraogo.a']);
  stmtMembre.run(direct, ids['traore.k']);

  journaliser('seed', ids['admin.dgtd'], 'comptes et salons de démonstration créés');
  return { ok: true, message: `${AGENTS_DEMO.length} agents fictifs + salons de démonstration créés` };
}

module.exports = { semer, AGENTS_DEMO, MOT_DE_PASSE_DEMO };

if (require.main === module) {
  const r = semer();
  console.log(r.ok ? r.message : r.message);
}
