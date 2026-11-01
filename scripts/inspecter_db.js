// ============================================================================
// FasoMsg — scripts/inspecter_db.js
// OUTIL DU JURY — épreuve « Le serveur ne lit rien » :
//   node scripts/inspecter_db.js            (inspecte la base par défaut)
//   node scripts/inspecter_db.js "texte"    (cherche « texte » dans la base)
//
// Affiche le contenu des tables sensibles et prouve qu'aucun message ni
// fichier ne figure en clair : seules des enveloppes chiffrées (base64
// Olm/Megolm) y sont stockées.
// ============================================================================

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const chemin = process.env.FASOMSG_DB || path.join(__dirname, '..', 'data', 'fasomsg.db');
const recherche = process.argv[2] || null;

try {
  const db = new DatabaseSync(chemin, { readOnly: true });

  console.log(`Base inspectée : ${chemin}\n`);

  // 1) Statistiques par table
  for (const table of ['agents', 'appareils', 'cles_jetables', 'salons', 'membres',
    'messages', 'messages_appareil', 'fichiers', 'sessions', 'codes_enrolement', 'journal']) {
    try {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      console.log(`  ${table.padEnd(22)} ${n} ligne(s)`);
    } catch { /* table absente */ }
  }

  // 2) Aperçu des messages : uniquement du chiffré
  console.log('\nDerniers messages stockés (aucun texte en clair attendu) :');
  const messages = db.prepare(
    'SELECT id, salon_id, substr(ciphertext, 1, 76) AS extrait, expire_le, envoye_le FROM messages ORDER BY id DESC LIMIT 5').all();
  for (const m of messages) {
    console.log(`  #${m.id} salon=${m.salon_id} le=${m.envoye_le}`);
    console.log(`     chiffré : ${m.extrait}…`);
    if (m.expire_le) console.log(`     expire le : ${m.expire_le}`);
  }
  if (!messages.length) console.log('  (aucun message)');

  // 3) Messages « to-device » (clés de salon) : chiffrés Olm
  const toDevice = db.prepare('SELECT COUNT(*) AS n FROM messages_appareil').get().n;
  console.log(`\nMessages to-device en attente : ${toDevice} (chiffrés Olm)`);

  // 4) Recherche d'un texte en clair dans TOUTES les colonnes texte
  if (recherche) {
    console.log(`\nRecherche du texte « ${recherche} » dans les colonnes texte de la base…`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    let occurrences = 0;
    for (const table of tables) {
      const colonnes = db.prepare(`PRAGMA table_info(${table})`).all()
        .map((c) => ({ nom: c.name, type: (c.type || '').toUpperCase() }));
      for (const col of colonnes) {
        if (!col.type.includes('TEXT')) continue;
        if (['sel', 'hachage_mot_de_passe', 'secret_totp', 'hachage', 'jeton_hache'].includes(col.nom)) continue;
        try {
          const n = db.prepare(
            `SELECT COUNT(*) AS n FROM ${table} WHERE ${col.nom} LIKE ?`).get(`%${recherche}%`).n;
          if (n > 0) { console.log(`  TROUVÉ : ${table}.${col.nom} (${n})`); occurrences += n; }
        } catch { /* colonne vide */ }
      }
    }
    console.log(occurrences === 0
      ? `  RÉSULTAT : aucune occurrence. Le texte n'apparaît nulle part en clair.`
      : `  RÉSULTAT : ${occurrences} occurrence(s) — à examiner.`);
  } else {
    console.log('\nAstuce : node scripts/inspecter_db.js "votre phrase secrète" vérifie qu\u2019elle est absente de la base.');
  }

  db.close();
} catch (e) {
  console.error('Impossible d\u2019ouvrir la base :', e.message);
  process.exit(1);
}
