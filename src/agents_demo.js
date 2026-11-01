// ============================================================================
// FasoMsg — src/agents_demo.js
// Données des comptes de DÉMONSTRATION fictifs (cf. COMPTE_DEMO.md).
// Module de données PUR : aucune importation, aucune dépendance npm, aucune
// base de données — il peut être chargé par les scripts outils (ex.
// scripts/totp.js) immédiatement après l'extraction du dépôt.
//
// Aucune donnée réelle : conformément à l'appel à projets, seuls des comptes
// et données fictives sont utilisés. Les secrets TOTP sont fixes afin que le
// jury puisse générer les codes avec n'importe quelle application TOTP.
// ============================================================================

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

module.exports = { AGENTS_DEMO, MOT_DE_PASSE_DEMO };
