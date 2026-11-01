# FasoMsg — Messagerie souveraine de l'administration

**Hackathon 226 – Édition 2026 · Sprint technique pré-hackathon · MTDPCE – DGTD (Burkina Faso)**

FasoMsg est une messagerie instantanée chiffrée de bout en bout, destinée aux
agents de l'administration publique : messages, groupes, fichiers, canaux
institutionnels et annuaire officiel. Elle s'installe en **une commande** sur
une infrastructure maîtrisée par l'État, **sans aucun service tiers**, et le
serveur ne peut lire **ni les messages, ni les fichiers**.

## Concept

Les agents échangent aujourd'hui des informations de service sur des
messageries grand public dont les serveurs échappent à l'État. FasoMsg
reprend les usages attendus (conversations, groupes, fichiers, accusés de
lecture visuels) tout en plaçant la souveraineté au centre :

- **chiffrement de bout en bout** avec la pile cryptographique du protocole
  Matrix (Olm/Megolm), éprouvée par des millions d'utilisateurs ;
- **enrôlement nominatif** : seul un agent dont l'administrateur a généré le
  code peut créer un compte, avec mot de passe (scrypt) **et** second facteur
  TOTP ;
- **révocation immédiate** : un agent révoqué perd sa session, ne peut plus
  se connecter, ne reçoit plus aucune clé, et les membres restants rebasculent
  sur une nouvelle session de chiffrement ;
- **minimisation des métadonnées** : le serveur ne connaît ni le contenu, ni
  l'objet, ni la classification des messages — uniquement des enveloppes
  chiffrées et des horodatages.

## Architecture

```
 Navigateur (chaque agent)                Serveur (infrastructure de l'État)
 ┌──────────────────────────┐            ┌─────────────────────────────┐
 │ Clés privées Olm/Megolm   │            │ Node.js + Express + WebSocket│
 │ (localStorage scellé      │  HTTPS/WS  │ SQLite (module standard)    │
 │  par PBKDF2 du mot de     │◄──────────►│ - agents, rôles, sessions    │
 │  passe)                   │            │ - clés PUBLIQUES d'appareils │
 │ Fichiers chiffrés AES-GCM │            │ - enveloppes chiffrées ONLY  │
 └──────────────────────────┘            │ - journal d'audit           │
                                         └─────────────────────────────┘
   Établissement 1-à-1 : sessions Olm (Double Ratchet) → transport signé des
   clés de salon. Chiffrement de salon : sessions Megolm, rotation à chaque
   changement de membre (epoch). Fichiers : AES-GCM 256, clé transportée
   DANS le message chiffré.
```

## Technologies et licences (100 % open source)

| Composant | Usage | Licence | Projet |
|---|---|---|---|
| Node.js 24 | exécution serveur | MIT | https://nodejs.org |
| Express 5 | API REST | MIT | https://expressjs.com |
| ws | WebSocket | MIT | https://github.com/websockets/ws |
| node:sqlite | base de données | MIT (domaine public pour SQLite) | https://nodejs.org |
| **@matrix-org/olm** | **chiffrement Olm/Megolm** | **Apache-2.0** | https://gitlab.matrix.org/matrix-org/olm |
| otpauth | second facteur TOTP (RFC 6238) | MIT | https://github.com/hectorm/otpauth |
| qrcode | QR d'enrôlement TOTP | MIT | https://github.com/soldair/node-qrcode |
| esbuild | agrégation du client | MIT | https://esbuild.github.io |
| WebCrypto (navigateur) | AES-GCM fichiers, PBKDF2 | standard W3C | — |

**Niveau d'engagement : Étendre et adapter.** Nous étendons et adaptons la
pile cryptographique du protocole Matrix (bibliothèque `olm`, Apache-2.0) :
sessions Olm 1-pour-1, sessions Megolm par salon, rotation sur changement de
membre, distribution de clés signées ed25519. Toute la cryptographie de nos
échanges est celle du protocole Matrix — **aucune cryptographie maison**.
Code du projet : licence **AGPL-3.0** (fichier LICENSE).

## Installation (une commande)

```bash
docker compose up          # puis ouvrir http://localhost:3000
```

Au premier démarrage, des comptes de **démonstration fictifs** sont créés
(voir COMPTE_DEMO.md ; `GRAINE_DEMO=0` pour un déploiement réel).
Sans Docker :

```bash
npm install && npm run build && npm start    # Node.js >= 22.13 requis
npm test                                    # suite e2e (10 tests)
node scripts/inspecter_db.js "phrase secrète"   # preuve « serveur aveugle »
```

## Comptes de démonstration

Voir **COMPTE_DEMO.md** (7 agents fictifs, mot de passe `Faso@2026`, codes
TOTP calculables via `node scripts/totp.js <identifiant>`). Un code
d'enrôlement de démonstration permet de rejouer l'inscription d'un nouvel
agent. **Aucune donnée réelle n'est utilisée.**

## Fonctionnalités

- conversations directes, groupes de travail, **canaux institutionnels**
  (écriture réservée aux encadrants) ;
- **annuaire officiel** par ministère et fonction, recherche, « Écrire » ;
- fichiers chiffrés de bout en bout (10 Mo max) ;
- **classification** des messages : *Diffusion restreinte* / *Confidentiel*
  avec expiration automatique (30 min à 7 jours, suppression serveur),
  interdiction de transfert (aucune fonction de transfert n'existe, copie
  bloquée côté client) et **filigrane** nominatif du lecteur ;
- interface en **français et en mooré** (couverture partielle, salutations et
  déconnexion ; à étendre avec des locuteurs natifs) ;
- empreinte ed25519 de l'appareil comparable hors canal (écran Profil) ;
- journal d'audit (enrôlements, connexions, révocations, échecs).

## Limites connues

- pas de vérification croisée interactive (emoji/QR) des clés entre
  appareils : l'empreinte ed25519 est affichée mais la comparaison reste
  manuelle ;
- révocation : les messages déjà déchiffrés sur l'appareil d'un agent ne
  sont pas effacés de son stockage s'il est hors ligne au moment de la
  révocation (l'effacement à distance est appliqué dès son retour, et il ne
  peut plus déchiffrer aucun nouveau message) ;
- expiration : le serveur supprime les messages échus au cycle de nettoyage
  (60 s) ; un client honnête ne les affiche plus, un client falsifié peut
  conserver un message déjà déchiffré localement (limite de tout système E2EE
  avec clients non maîtrisés) ;
- interface mooré partielle (voir ci-dessus) ;
- pas de mode hors ligne complet (rattrapage par requête HTTP toutefois).

---
© 2026 Équipe FasoMsg — licence AGPL-3.0. Dépôt généré dans le cadre du
sprint technique pré-hackathon du Hackathon 226. Données exclusivement fictives.
