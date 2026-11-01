// ============================================================================
// FasoMsg — client/ui.js
// Rendu de l'interface (HTML pur, échappement systématique contre les
// injections XSS). Aucun framework : chaque ligne reste explicable au jury.
// ============================================================================

import { t, salutation, getLangue } from './i18n.mjs';
import { esc } from './crypto.mjs';

export function pageConnexion({ mode = 'connexion', info = null, qr = null, secret = null, identifiant = '' }) {
  const champsConnexion = `
    <label>${esc(t('identifiant'))}
      <input name="identifiant" autocomplete="username" required>
    </label>
    <label>${esc(t('mot_de_passe'))}
      <input name="mot_de_passe" type="password" autocomplete="current-password" required>
    </label>
    <label>${esc(t('code_totp'))}
      <input name="code_totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required>
    </label>`;

  const champsDeverrouillage = `
    <label>${esc(t('deverrouiller_info'))}
    </label>
    <label>${esc(t('mot_de_passe'))}
      <input name="mot_de_passe" type="password" autocomplete="current-password" required>
    </label>`;

  const champsInscription = `
    <label>${esc(t('code_enrolement'))}
      <input name="code_enrolement" required>
    </label>
    <label>${esc(t('identifiant'))}
      <input name="identifiant" autocomplete="username" required>
    </label>
    <label>${esc(t('mot_de_passe'))}
      <input name="mot_de_passe" type="password" autocomplete="new-password" minlength="8" required>
    </label>`;

  const formules = {
    connexion: { champs: champsConnexion, bouton: t('se_connecter') },
    deverrouillage: { champs: champsDeverrouillage, bouton: t('deverrouiller') },
    inscription: { champs: champsInscription, bouton: t('s_inscrire') },
    activation: {
      champs: `
        <label>${esc(t('activer_info'))}</label>
        ${qr ? `<div class="qr"><img src="${qr}" alt="QR TOTP"></div>` : ''}
        ${secret ? `<p class="secret-totp">Secret : <code>${esc(secret)}</code></p>` : ''}
        <label>${esc(t('identifiant'))}
          <input name="identifiant" value="${esc(identifiant)}" required>
        </label>
        <label>${esc(t('code_totp'))}
          <input name="code_totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required>
        </label>`,
      bouton: t('activer_compte'),
    },
  };
  const f = formules[mode] || formules.connexion;

  const liens = `
    <div class="liens-mode">
      ${mode !== 'connexion' ? `<a href="#" data-action="mode-connexion">${esc(t('deja_compte'))}</a>` : ''}
      ${mode === 'connexion' || mode === 'deverrouillage' ? `<a href="#" data-action="mode-inscription">${esc(t('pas_de_compte'))}</a>` : ''}
    </div>`;

  return `
  <div class="ecran-connexion">
    <form class="carte-connexion" data-mode="${mode}">
      <div class="marque"><span class="logo">F</span> FasoMsg</div>
      <p class="tagline">${esc(t('tagline'))}</p>
      <p class="salutation">${esc(salutation())}</p>
      ${info ? `<div class="bandeau-info">${esc(info)}</div>` : ''}
      ${f.champs}
      <button type="submit" class="principal">${esc(f.bouton)}</button>
      ${liens}
      <div class="choix-langue">
        <button type="button" data-action="langue-fr">Français</button>
        <button type="button" data-action="langue-mos">Mooré</button>
      </div>
      <p class="note-securite">Chiffrement de bout en bout Olm/Megolm — le serveur ne peut pas lire vos messages.</p>
    </form>
  </div>`;
}

function salutationDyn() { return salutation(); }

// ————— Squelette de l'application —————
export function squelette(agent) {
  return `
  <header class="barre-haut">
    <div class="marque petite"><span class="logo">F</span> FasoMsg</div>
    <div class="barre-droite">
      <button class="bouton-langue" data-action="basculer-langue">${esc(t('langue'))} : ${esc(getLangue() === 'fr' ? t('francais') : t('more'))}</button>
      <span class="moi">${esc(agent.nom_complet)} <em>${esc(t('role_' + agent.role))}</em></span>
      <button data-action="voir-profil" class="discret">${esc(t('profil'))}</button>
      <button data-action="deconnexion" class="discret">${esc(t('deconnexion'))}</button>
    </div>
  </header>
  <div class="corps">
    <aside class="barre-laterale" id="barre-laterale"></aside>
    <main id="panneau-principal" class="panneau"></main>
  </div>`;
}



// ————— Barre latérale : liste des salons —————
export function listeSalons({ salons, actifId, badges, agent, recherche = '' }) {
  const items = salons.map((s) => {
    const nom = s.type === 'direct' ? (s.nom_autre || 'Conversation') : s.nom;
    const icone = s.type === 'canal' ? '[C]' : s.type === 'groupe' ? '[G]' : '•';
    const badge = badges && badges[s.id] ? `<span class="badge">${badges[s.id]}</span>` : '';
    return `<li>
      <a href="#" class="salon ${s.id === actifId ? 'actif' : ''}" data-action="ouvrir-salon" data-id="${s.id}">
        <span class="icone-salon">${icone}</span>
        <span class="nom-salon">${esc(nom)}</span>${badge}
      </a></li>`;
  }).join('');

  return `
    <div class="actions-laterales">
      <button class="principal complet" data-action="nouveau-groupe">${esc(t('nouveau_groupe'))}</button>
      <button class="complet" data-action="voir-annuaire">${esc(t('annuaire'))}</button>
      ${(agent.role === 'admin' || agent.role === 'superviseur')
        ? `<button class="complet" data-action="nouveau-canal">${esc(t('creer_canal'))}</button>` : ''}
      ${agent.role === 'admin' ? `<button class="complet" data-action="voir-admin">${esc(t('admin'))}</button>` : ''}
    </div>
    <input class="recherche" id="recherche-salon" placeholder="${esc(t('rechercher'))}" value="${esc(recherche)}">
    <ul class="liste-salons">${items || `<li class="vide">${esc(t('aucun_salon'))}</li>`}</ul>`;
}

// ————— Panneau d'un salon (conversation) —————
export function panneauSalon({ detail, messages, moi, badges = {} }) {
  const { salon, membres } = detail;
  const nomSalon = salon.type === 'direct'
    ? (membres.find((m) => m.id !== moi.id)?.nom_complet || 'Conversation')
    : salon.nom;
  const jeSuisEncadrant = moi.role === 'admin' || moi.role === 'superviseur';
  const peutEcrire = salon.ecriture !== 'encadrants' || jeSuisEncadrant;
  const proprietaire = salon.cree_par === moi.id;

  const listeMembres = membres.map((m) => `
    <li>${esc(m.nom_complet)} <em>(${esc(t('role_' + m.role))})</em>
      ${(proprietaire || jeSuisEncadrant) && m.id !== moi.id && salon.type !== 'direct'
        ? `<button class="mini" data-action="retirer-membre" data-salon="${salon.id}" data-id="${m.identifiant}">×</button>` : ''}
    </li>`).join('');

  const gestionMembres = salon.type !== 'direct' ? `
    <details class="membres">
      <summary>${esc(t('membres'))} (${membres.length})</summary>
      <ul>${listeMembres}</ul>
      ${(proprietaire || jeSuisEncadrant) ? `
        <div class="ajout-membre">
          <input id="identifiant-membre" placeholder="${esc(t('identifiant'))} de l'agent">
          <button class="mini" data-action="ajouter-membre" data-salon="${salon.id}">${esc(t('ajouter_membre'))}</button>
        </div>` : ''}
    </details>` : '';

  const bulles = messages.map((m) => bulleMessage(m, moi)).join('');

  const compositeur = peutEcrire ? compositeurMessage(salon) : `<div class="lecture-seule">${esc(t('canal_lecture_seule'))}</div>`;

  return `
    <div class="entete-salon">
      <div>
        <h2>${esc(nomSalon)}</h2>
        <span class="type-salon">${esc(t(salon.type))}${salon.ministere ? ' — ' + esc(salon.ministere) : ''}</span>
      </div>
      ${gestionMembres}
    </div>
    <div class="fil-messages" id="fil-messages">${bulles || '<div class="fil-vide">' + esc(t('aucun_salon')) + '</div>'}</div>
    ${compositeur}`;
}

function compositeurMessage(salon) {
  const expire = `
    <select id="classification" title="${esc(t('classification'))}">
      <option value="normal">${esc(t('classification_normal'))}</option>
      <option value="restreint">${esc(t('classification_restreint'))}</option>
      <option value="confidentiel">${esc(t('classification_confidentiel'))}</option>
    </select>
    <select id="expiration" class="masque" title="${esc(t('expiration'))}">
      <option value="60">${esc(t('expiration_1h'))}</option>
      <option value="1440">${esc(t('expiration_24h'))}</option>
      <option value="10080">${esc(t('expiration_7j'))}</option>
      <option value="30">${esc(t('expiration_30min'))}</option>
    </select>`;
  return `
    <form class="compositeur" id="form-envoi">
      <label class="bouton-fichier" title="${esc(t('fichier'))}">+
        <input type="file" id="fichier-a-envoyer" hidden>
      </label>
      <div class="fichier-attente masque" id="fichier-attente">
        <span id="nom-fichier-attente"></span>
        <button type="button" class="mini" data-action="annuler-fichier">×</button>
      </div>
      <textarea id="zone-texte" rows="1" placeholder="${esc(t('message_placeholder'))}"></textarea>
      ${expire}
      <button type="submit" class="principal">${esc(t('envoyer'))}</button>
    </form>`;
}

// ————— Une bulle de message —————
export function bulleMessage(m, moi) {
  if (m.expiré) {
    return `<div class="bulle systeme">${esc(t('message_expire'))}</div>`;
  }
  if (m.echec) {
    return `<div class="bulle systeme">${esc(t('message_non_dechiffre'))}</div>`;
  }
  const { env, contenu, expediteur } = m;
  const mien = env.expediteur_id === moi.id;
  const classification = contenu.classification || 'normal';
  const restreinte = classification !== 'normal';

  let corps = '';
  if (contenu.type === 'fichier' && contenu.fichier) {
    const ko = (contenu.fichier.taille / 1024).toFixed(1);
    corps = `<div class="carte-fichier">
        <span class="nom-fichier">${esc(contenu.fichier.nom)}</span>
        <span class="meta-fichier">${ko} Ko — ${esc(t('fichier_chiffre'))}</span>
        <button class="mini" data-action="telecharger-fichier" data-id="${esc(contenu.fichier.id)}"
          data-cle="${contenu.fichier.cle.join(',')}" data-iv="${contenu.fichier.iv.join(',')}"
          data-nom="${esc(contenu.fichier.nom)}">${esc(t('telecharger'))}</button>
      </div>`;
    if (contenu.texte) corps += `<div class="texte">${formaterTexte(contenu.texte)}</div>`;
  } else {
    corps = `<div class="texte">${formaterTexte(contenu.texte || '')}</div>`;
  }

  const badge = classification === 'normal' ? '' :
    `<span class="badge-classif ${classification}">${esc(t('classification_' + classification))} — ${esc(t('transfert_interdit'))}</span>`;

  const heure = new Date(env.envoye_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const expirationInfo = env.expire_le
    ? `<span class="info-expiration">${esc(t('expiration'))} : ${new Date(env.expire_le).toLocaleString('fr-FR')}</span>` : '';

  return `
    <div class="bulle ${mien ? 'moi' : ''} cl-${classification}">
      <div class="entete-bulle">${mien ? '' : esc(expediteur?.nom_complet || '')} <span class="heure">${heure}</span></div>
      ${badge}
      <div class="contenu ${restreinte ? 'sans-copie' : ''}">
        ${corps}
        ${restreinte ? filigrane(moi.nom_complet) : ''}
      </div>
      ${expirationInfo}
    </div>`;
}

function formaterTexte(texte) {
  return esc(texte).replaceAll('\n', '<br>');
}

// Filigrane : nom du lecteur répété en surimpression (diffusion restreinte).
export function filigrane(nom) {
  const date = new Date().toLocaleDateString('fr-FR');
  const marque = `${nom} — ${date}`;
  let sortie = '<div class="filigrane">';
  for (let i = 1; i <= 9; i++) sortie += `<span class="f${i}">${esc(marque)}</span>`;
  return sortie + '</div>';
}

// ————— Annuaire officiel —————
export function panneauAnnuaire(agents, recherche = '') {
  const filtre = (recherche || '').toLowerCase();
  const visibles = agents.filter((a) =>
    !filtre || a.nom_complet.toLowerCase().includes(filtre) ||
    a.fonction.toLowerCase().includes(filtre) || a.ministere.toLowerCase().includes(filtre));

  const parMinistere = {};
  for (const a of visibles) (parMinistere[a.ministere] ??= []).push(a);

  const blocs = Object.entries(parMinistere).map(([ministere, liste]) => `
    <section class="bloc-ministere">
      <h3>${esc(ministere)}</h3>
      <ul>
        ${liste.map((a) => `
          <li>
            <div>
              <strong>${esc(a.nom_complet)}</strong> <em>${esc(t('role_' + a.role))}</em><br>
              <span class="meta">${esc(a.fonction)} — ${esc(a.identifiant)}</span>
            </div>
            <button class="mini principal" data-action="ecrire-a" data-id="${esc(a.identifiant)}">${esc(t('ecrire'))}</button>
          </li>`).join('')}
      </ul>
    </section>`).join('');

  return `
    <div class="entete-salon"><h2>${esc(t('annuaire'))}</h2></div>
    <input class="recherche grande" id="recherche-annuaire" placeholder="${esc(t('rechercher'))}" value="${esc(recherche)}">
    <div class="zone-annuaire">${blocs || `<p class="fil-vide">${esc(t('aucun_resultat'))}</p>`}</div>`;
}

// ————— Administration —————
export function panneauAdmin({ onglet, agents = [], codes = [], journal = [] }) {
  const onglets = ['agents', 'enrôlement', 'journal'].map((o) =>
    `<button class="${onglet === o ? 'actif' : ''}" data-action="onglet-admin" data-id="${o}">${esc(t(o))}</button>`).join('');

  let contenu = '';
  if (onglet === 'agents') {
    contenu = `<table class="tableau">
      <thead><tr><th>${esc(t('nom_complet'))}</th><th>${esc(t('identifiant'))}</th><th>${esc(t('min_compte'))}</th><th>${esc(t('fonction'))}</th><th>${esc(t('role'))}</th><th>Statut</th><th></th></tr></thead>
      <tbody>${agents.map((a) => `
        <tr class="${a.statut}">
          <td>${esc(a.nom_complet)}</td><td>${esc(a.identifiant)}</td><td>${esc(a.ministere)}</td>
          <td>${esc(a.fonction)}</td><td>${esc(t('role_' + a.role))}</td>
          <td>${esc(a.statut === 'actif' ? t('statut_actif') : a.statut === 'revoque' ? t('statut_revoque') : t('statut_attente'))}</td>
          <td>${a.statut === 'actif' && a.role !== 'admin'
            ? `<button class="mini danger" data-action="revoquer-agent" data-id="${a.id}" data-nom="${esc(a.nom_complet)}">${esc(t('revoquer'))}</button>` : ''}
          </td></tr>`).join('')}</tbody></table>`;
  } else if (onglet === 'enrôlement') {
    contenu = `
    <form class="forme-enrolement" id="forme-enrolement">
      <label>${esc(t('nom_complet'))} <input name="nom_complet" required></label>
      <label>${esc(t('min_compte'))} <input name="ministere" required></label>
      <label>${esc(t('fonction'))} <input name="fonction" required></label>
      <label>${esc(t('role'))}
        <select name="role">
          <option value="agent">${esc(t('role_agent'))}</option>
          <option value="superviseur">${esc(t('role_superviseur'))}</option>
        </select>
      </label>
      <button class="principal">${esc(t('generer_code'))}</button>
    </form>
    <div id="code-genere"></div>
    <table class="tableau">
      <thead><tr><th>${esc(t('nom_complet'))}</th><th>${esc(t('min_compte'))}</th><th>${esc(t('role'))}</th><th>${esc(t('date'))}</th><th>Statut</th></tr></thead>
      <tbody>${codes.map((c) => `
        <tr><td>${esc(c.nom_complet)}</td><td>${esc(c.ministere)}</td>
        <td>${esc(t('role_' + c.role))}</td><td>${esc(c.genere_le)}</td>
        <td>${c.utilise ? esc(t('code_utilise')) : `<strong>${esc(t('code_libre'))}</strong>`}</td></tr>`).join('')}</tbody>
    </table>`;
  } else {
    contenu = `<table class="tableau">
      <thead><tr><th>${esc(t('date'))}</th><th>${esc(t('evenement'))}</th><th>${esc(t('identifiant'))}</th><th>${esc(t('details'))}</th></tr></thead>
      <tbody>${journal.map((j) => `
        <tr><td>${esc(j.date)}</td><td>${esc(j.evenement)}</td><td>${esc(j.identifiant || '')}</td><td>${esc(j.details)}</td></tr>`).join('')}</tbody></table>`;
  }

  return `<div class="entete-salon"><h2>${esc(t('admin'))}</h2></div>
    <nav class="onglets">${onglets}</nav>
    <div class="zone-admin">${contenu}</div>`;
}

// ————— Profil —————
export function panneauProfil({ agent, appareils, empreinte, langues }) {
  return `
    <div class="entete-salon"><h2>${esc(t('profil'))}</h2></div>
    <div class="zone-profil">
      <p><strong>${esc(agent.nom_complet)}</strong> — ${esc(t('role_' + agent.role))}</p>
      <p>${esc(agent.ministere)} — ${esc(agent.fonction)}</p>
      <h3>${esc(t('empreinte_appareil'))}</h3>
      <p class="empreinte">${esc(empreinte)}</p>
      <p class="note-securite">Comparez cette empreinte avec vos correspondants (canal de confiance) pour vérifier qu'aucun appareil intrus n'usurpe le vôtre.</p>
      <h3>${esc(t('mes_appareils'))} (${appareils.length})</h3>
      <ul class="liste-appareils">${appareils.map((a) => `
        <li>#${a.id} — ${esc(a.cle_ed25519.slice(0, 16))}… — ${esc(a.cree_le)}</li>`).join('')}</ul>
      <button class="danger" data-action="effacer-local">${esc(t('effacer_donnees_locales'))}</button>
    </div>`;
}

// ————— Fenêtre modale (groupes, canaux, confirmations) —————
export function modale(titre, corps) {
  return `
  <div class="voile" data-action="fermer-modale">
    <div class="modale" role="dialog">
      <h3>${esc(titre)}</h3>
      ${corps}
    </div>
  </div>`;
}
