#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW_DIRTY=false
for arg in "$@"; do
  if [ "$arg" = "--allow-dirty" ]; then ALLOW_DIRTY=true; fi
done

if [ "$ALLOW_DIRTY" = false ] && [ -n "$(git status --porcelain)" ]; then
  echo "Worktree has uncommitted changes. Commit before production packaging."
  git status --short
  exit 1
fi

node -e "import('./scripts/release-manifest-lib.mjs').then(m => { if (!m.validateEngineVersion(process.version)) process.exit(1); })" || {
  echo "Node $(node --version) is incompatible; required >=24.15 <25."
  exit 1
}

COMMIT_SHA=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)
if [ -z "$BRANCH" ]; then BRANCH="detached"; fi

if [ "$ALLOW_DIRTY" = true ]; then
  ZIP_NAME="pawsome3d-deploy-dirty.zip"
else
  ZIP_NAME="pawsome3d-deploy.zip"
fi

STAGING_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t paws_stage)
EXTRACT_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t paws_extract)
cleanup() { rm -rf "$STAGING_DIR" "$EXTRACT_DIR"; }
trap cleanup EXIT

echo "Running fail-closed production build..."
npm run build

if [ "$ALLOW_DIRTY" = true ]; then
  echo "Packaging a non-production dirty worktree archive..."
  git ls-files --cached --others --exclude-standard | while IFS= read -r file; do
    mkdir -p "$STAGING_DIR/$(dirname "$file")"
    cp -p "$file" "$STAGING_DIR/$file"
  done
else
  echo "Materializing exact commit $COMMIT_SHA..."
  git archive HEAD | tar -x -C "$STAGING_DIR"
fi

MUST_HAVE=(.env.example package.json package-lock.json server.ts db.ts index.html vite.config.ts)
for required in "${MUST_HAVE[@]}"; do
  if [ ! -f "$STAGING_DIR/$required" ]; then
    echo "Required deployment file is missing: $required"
    exit 1
  fi
done

shopt -s nullglob
for env_file in "$STAGING_DIR"/.env*; do
  if [ "$(basename "$env_file")" != ".env.example" ]; then
    echo "Forbidden environment file in release stage: $(basename "$env_file")"
    exit 1
  fi
done
shopt -u nullglob

for forbidden_dir in .git node_modules coverage .nyc_output; do
  if [ -e "$STAGING_DIR/$forbidden_dir" ]; then
    echo "Forbidden directory in release stage: $forbidden_dir"
    exit 1
  fi
done

APP_COMMIT_SHA="$COMMIT_SHA" \
APP_BRANCH="$BRANCH" \
RELEASE_DIRTY="$ALLOW_DIRTY" \
node scripts/generate-manifest.mjs \
  "--target-dir=$STAGING_DIR" \
  "--output=$STAGING_DIR/release-manifest.json"

rm -f "$ZIP_NAME"
PROJECT_ROOT=$(pwd)
(cd "$STAGING_DIR" && zip -q -r "$PROJECT_ROOT/$ZIP_NAME" .)

unzip -t "$ZIP_NAME" >/dev/null
unzip -q "$ZIP_NAME" -d "$EXTRACT_DIR"

REQUIRE_CLEAN=true
if [ "$ALLOW_DIRTY" = true ]; then REQUIRE_CLEAN=false; fi
EXPECTED_COMMIT="$COMMIT_SHA" \
EXPECTED_BRANCH="$BRANCH" \
REQUIRE_CLEAN="$REQUIRE_CLEAN" \
node scripts/verify-release-directory.mjs "$EXTRACT_DIR"

echo "Archive verification passed: $ZIP_NAME"
echo "Archive SHA-256: $(shasum -a 256 "$ZIP_NAME" | awk '{print $1}')"
