// ============================================================================
// FasoMsg — client/api.js
// Client HTTP de l'API FasoMsg (fetch). Toutes les charges de messages et de
// fichiers transitent ici CHIFFRÉES : ce module ne manipule jamais de clair
// autre que les données de compte.
// ============================================================================

async function requete(chemin, options = {}) {
  const reponse = await fetch(`/api${chemin}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let donnees = null;
  try { donnees = await reponse.json(); } catch { /* corps vide */ }
  if (!reponse.ok) {
    const err = new Error(donnees?.erreur || `erreur_http_${reponse.status}`);
    err.statut = reponse.status;
    throw err;
  }
  return donnees;
}

export const profil = () => requete('/profil');
export const connexion = (identifiant, mot_de_passe, code_totp) =>
  requete('/auth/connexion', { method: 'POST', body: { identifiant, mot_de_passe, code_totp } });
export const deconnexion = () => requete('/auth/deconnexion', { method: 'POST' });
export const inscription = (code_enrolement, identifiant, mot_de_passe) =>
  requete('/auth/inscription', { method: 'POST', body: { code_enrolement, identifiant, mot_de_passe } });
export const activer = (identifiant, code_totp) =>
  requete('/auth/activer', { method: 'POST', body: { identifiant, code_totp } });

export const enregistrerAppareil = (cle_ed25519, cle_curve25519, nom) =>
  requete('/appareils', { method: 'POST', body: { cle_ed25519, cle_curve25519, nom } });
export const publierCles = (appareil_id, cles) =>
  requete('/keys/upload', { method: 'POST', body: { appareil_id, cles } });
export const reclamerCles = (cibles) =>
  requete('/keys/claim', { method: 'POST', body: { cibles } });
export const clesPubliques = (appareils) =>
  requete(`/keys/query?appareils=${encodeURIComponent(appareils.join(','))}`);
export const envoyerAuxAppareils = (destinataires) =>
  requete('/sendToDevice', { method: 'POST', body: { destinataires } });
export const messagesAppareil = () => requete('/toDevice');
export const acquitterAppareil = (ids) =>
  requete('/toDevice/ack', { method: 'POST', body: { ids } });

export const salons = () => requete('/salons');
export const salon = (id) => requete(`/salons/${id}`);
export const creerDirect = (avec) => requete('/direct', { method: 'POST', body: { avec } });
export const creerGroupe = (nom, membres) =>
  requete('/salons', { method: 'POST', body: { type: 'groupe', nom, membres } });
export const creerCanal = (nom, ecriture, membres) =>
  requete('/salons', { method: 'POST', body: { type: 'canal', nom, ecriture, membres } });
export const ajouterMembre = (salonId, identifiant) =>
  requete(`/salons/${salonId}/membres`, { method: 'POST', body: { identifiant } });
export const retirerMembre = (salonId, identifiant) =>
  requete(`/salons/${salonId}/retrait`, { method: 'POST', body: { identifiant } });
export const envoyerMessage = (salonId, session_id, ciphertext, expire_le = null) =>
  requete(`/salons/${salonId}/messages`, { method: 'POST', body: { session_id, ciphertext, expire_le } });
export const historique = (salonId, apres) =>
  requete(`/salons/${salonId}/messages?apres=${apres || 0}`);

export const televerserFichier = (salonId, contenu, empreinte, expire_le) =>
  requete('/fichiers', { method: 'POST', body: { salon_id: salonId, contenu, empreinte, expire_le } });

export async function telechargerFichier(id) {
  const reponse = await fetch(`/api/fichiers/${id}`, { credentials: 'same-origin' });
  if (!reponse.ok) throw new Error('fichier_indisponible');
  return new Uint8Array(await reponse.arrayBuffer());
}

export const annuaire = () => requete('/annuaire');

// ————— Administration —————
export const adminAgents = () => requete('/admin/agents');
export const adminCodes = () => requete('/admin/codes-enrolement');
export const adminCreerCode = (nom_complet, ministere, fonction, role) =>
  requete('/admin/codes-enrolement', { method: 'POST', body: { nom_complet, ministere, fonction, role } });
export const adminRevoquer = (id) => requete(`/admin/agents/${id}/revoquer`, { method: 'POST' });
export const adminJournal = () => requete('/admin/journal');
