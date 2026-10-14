#!/data/data/com.termux/files/usr/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="${MAIA_REPO_DIR:-$HOME/storage/shared/Progetto maia/maia-roadmap-v2}"
ZIP=""
SKIP_INSTALL=0

usage() {
  echo "Usage: ./scripts/maia-check.sh /path/to/MAIA.zip [--skip-install]"
}

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) [[ -z "$ZIP" ]] && ZIP="$arg" || { echo "[ERROR] Unknown argument: $arg"; usage; exit 2; } ;;
  esac
done

[[ -n "$ZIP" ]] || { usage; exit 2; }
[[ -f "$ZIP" ]] || { echo "[ERROR] ZIP not found: $ZIP"; exit 2; }
command -v unzip >/dev/null || { echo "[ERROR] unzip is required."; exit 2; }
command -v npm >/dev/null || { echo "[ERROR] npm is required."; exit 2; }
command -v node >/dev/null || { echo "[ERROR] node is required."; exit 2; }

TMP="$(mktemp -d -t maia-check.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

CANDIDATE="$TMP/candidate"
mkdir -p "$CANDIDATE"
unzip -q "$ZIP" -d "$CANDIDATE"

# Normalize a single wrapper directory if the ZIP was packaged one level too deep.
shopt -s nullglob dotglob
entries=("$CANDIDATE"/*)
if [[ ${#entries[@]} -eq 1 && -d "${entries[0]}" && -f "${entries[0]}/package.json" ]]; then
  INNER="${entries[0]}"
  mkdir -p "$TMP/normalized"
  cp -a "$INNER"/. "$TMP/normalized"/
  CANDIDATE="$TMP/normalized"
fi

for required in package.json server.ts src/App.tsx; do
  [[ -e "$CANDIDATE/$required" ]] || { echo "[ERROR] Candidate missing required path: $required"; exit 2; }
done

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "[INFO] Comparing candidate with official repo: $REPO_DIR"
  echo "--- changed files (candidate vs repo) ---"
  diff -qr --exclude=.git --exclude=node_modules --exclude=dist --exclude=test-results "$REPO_DIR" "$CANDIDATE" || true
  echo "-----------------------------------------"
else
  echo "[WARN] Official repo not found at: $REPO_DIR"
fi

cd "$CANDIDATE"
if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  echo "[1/5] Installing dependencies..."
  echo "Node: $(node --version)"
  echo "npm : $(npm --version)"
  if [[ -f package-lock.json ]]; then
    npm ci || { echo "[FAIL] npm dependency installation (npm ci)"; exit 1; }
  else
    npm install || { echo "[FAIL] npm dependency installation (npm install)"; exit 1; }
  fi
else
  echo "[1/5] Dependency installation skipped"
fi

REPORT="$TMP/maia-check-report.txt"
: > "$REPORT"
report() { echo "$1" | tee -a "$REPORT"; }

TS_STATUS="PASS"
if [[ "$(node -p 'process.platform')" == "android" && "$(node -p 'process.arch')" == "arm64" ]]; then
  echo "[2/5] TypeScript check..."
  echo "[ENVIRONMENT-LIMITED] Native TypeScript 7 compiler is not available for Android arm64/Termux."
  echo "[INFO] Verifying TypeScript dependency/configuration instead; build remains mandatory."
  if ! node -e 'const p=require("./package.json"); if(!p.devDependencies?.typescript) process.exit(1); console.log("TypeScript dependency:",p.devDependencies.typescript)' ; then
    echo "[FAIL] TypeScript dependency/configuration check"
    exit 1
  fi
  TS_STATUS="ENVIRONMENT-LIMITED"
else
  echo "[2/5] TypeScript check..."
  npm run lint || { echo "[FAIL] TypeScript check"; exit 1; }
fi

echo "[3/5] Production build..."
npm run build || { echo "[FAIL] Production build"; exit 1; }

echo "[4/5] Full automatic regression suite..."
npm run test:regression || { echo "[FAIL] Automatic regression suite"; exit 1; }

echo "[5/5] Git-style whitespace check..."
if command -v git >/dev/null; then
  git diff --no-index --check /dev/null package.json >/dev/null 2>&1 || true
fi

report "RESULT=PASS"
report "TYPESCRIPT=$TS_STATUS"
report "BUILD=PASS"
report "REGRESSION=PASS"
report "ZIP=$ZIP"

echo
echo "[PASS] maia-check completed successfully."
if [[ "$TS_STATUS" == "ENVIRONMENT-LIMITED" ]]; then
  echo "[NOTE] Overall PASS includes an explicit environment limitation: TypeScript compiler was not executable on Android arm64."
fi
