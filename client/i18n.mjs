// ============================================================================
// FasoMsg — client/i18n.js
// Interface bilingue : français (complet) et mooré (langue nationale).
//
// ⚠️ Note d'honnêteté : les traductions mooré proviennent de sources
// publiques d'apprentissage de la langue (salutations et expressions
// courantes). La couverture est partielle : les termes techniques sans
// équivalent établi restent en français. À faire valider et compléter par
// un locuteur natif — contribution bienvenue (voir README, section langues).
// ============================================================================

export const TRADUCTIONS = {
  fr: {
    // Connexion / inscription
    tagline: 'Messagerie souveraine de l\u2019administration du Burkina Faso',
    identifiant: 'Identifiant',
    mot_de_passe: 'Mot de passe',
    code_totp: 'Code d\u2019authentification (6 chiffres)',
    se_connecter: 'Se connecter',
    inscription_titre: 'Inscription d\u2019un agent enrôlé',
    code_enrolement: 'Code d\u2019enrôlement (fourni par l\u2019administration)',
    s_inscrire: 'Créer mon compte',
    deja_compte: 'J\u2019ai déjà un compte',
    pas_de_compte: 'Je dispose d\u2019un code d\u2019enrôlement',
    activer_compte: 'Activer mon second facteur',
    activer_info: 'Scannez le QR code (ou recopiez le secret) dans votre application d\u2019authentification (FreeOTP, Aegis, Google Authenticator…), puis saisissez le code à 6 chiffres.',
    deverrouiller: 'Déverrouiller mes clés locales',
    deverrouiller_info: 'Saisissez votre mot de passe pour déchiffrer les clés conservées sur cet appareil.',

    // Interface principale
    bienvenue: 'Bienvenue',
    annuaire: 'Annuaire officiel',
    admin: 'Administration',
    profil: 'Mon profil',
    nouveau_groupe: 'Nouveau groupe',
    rechercher: 'Rechercher…',
    envoyer: 'Envoyer',
    ecrire: 'Écrire',
    message_placeholder: 'Écrire un message chiffré…',
    fichier: 'Fichier',
    fichier_chiffre: 'chiffré',
    telecharger: 'Télécharger (déchiffré)',
    membres: 'Membres',
    ajouter_membre: 'Ajouter un membre',
    retirer: 'Retirer',
    quitter: 'Quitter le groupe',
    creer_groupe: 'Créer le groupe',
    creer_canal: 'Créer le canal',
    nom_groupe: 'Nom du groupe / canal',
    ecriture_tous: 'Tous les membres peuvent écrire',
    ecriture_encadrants: 'Seuls les encadrants écrivent',
    canal: 'Canal',
    groupe: 'Groupe',
    direct: 'Conversation',
    aucun_salon: 'Aucune conversation. Ouvrez l\u2019annuaire pour écrire à un agent.',
    min_compte: 'Ministère',
    fonction: 'Fonction',
    role: 'Rôle',
    role_admin: 'Administrateur',
    role_superviseur: 'Superviseur',
    role_agent: 'Agent',
    langue: 'Langue',
    francais: 'Français',
    more: 'Mooré',
    deconnexion: 'Déconnexion',
    empreinte_appareil: 'Empreinte de cet appareil (clé publique ed25519)',
    mes_appareils: 'Mes appareils',
    effacer_donnees_locales: 'Effacer les données locales de cet appareil',
    statut_actif: 'Actif',
    statut_revoque: 'Révoqué',
    statut_attente: 'En attente d\u2019activation',

    // Classification
    classification: 'Classification',
    classification_normal: 'Normal',
    classification_restreint: 'Diffusion restreinte',
    classification_confidentiel: 'Confidentiel',
    expiration: 'Expiration',
    expiration_30min: '30 minutes',
    expiration_1h: '1 heure',
    expiration_24h: '24 heures',
    expiration_7j: '7 jours',
    transfert_interdit: 'Transfert interdit',
    filigrane: 'Document à diffusion restreinte',
    message_expire: 'Message expiré et supprimé',
    confidentialite_avertissement: 'Message confidentiel : expiration automatique et copie désactivée. Confirmer l\u2019envoi ?',
    confirmer: 'Confirmer',
    annuler: 'Annuler',
    fermer: 'Fermer',

    // Administration
    enrôlement: 'Enrôlement',
    agents: 'Agents',
    journal: 'Journal d\u2019audit',
    generer_code: 'Générer un code d\u2019enrôlement',
    code_genere_info: 'Communiquez ce code à l\u2019agent par une voie de confiance (il ne sera plus affiché) :',
    revoquer: 'Révoquer',
    confirmer_revocation: 'Révoquer cet agent ? Il perdra immédiatement l\u2019accès à la messagerie et aux conversations sur tous ses appareils, et ne pourra plus lire les nouveaux messages.',
    code_utilise: 'Utilisé',
    code_libre: 'Disponible',
    nom_complet: 'Nom complet',
    evenement: 'Événement',
    date: 'Date',
    details: 'Détails',
    aucun_resultat: 'Aucun résultat',

    // Messages système
    agent_revoque_titre: 'Accès révoqué',
    agent_revoque_texte: 'Votre accès à la messagerie a été révoqué par l\u2019administration. Les données locales ont été effacées.',
    message_non_dechiffre: '🔒 Message indéchiffrable (clé de salon non reçue)',
    canal_lecture_seule: 'Canal institutionnel : écriture réservée aux encadrants',
    erreur_reseau: 'Erreur réseau',
    ok: 'Bien reçu',
    quitte: 'a quitté',
    rejoint: 'a rejoint',
    rotation_info: 'Membre modifié : nouvelle session de chiffrement établie.',
  },

  // ————— Mooré (langue nationale) : couverture partielle, sources publiques —————
  mos: {
    salutation_matin: 'Ney yibeogo !',
    salutation_jour: 'Ney windga !',
    salutation_soir: 'Ney zaabré !',
    salutation_nuit: 'Ne y youngo !',
    bienvenue: 'Ney waoongo !',
    tagline: 'Faso têng zãab kibare — Laafi',
    ca_va: 'Laafi ?',
    pas_de_probleme: 'Yél kay',
    c_est_bien: 'Ya soama',
    merci: 'Barka',
    a_bientot: 'Bilfu',
    au_revoir: 'Wend na wat ne',
    deconnexion: 'Wend na wat ne',
    bien_recu: 'Laafi',
    francais: 'Français',
    more: 'Mooré',
  },
};

let langueCourante = 'fr';

export function setLangue(l) {
  langueCourante = TRADUCTIONS[l] ? l : 'fr';
  try { localStorage.setItem('fasomsg:langue', langueCourante); } catch {}
}

export function getLangue() {
  return langueCourante;
}

/** Traduction d'une clé : mooré si disponible, sinon français. */
export function t(cle) {
  return TRADUCTIONS[langueCourante]?.[cle] ?? TRADUCTIONS.fr[cle] ?? cle;
}

/** Salutation selon l'heure (clés mooré vérifiées sur sources publiques). */
export function salutation() {
  const h = new Date().getHours();
  const cle = h < 12 ? 'salutation_matin' : h < 18 ? 'salutation_jour' : h < 21 ? 'salutation_soir' : 'salutation_nuit';
  if (langueCourante === 'mos') return TRADUCTIONS.mos[cle];
  return h < 18 ? 'Bonjour' : 'Bonsoir';
}
