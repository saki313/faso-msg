# Comptes de démonstration FasoMsg (fictifs)

> Conformément à l'appel à projets : **toutes les données ci-dessous sont
> fictives**. Aucun agent réel, aucun numéro ni adresse réels.

## Connexion

Ouvrez FasoMsg puis, pour chaque compte :

- **identifiant** : voir tableau ;
- **mot de passe** : `Faso@2026` ;
- **code TOTP (6 chiffres)** : généré par `node scripts/totp.js <identifiant>`
  (ou par toute application TOTP — FreeOTP, Aegis, Google Authenticator —
  après scan du QR affiché à l'inscription ; les secrets fixes ci-dessous
  permettent aussi de les ajouter manuellement).

| Identifiant | Nom fictif | Ministère | Fonction | Rôle | Secret TOTP (base32) |
|---|---|---|---|---|---|
| `admin.dgtd` | DIALLO Fatoumata | MTDPCE – DGTD | Administratrice de la messagerie | **admin** | `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |
| `sawadogo.m` | SAWADOGO Mariam | Santé | Directrice des SI | superviseur | `MFRGGZDFMZTWQ2LKONXW4ZDFMFRGGZDF` |
| `ouedraogo.a` | OUÉDRAOGO Adama | MTDPCE – DGTD | Chargé de projet numérique | agent | `NBSWY3DPFQQFO33SM5XCA3DFNBSWY3DP` |
| `traore.k` | TRAORÉ Korotoum | Éducation nationale | Inspectrice pédagogique | agent | `ONSWG43FMZSXIZLOORUWG33SNZZGK3DF` |
| `zongo.b` | ZONGO Boukary | Agriculture | Ingénieur statisticien | agent | `OVQXG5CTM5XCA3LUMVQXG5CTM5XCA3LU` |
| `compaore.n` | COMPAORÉ Nassara | Action sociale | Assistante sociale | agent | `NVSQ2ZLBORUGK3TFMVSQ2ZLBORUGK3TF` |
| `kabore.f` | KABORÉ Fabrice | Économie et Finances | Contrôleur budgétaire | agent | `NFXGS3TPO5XCA3LUNFXGS3TPO5XCA3LU` |

Exemple : `node scripts/totp.js traore.k` affiche le code courant de TRAORÉ.

## Scénario type pour le jury (3 minutes)

1. Ouvrez deux navigateurs (ou deux fenêtres privées).
2. Connectez `ouedraogo.a` et `traore.k` : ils ont déjà une conversation
   directe (« Comité » prérempli non nécessaire : chercher l'agent dans
   l'annuaire et cliquer « Écrire »).
3. `ouedraogo.a` envoie un message, puis un fichier : `traore.k` le reçoit
   déchiffré. `node scripts/inspecter_db.js "texte du message"` : aucune
   occurrence en base.
4. `admin.dgtd` révoque `traore.k` (Administration → Agents → Révoquer) :
   sa fenêtre affiche « Accès révoqué » et son stockage local est effacé.
5. `ouedraogo.a` renvoie un message : l'ancien agent ne peut pas le lire.

## Enrôlement d'un nouvel agent (épreuve « Intrus » inversée)

- `admin.dgtd` → Administration → Enrôlement → renseigner
  (ILBOUDO Rahamata, MTDPCE – DGTD, Stagiaire développeuse, agent) → un
  **code à usage unique** s'affiche.
- Sur la page d'accueil → « Je dispose d'un code d'enrôlement » → saisir le
  code, choisir l'identifiant et le mot de passe → scanner le QR → saisir le
  code TOTP → le compte est actif.
- **Un code invalide, déjà utilisé, ou l'absence de code : rejet (403).**

Un code de démonstration non utilisé est préchargé : `DEMO2262026`
(ILBOUDO Rahamata) pour tester l'inscription sans passer par l'admin.

## Classification des messages

Dans le composeur : *Normal* / *Diffusion restreinte* / *Confidentiel*.
Choisir une expiration (30 min, 1 h, 24 h, 7 jours). Les messages restreints
affichent un **filigrane nominatif**, ne peuvent pas être copiés, et il
n'existe **aucune fonction de transfert** dans l'application. À l'échéance,
le message disparaît de tous les clients **et de la base serveur**
(vérifiable : `node scripts/inspecter_db.js`).
