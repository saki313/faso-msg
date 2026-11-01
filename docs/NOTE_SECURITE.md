# Note de sécurité — FasoMsg

**Sprint technique pré-hackathon · Hackathon 226 – Édition 2026 — socle de sécurité « obligatoire »**
Équipe : [Nom de l'équipe] — [Membre 1], [Membre 2], [Membre 3]

## 1. Menaces prises en compte et protections

| # | Menace | Protection en place |
|---|---|---|
| 1 | Écoute passive du réseau | Tout transite chiffré E2E ; contenu illisible même sur le serveur (Olm/Megolm, AES-GCM pour les fichiers). En production, TLS devant le service (terminaison sur le reverse-proxy de l'État). |
| 2 | Serveur compromis (lecture de la base) | La base ne contient **aucun clair** : enveloppes Megolm, blobs AES-GCM, clés publiques seulement. Outil d'audit : `scripts/inspecter_db.js`. |
| 3 | Usurpation / intrus non enrôlé | Enrôlement par code nominatif à usage unique (haché en base) ; inscription impossible sans code ; second facteur TOTP (RFC 6238) ; mots de passe scrypt + sel, comparaison à temps constant. |
| 4 | Force brute sur les identifiants | Blocage 5 échecs / 15 min par identifiant ; TOTP à 10⁶ combinaisons, fenêtre d'une seule période. |
| 5 | Vol ou départ d'un agent | Révocation immédiate : sessions détruites, connexion refusée, retrait de tous les salons, **rotation Megolm** (epoch) → plus aucune nouvelle clé distribuée, effacement local à distance (événement WebSocket « revocation »). |
| 6 | Fuite de session (vol de cookie) | Cookie HttpOnly + SameSite=Strict ; la base ne stocke que sha256(jeton) ; sessions expirées purgées ; révocation = invalidation immédiate. |
| 7 | Falsification / rejeu des clés de salon | Chaque clé de salon est **signée ed25519** par l'appareil émetteur et vérifiée contre l'annuaire des clés publiques ; les clés jetables (one-time keys) sont consommées une seule fois (claim + delete) ; les messages pré-clés Olm ne sont pas rejouables. |
| 8 | Injection web (XSS, clics piégés) | Échappement HTML systématique, CSP stricte (`self`, pas de script externe), X-Frame-Options DENY, aucun eval (WebAssembly via `wasm-unsafe-eval` uniquement), requêtes SQL préparées. |
| 9 | Diffusion non maîtrisée des notes sensibles | Classification : expiration automatique (suppression serveur), filigrane nominatif, copie bloquée, absence de fonction de transfert. |
| 10 | Compromission d'un appareil ancien | Clés jetables ⇒ forward secrecy des sessions Olm ; rotation Megolm borne la portée des anciennes clés de salon au passé du salon. |

## 2. Ce que le serveur voit malgré tout (métadonnées)

Honnêtement, un serveur E2EE conserve des métadonnées. FasoMsg expose : **qui échange avec qui** (membres des salons, conversations directes), **quand** (horodatages des envois et connexions), **quelle taille** (messages, fichiers), **l'expiration** (horodatage TTL, sans libellé de classification — celui-ci est chiffré), l'identité et la fonction des agents (annuaire, par conception administrative), les clés **publiques** des appareils et le journal d'audit. **Mesures de minimisation** : aucun contenu, objet ou libellé en clair ; TTL courts pour les messages classés (30 min à 7 jours, purge automatique) ; le serveur ne peut pas relire ni reconstruire les conversations du passé (clés absentes) ; journal d'audit consultable par l'administrateur pour la transparence. Une attaque par analyse de trafic temporel/correspondance de tailles reste théoriquement possible sur le flux — limite assumée, commune à toutes les messageries E2EE centralisées.

## 3. Limites connues

1. **Vérification des clés manuelle** : l'empreinte ed25519 est affichée (Profil) mais sans comparaison interactive croisée (emoji/QR) — extension prioritaire.
2. **Appareil compromis après déchiffrement** : un agent malveillant peut photographier ou exporter un message déjà déchiffré ; le filigrane nominatif en dissuade la diffusion, l'expiration en borne la durée, mais aucun système E2EE ne peut l'empêcher (limite fondamentale).
3. **Révocation et historique local** : l'agent révoqué avait accès, avant révocation, aux messages qu'il a déchiffrés ; l'effacement local est déclenché à distance dès reconnexion — s'il ne se reconnecte jamais, son stockage local antérieur reste sur son appareil.
4. **Client honnête** : l'expiration et le blocage de copie sont appliqués par notre client ; un client falsifié (code modifié) peut les ignorer. La rotation Megolm, elle, protège **cryptographiquement** les messages futurs.
5. **Rattrapage hors ligne** : la file « to-device » est plafonnée (300 messages) ; un appareil restant trop longtemps hors ligne doit se réenrôler en clés jetables.
6. **Mooré partiel** : la couverture linguistique est partielle et à valider par des locuteurs natifs.

## 4. Vérifiabilité

Toutes ces propriétés sont **rejouables par le jury** : `npm test` (10 tests e2e : serveur aveugle, intrus, révocation, rotation, expiration, TOTP), `node scripts/inspecter_db.js "phrase secrète"`, et épreuves en direct depuis l'interface d'administration. Les tests constituent la preuve d'acceptation du socle de sécurité.
