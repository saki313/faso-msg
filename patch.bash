#!/usr/bin/env bash
# ============================================================================
# appliquer_patches.sh — Applique les 3 patches FasoMsg depuis un fichier mbox
#
# Usage :
#   ./appliquer_patches.sh <fichier.mbox> [options]
#
# Options :
#   -n, --dry-run       Vérifie que les patches s'appliquent (git apply --check)
#   -b, --branche NOM   Nom de la branche de travail (défaut : patchs-fasomsg)
#   -k, --keep-mbox     Conserve le fichier mbox généré (défaut : supprimé)
#   -h, --help          Affiche cette aide
#
# Prérequis : git, bash >= 4, être dans un dépôt git propre.
# ============================================================================
set -euo pipefail

# ---------- Couleurs ----------
if [[ -t 1 ]]; then
  ROUGE=$'\033[31m'; VERT=$'\033[32m'; JAUNE=$'\033[33m'
  BLEU=$'\033[34m'; GRAS=$'\033[1m'; RAZ=$'\033[0m'
else
  ROUGE=''; VERT=''; JAUNE=''; BLEU=''; GRAS=''; RAZ=''
fi

info()  { printf '%s[info]%s  %s\n'  "$BLEU"  "$RAZ" "$*"; }
ok()    { printf '%s[ ok ]%s  %s\n'  "$VERT"  "$RAZ" "$*"; }
warn()  { printf '%s[warn]%s  %s\n'  "$JAUNE" "$RAZ" "$*" >&2; }
err()   { printf '%s[err ]%s  %s\n'  "$ROUGE" "$RAZ" "$*" >&2; }
die()   { err "$*"; exit 1; }

# ---------- Arguments ----------
MBOX=""
DRY_RUN=0
BRANCHE="patchs-fasomsg"
KEEP_MBOX=0

usage() { sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run)  DRY_RUN=1; shift ;;
    -b|--branche)  BRANCHE="$2"; shift 2 ;;
    -k|--keep-mbox) KEEP_MBOX=1; shift ;;
    -h|--help)     usage ;;
    -*)            die "Option inconnue : $1" ;;
    *)
      [[ -z "$MBOX" ]] || die "Un seul fichier mbox attendu"
      MBOX="$1"; shift ;;
  esac
done

[[ -n "$MBOX" ]] || { usage; }
[[ -f "$MBOX" ]] || die "Fichier introuvable : $MBOX"

# ---------- Vérifications du dépôt ----------
command -v git >/dev/null || die "git est requis"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "Ce script doit être lancé à la racine d'un dépôt git"

RACINE="$(git rev-parse --show-toplevel)"
cd "$RACINE"
info "Dépôt : $RACINE"

if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Le répertoire de travail n'est pas propre. Committez ou stashz d'abord."
fi
if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  warn "Fichiers non suivis présents (ignorés) :"
  git ls-files --others --exclude-standard | sed 's/^/       /' >&2
fi

# ---------- Découpage du mbox en patches individuels ----------
TMPDIR="$(mktemp -d)"
trap '[[ $KEEP_MBOX -eq 0 ]] && rm -rf "$TMPDIR"' EXIT

decouper_mbox() {
  local mbox="$1" dossier="$2"
  local n=0 fichier=""
  # Un nouveau patch commence par une ligne "From <sha> Mon Sep 17 00:00:00 2001"
  while IFS= read -r ligne || [[ -n "$ligne" ]]; do
    if [[ "$ligne" =~ ^From\ [0-9a-f]{40}\ Mon\ Sep\ 17\ 00:00:00\ 2001$ ]]; then
      n=$((n+1))
      fichier="$dossier/patch_$(printf '%02d' "$n").patch"
      : > "$fichier"
      continue
    fi
    [[ -n "$fichier" ]] && printf '%s\n' "$ligne" >> "$fichier"
  done < "$mbox"
  echo "$n"
}

info "Découpage du mbox en patches individuels…"
NB="$(decouper_mbox "$MBOX" "$TMPDIR")"
[[ "$NB" -ge 1 ]] || die "Aucun patch détecté dans $MBOX"
ok "$NB patch(s) extrait(s)"

# Résumé des sujets
for f in "$TMPDIR"/patch_*.patch; do
  sujet="$(grep -m1 '^Subject:' "$f" | sed -E 's/^Subject: (\[[^]]*\] )?//' \
           | sed -E 's/=\?UTF-8\?q\?//g; s/\?=//g; s/=20/ /g; s/=3D/=/g; s/=E2=80=94/—/g' \
           | tr -d '\r')"
  printf '       %s → %s\n' "$(basename "$f")" "$sujet"
done

# ---------- Mode dry-run ----------
if [[ "$DRY_RUN" -eq 1 ]]; then
  info "Mode dry-run : vérification de l'application séquentielle…"
  # On ne peut pas vraiment tester en séquence sans appliquer ; on valide
  # au moins que chaque patch est syntaxiquement applicable sur HEAD.
  echec=0
  for f in "$TMPDIR"/patch_*.patch; do
    if git apply --check --verbose "$f" 2>"$TMPDIR/err.txt"; then
      ok "$(basename "$f") s'applique sur HEAD"
    else
      warn "$(basename "$f") ne s'applique pas sur HEAD (attendu pour un patch en série) :"
      sed 's/^/       /' "$TMPDIR/err.txt" >&2
      echec=1
    fi
  done
  [[ $echec -eq 0 ]] && ok "Tous les patches s'appliquent." \
                     || warn "Certains patches nécessitent les précédents (normal en série)."
  info "Aucune modification effectuée."
  exit 0
fi

# ---------- Création de la branche de travail ----------
BRANCHE_COURANTE="$(git symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED")"
info "Branche courante : $BRANCHE_COURANTE"

if git show-ref --verify --quiet "refs/heads/$BRANCHE"; then
  warn "La branche '$BRANCHE' existe déjà."
  read -r -p "La réutiliser ? [o/N] " rep
  [[ "$rep" =~ ^[oOyY]$ ]] || die "Abandon."
  git checkout "$BRANCHE"
else
  git checkout -b "$BRANCHE"
  ok "Branche '$BRANCHE' créée"
fi

# ---------- Application avec git am ----------
info "Application des patches avec 'git am'…"
if git am --3way --keep-cr "$TMPDIR"/patch_*.patch; then
  ok "Les $NB patches ont été appliqués avec succès."
else
  err "Échec de 'git am'. Conflits à résoudre."
  cat <<'EOF'

Pour résoudre :
  1) Corrigez les fichiers en conflit (git status)
  2) git add <fichiers>
  3) git am --continue
Ou pour tout annuler :
  git am --abort
EOF
  # On conserve le TMPDIR en cas de conflit pour inspection
  KEEP_MBOX=1
  trap - EXIT
  warn "Patches conservés dans : $TMPDIR"
  exit 1
fi

# ---------- Résumé ----------
info "Historique des nouveaux commits :"
git log --oneline -"$NB" | sed 's/^/       /'

echo
ok "Terminé. Branche : $BRANCHE"
echo
cat <<EOF
Vérifications suggérées :
  npm install && npm run build && npm test     # 11 tests e2e attendus
  node scripts/totp.js admin.dgtd             # doit fonctionner sans npm install
  npm start                                   # avertissement si public/app.js absent
EOF
