# Explication du code — préparation à l'entretien technique

> L'entretien est **éliminatoire** : le jury désigne une fonction liée au
> chiffrement ou à l'authentification et un membre désigné doit l'expliquer.
> Ce document parcourt les fonctions clés, fichier par fichier. Chaque
> membre de l'équipe doit savoir exposer les sections marquées ★.

## 1. client/crypto.mjs — le cœur du chiffrement

### ★ `GestionnaireCrypto.ouvrirCompte()` — clés d'appareil
```
this.compte = new Olm.Account();
if (pickle) this.compte.unpickle(this.clePickle, pickle);
else { this.compte.create(); this.stockage.setItem(...) }
```
- `Account` = identité cryptographique de **l'appareil** (pas de l'agent) :
  une clé curve25519 (échange) et une clé ed25519 (signature).
- Les clés **privées** ne quittent jamais le navigateur. Elles sont
  « picklées » : sérialisées chiffrées, scellées par une clé dérivée du mot
  de passe de l'agent (PBKDF2-SHA256, 210 000 itérations, sel local).
- `create()` vient de la bibliothèque olm : nous n'écrivons **aucune**
  cryptographie nous-mêmes.

### ★ `sessionSortante(salonId, epoch)` — rotation Megolm
- Un salon = une session **Megolm** côté émetteur. Tant que `epoch` ne
  change pas, la même session avance son ratchet message après message.
- À chaque changement de membre (ajout, départ, **révocation**), le serveur
  incrémente `epoch` → la clé de stockage `sort:<salon>:<epoch>` ne
  correspond plus → **nouvelle session créée**, dont la clé n'est partagée
  qu'aux membres restants.
- Point technique important : `session_key()` est exportée **avant tout
  chiffrement** (index 0) — sinon les messages précédents deviendraient
  indéchiffrables pour les nouveaux destinataires.

### ★ `chiffrerPourAppareil(appareil, cleJetable, texte)` — sessions Olm 1-à-1
- Transport confidentiel **d'une clé de salon** vers un appareil précis.
- Réutilise la session Olm existante si elle existe (`olm:dest:<id>`) ; sinon
  l'établit avec `create_outbound(compte, cléPubliqueDistante, cléJetable)`.
- La **clé jetable** (one-time key) garantit la *forward secrecy* : chaque
  session 1-à-1 est unique, établie une fois, jamais rejouable.
- Ce que voit le serveur : `{type, body}` — un message Olm opaque.

### ★ `dechiffrerDepuisAppareil(ciphertext)` — réception to-device
- Essaie chaque session Olm connue ; si échec et type 0 (prekey message),
  crée la session entrante avec `create_inbound(compte, body)`.
- `create_inbound` vérifie cryptographiquement que le message a été chiffré
  **pour notre clé jetable réservée** — personne d'autre ne peut s'y insérer.
s
### `ajouterSessionEntrante(sessionId, sessionKey)` + vérification amont
- Vérifie que `session.session_id()` correspond à l'id annoncé (cohérence),
  puis stocke la session entrante picklée.

## 2. Le partage de clés de salon (client/main.mjs → `partagerCleSalon`)

```
payload   = {type:'cle_sal', salon_id, epoch, session_id, session_key,
             ed25519_emetteur, appareil_emetteur, agent_emetteur}
signature = compte.sign(JSON.stringify(payload))          // ed25519
ciphertext_olm = sessionOlm.encrypt(JSON{payload, signature})
```
Côté destinataire (`verifierEtInstallerCle`) — **double vérification** :
1. `ed25519_verify` : la signature correspond bien à la clé publique de
   l'appareil émetteur → la clé de salon vient bien de lui, pas d'un
   intermédiaire (attaque man-in-the-middle détectée) ;
2. la clé ed25519 annoncée existe réellement dans l'annuaire serveur comme
   appareil de l'émetteur → pas d'usurpation d'identité.

**Rattrapage des clés (appareil en retard)** : la clé est partagée à la
CRÉATION de la session, puis re-partagée à chaque envoi et à l'ouverture du
salon aux appareils pas encore couverts (`exporterCleSalon` : clé exportée
à l'index 0 → le destinataire déchiffre toute l'historique, via
`import_session`). Si un message reste indéchiffrable, le client envoie une
`demande_cle` Olm-signée à l'émetteur (type `m.room_key_request` de Matrix) ;
l'émetteur répond par un partage classique après vérification signature +
annuaire + appartenance au salon. Un agent révoqué, retiré des salons, ne
peut ni demander ni recevoir de clé.

## 3. src/auth.js — authentification forte

### ★ `hacherMotDePasse` / `verifierMotDePasse` — scrypt
- `crypto.scryptSync(motDePasse, sel, 64)` : fonction de dérivation de clé
  résistante aux GPU, de la bibliothèque standard Node.js ; sel aléatoire de
  16 octets par agent ; comparaison à **temps constant**
  (`timingSafeEqual`) contre les attaques temporelles.

### ★ `codeTotpValide` — second facteur (RFC 6238)
- TOTP = code à 6 chiffres recalculé toutes les 30 s à partir d'un secret
  partagé à l'inscription (QR). `otpauth` (MIT) implémente la RFC ;
  `window:1` tolère un décalage d'horloge d'une période.

### `creerSession` / `agentDepuisJeton` — sessions serveur
- Jeton aléatoire 256 bits, envoyé en cookie **HttpOnly + SameSite=Strict** ;
  la base ne conserve que `sha256(jeton)` : une fuite de base ne permet pas
  de rejouer des sessions. Toute session d'un agent révoqué est détruite.

### `estBloqué` (limitation des tentatives)
- 5 échecs → blocage 15 min par identifiant (force brute).

## 4. src/api.js — le serveur relais aveugle

### ★ POST `/salons/:id/messages`
- Le corps reçu : `{session_id, ciphertext, expire_le}`. Le serveur **ne
  connaît pas** la clé Megolm (jamais envoyée par cette route), ne peut pas
  déchiffrer, et stocke le ciphertext tel quel avec un horodatage.
- `expire_le` : simple horodatage TTL (le libellé « Diffusion restreinte /
  Confidentiel » est DANS le message chiffré → invisible du serveur).

### ★ POST `/admin/agents/:id/revoquer` — les 5 étapes
1. `statut='revoque'` → connexion impossible ;
2. `DELETE FROM sessions` → sessions invalidées **immédiatement** ;
3. purge des clés jetables et de la file to-device → plus rien à recevoir ;
4. retrait de tous les salons + `epoch+1` → **rotation Megolm obligatoire**
   pour les membres restants ;
5. WebSocket `revocation` → effacement local à distance (localStorage
   purgé) puis fermeture des connexions.

### POST `/keys/claim` — réservation de clé jetable
- `SELECT` puis `DELETE` : une one-time key n'est servie **qu'une fois**,
  ce qui rend le message prekey non rejouable.

### `authentifie` / `exigerRole` / `membre()` — contrôle d'accès
- Chaque route vérifie la session, l'appartenance au salon et, pour les
  canaux, le droit d'écrire (`ecriture='encadrants'`).

## 5. Fichiers chiffrés (client/crypto.mjs, `chiffrerFichier`)

- AES-GCM 256 (WebCrypto du navigateur), IV aléatoire 96 bits.
- La clé et l'IV voyagent **dans le message Megolm** → jamais visibles du
  serveur ; lui ne voit qu'un blob opaque (10 Mo max) + empreinte sha256.

## 6. Questions pièges probables

- « Pourquoi Megolm et pas Olm pour les groupes ? » → Olm est 1-pour-1 avec
  une session par destinataire (coûteux en groupe) ; Megolm est conçu pour
  1-pour-N avec ratchet de groupe et clés signées. C'est le couple du
  protocole Matrix, repris tel quel.
- « Que se passe-t-il si le serveur est compromis ? » → Il voit des
  enveloppes et des métadonnées (qui, quand, taille), jamais le contenu. Il
  peut refuser le service, pas lire. La note de sécurité liste les
  métadonnées restantes et les parades.
- « Pourquoi une epoch et pas une révocation des clés ? » → En E2EE, le
  serveur ne peut pas déchiffrer l'historique à la place de quelqu'un ; il
  faut empêcher les clés futures de fuiter : la rotation Megolm borne la
  portée d'une ancienne clé au passé du salon.
- « Un agent révoqué peut-il relire l'historique ? » → Il a pu déchiffrer
  les messages antérieurs à sa révocation sur son appareil (limite
  documentée, identique aux messageries grand public sur appareil
  compromis) ; en revanche il ne peut plus recevoir aucune nouvelle clé, et
  son stockage local est effacé à distance dès qu'il se reconnecte.
