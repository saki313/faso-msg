# Vidéo de démonstration — storyboard (3 minutes maximum)

> Pièce n°5 du dossier. À enregistrer avec 2 navigateurs côte à côte
> (option : un PC + un smartphone) après `docker compose up`.
> Minutage cible : 2 min 55 s.

| # | Temps | Plan / action | Ce qu'on dit (voix off) |
|---|---|---|---|
| 1 | 0:00–0:10 | Titre : logo FasoMsg, « Messagerie souveraine de l'administration — Sprint Hackathon 226 ». Écran de connexion. | « FasoMsg : une messagerie chiffrée de bout en bout pour les agents de l'État, hébergeable en une commande, sans aucun service tiers. » |
| 2 | 0:10–0:25 | Terminal : `docker compose up`, ouverture du navigateur. | « Tout s'installe sur l'infrastructure de l'État. Aucune API externe n'est requise. » |
| 3 | 0:25–0:45 | Connexion : identifiant, mot de passe, **code TOTP** (montrer une app d'authentification). | « Chaque agent est préalablement enrôlé par l'administration et se connecte avec un second facteur : un code à six chiffres régénéré toutes les trente secondes. » |
| 4 | 0:45–1:15 | Deux fenêtres : `ouedraogo.a` (gauche) et `traore.k` (droite). Envoi d'un message dans la conversation directe, réception instantanée. Puis envoi d'un **fichier**. | « Les messages et les fichiers sont chiffrés de bout en bout avec la pile du protocole Matrix, Olm et Megolm. Regardons ce que voit réellement le serveur. » |
| 5 | 1:15–1:35 | Terminal : `node scripts/inspecter_db.js "réunion à 15h"` → « aucune occurrence ». Montrer aussi la ligne ciphertext. | « Voici toute notre base : des enveloppes chiffrées. Le texte du message n'apparaît nulle part. Le serveur est aveugle. » |
| 6 | 1:35–1:55 | Écran `ouedraogo.a` : sélectionner **« Diffusion restreinte »**, expiration 1 h. Envoi. Zoom sur le **filigrane** nominatif et l'absence de transfert/copy. | « Les notes de service peuvent être classées diffusion restreinte ou confidentiel : expiration automatique, filigrane nominatif, copie désactivée, et aucune fonction de transfert. » |
| 7 | 1:55–2:20 | Fenêtre admin `admin.dgtd` : Administration → Agents → **Révoquer** `traore.k`. Retour sur la fenêtre de traore.k : bandeau « Accès révoqué », stockage local vidé. | « Révocation immédiate : l'agent perd l'accès sur tous ses appareils, ses données locales sont effacées à distance. » |
| 8 | 2:20–2:40 | `ouedraogo.a` envoie un NOUVEAU message. Fenêtre (rouverte) de l'agent révoqué : impossible de lire. Montrer la tentative de reconnexion refusée. | « Il ne peut plus se connecter, et les nouvelles clés de salon ne lui sont plus distribuées : les nouveaux messages lui sont à jamais illisibles. » |
| 9 | 2:40–2:55 | Écran final : annuaire par ministère + bascule interface en **mooré** (« Wend na wat ne »). | « Annuaire officiel par ministère, canaux institutionnels, et interface disponible en français et en mooré. FasoMsg : la souveraineté numérique au service de l'administration. » |

## Checklist d'enregistrement

- [ ] Nettoyer les données avant la prise (`rm data/fasomsg.db` puis relancer) ;
- [ ] Résolution 1920×1080, deux fenêtres côte à côte visibles ;
- [ ] Codes TOTP des comptes démo ouverts à l'avance (`node scripts/totp.js …`) ;
- [ ] Fermer les notifications système ;
- [ ] Être < 3:00 au montage final (couper les temps morts) ;
- [ ] Nommer la vidéo : `FasoMsg-demo-3min.mp4`.
