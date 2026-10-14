#!/data/data/com.termux/files/usr/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${MAIA_REPO_DIR:-$HOME/storage/shared/Progetto maia/maia-roadmap-v2}"
ZIP="${1:-}"
MESSAGE="${2:-MAIA release}"

if [[ -z "$ZIP" ]]; then
  echo "Usage: ./scripts/maia-release.sh /path/to/MAIA.zip [commit message]"
  exit 2
fi
[[ -f "$ZIP" ]] || { echo "[ERROR] ZIP not found: $ZIP"; exit 2; }
[[ -d "$REPO_DIR/.git" ]] || { echo "[ERROR] Not a Git repo: $REPO_DIR"; exit 2; }

"$SCRIPT_DIR/maia-check.sh" "$ZIP" || exit $?

TMP="$(mktemp -d -t maia-release.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
unzip -q "$ZIP" -d "$TMP/raw"
shopt -s nullglob dotglob
entries=("$TMP/raw"/*)
if [[ ${#entries[@]} -eq 1 && -d "${entries[0]}" && -f "${entries[0]}/package.json" ]]; then
  CANDIDATE="${entries[0]}"
else
  CANDIDATE="$TMP/raw"
fi

cd "$REPO_DIR"
echo
echo "============================================================"
echo "MAIA RELEASE — HUMAN CONFIRMATION REQUIRED"
echo "============================================================"
echo "Repo: $REPO_DIR"
echo "ZIP : $ZIP"
echo
git status --short
echo
git diff --stat
printf '\nProceed with replacing source, commit and push? [y/N] '
read -r ANSWER
[[ "$ANSWER" =~ ^[Yy]$ ]] || { echo "[CANCELLED] No changes pushed."; exit 0; }

echo "[1/5] Replacing source tree..."
find "$REPO_DIR" -mindepth 1 -maxdepth 1 ! -name .git ! -name node_modules ! -name dist -exec rm -rf {} +
cp -a "$CANDIDATE"/. "$REPO_DIR"/

cd "$REPO_DIR"
echo "[2/5] Verifying source..."
git diff --check || { echo "[FAIL] git diff --check"; exit 1; }

echo "[3/5] Creating commit..."
git add -A
git status --short
git diff --cached --stat
git commit -m "$MESSAGE" || { echo "[FAIL] commit"; exit 1; }

echo "[4/5] Pushing..."
git push origin main || { echo "[FAIL] push"; exit 1; }

echo "[5/5] Verifying remote..."
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
echo "Local : $LOCAL"
echo "Remote: $REMOTE"
[[ "$LOCAL" == "$REMOTE" ]] || { echo "[FAIL] Remote SHA differs from local SHA"; exit 1; }

echo
echo "[PASS] MAIA release pushed and verified on GitHub."
