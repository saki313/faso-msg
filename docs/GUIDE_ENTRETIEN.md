# Guide d'entretien technique — 15 minutes (éliminatoire)

## Séquence imposée

| Séquence | Durée | Notre plan |
|---|---|---|
| Présentation concept + architecture | 3 min | Pitch ci-dessous |
| 3 épreuves en direct tirées au sort | 8 min | Modes opératoires ci-dessous, un membre par épreuve |
| Questions du jury sur la sécurité | 4 min | Réponses types + docs/EXPLICATION_CODE.md |

## Pitch d'ouverture (à connaître par cœur, 45 s)

« FasoMsg est une messagerie instantanée souveraine pour l'administration :
messages, groupes, fichiers et annuaire officiel. Le chiffrement de bout en
bout repose sur la pile cryptographique du protocole Matrix — Olm pour les
échanges 1-à-1, Megolm pour les salons. Le serveur, installable en une
commande Docker sur l'infrastructure de l'État, ne stocke que des enveloppes
chiffrées : il ne peut lire ni les messages, ni les fichiers. Chaque agent
est enrôlé nominativement par un code à usage unique, se connecte avec mot
de passe scrypt et second facteur TOTP, et peut être révoqué immédiatement :
rotation des clés de salon comprise. Enfin, nous avons classé les messages
de service — diffusion restreinte, confidentiel — avec expiration
automatique et filigrane nominatif, et l'interface est disponible en
français et en mooré. »

## Les 5 épreuves en direct : modes opératoires

### 1. « Le serveur ne lit rien »
1. `docker compose up` (si pas déjà fait), deux navigateurs connectés.
2. Échanger un message bien visible.
3. Ouvrir la base : `node scripts/inspecter_db.js "un mot du message"`.
4. Lister la table messages : montrer les lignes `ciphertext` (base64).
5. Si le jury préfère : `sqlite3 data/fasomsg.db "select * from messages"`,
   ou un `tcpdump` : le trafic WS ne montre que la même enveloppe chiffrée.
6. Bonus : la table `fichiers` ne contient que des blobs chiffrés AES-GCM
   (la clé voyage dans le message Megolm).

### 2. « Révocation »
1. Ouvrir 3 fenêtres : admin + deux agents en conversation de groupe.
2. Admin → Administration → Agents → **Révoquer** (confirmer).
3. Immédiat : la fenêtre de l'agent affiche « Accès révoqué », son
   localStorage est purgé (montrer F12 → Application → Local Storage vide).
4. Sa reconnexion est refusée (403) même avec mot de passe + TOTP valides.
5. Un membre restant envoie un message : l'agent révoqué ne peut pas le
   déchiffrer même en gardant d'anciennes captures (rotation Megolm
   via epoch).
6. Expliquer les 5 étapes de src/api.js (`revoquer`).

### 3. « Intrus »
1. Page d'accueil → « Je dispose d'un code d'enrôlement » → taper un code
   inventé → **403 rejeté** (journal : `inscription_refusee`).
2. Tenter d'appeler l'API sans session → 401.
3. Un agent non-membre tente de poster dans un salon → 403 (montrer le
   test automatisé « Intrus » : `npm test`).
4. Personne ne peut s'ajouter seul à un salon : seul le propriétaire ou un
   encadrant y invite.

### 4. « Innovation » (notre fonctionnalité mise en avant)
Classification des messages :
1. Composer avec **Diffusion restreinte** (expiration 1 h) → badges, 
   **filigrane nominatif** au nom du lecteur, copie bloquée.
2. **Confidentiel** : confirmation obligatoire + expiration plafonnée.
3. Montrer la suppression serveur : `node scripts/inspecter_db.js` après
   expiration — la ligne a disparu de la base.
4. Rappeler : aucune fonction de transfert n'existe par conception.
5. Si le jury demande une seconde innovation : annuaire par ministère +
   canaux institutionnels à écriture encadrée.

### 5. « Explication du code »
- Le jury désigne une fonction : toutes sont répertoriées et expliquées
  dans **docs/EXPLICATION_CODE.md** (à réviser en équipe, chacun doit
  pouvoir expliquer : `ouvrirCompte`, `sessionSortante`,
  `chiffrerPourAppareil`, `partagerCleSalon`, `revoquer`, `hacherMotDePasse`).
- Conseil : si le jury désigne un membre, celui-ci raisonne à voix haute :
  identifier le fichier, la responsabilité de la fonction, les entrées /
  sorties, puis le mécanisme cryptographique.

## Questions probables du jury et réponses types

**« Pourquoi Olm/Megolm et pas Signal/MLS ? »**
Pile éprouvée du protocole Matrix, disponible en WebAssembly dans le
navigateur sans service tiers, adaptée aux salons (Megolm) et documentée
publiquement. libsignal exige des bindings plus lourds côté web ; MLS
nécessite un service de distribution dédié.

**« Quel est votre niveau d'engagement open source ? »**
Étendre et adapter : nous étendons la pile cryptographique du protocole
Matrix (bibliothèque olm, Apache-2.0) et adaptons ses mécanismes
(distribution de clés de salon signées, rotation sur changement de membre)
au contexte administratif burkinabè. Aucune cryptographie maison ; tout le
code est AGPL-3.0. Nous citons chaque technologie avec sa licence (README).

**« Le serveur voit-il quand même des choses ? »**
Oui — et nous le documentons honnêtement : membres des salons (qui échange
avec qui), horodatages, tailles, identités, TTL. Parades : TTL courts,
canaux nominatifs limités, pas de contenu ni d'objet, journal d'audit
consultable. (Note de sécurité, section métadonnées.)

**« Qu'est-ce qui arrive si un téléphone est volé déverrouillé ? »**
L'effacement à distance existe (profil → effacer les données locales), la
révocation coupe l'accès aux nouveaux messages. Limites documentées :
l'historique déjà déchiffré sur l'appareil reste lisible tant que la
révocation n'a pas atteint l'appareil — d'où l'expiration automatique des
messages sensibles, qui borne la fenêtre de risque.

**« Que feriez-vous avec 72 h de plus ? »**
Vérification croisée des clés par QR/emoji, messages vocaux chiffrés, mode
hors-ligne complet, PWA installable, et couverture mooré/dioula complète
avec des locuteurs natifs.

## Erreurs à éviter

- Ne pas lire le code en direct sans le comprendre : tout doit passer par
  docs/EXPLICATION_CODE.md (répété en équipe).
- Ne jamais prétendre « zéro métadonnées » : c'est faux et le jury le sait ;
  toujours parler de **minimisation**.
- Ne pas improviser les épreuves : les répéter 2 fois chacunes avant le 4
  novembre avec les comptes démo.
