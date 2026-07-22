#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/build-deploy-zip.sh
#
# Creates a deployment zip and validates the archive via extracted-archive testing.
#
# Usage:  bash scripts/build-deploy-zip.sh [--allow-dirty]
# Output: pawsome3d-deploy.zip (or pawsome3d-deploy-dirty.zip for test runs)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW_DIRTY=false
for arg in "$@"; do
  if [ "$arg" == "--allow-dirty" ]; then
    ALLOW_DIRTY=true
  fi
done

# ── 1. Check worktree cleanliness ─────────────────────────────────────────────
if [ "$ALLOW_DIRTY" = false ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Worktree has uncommitted changes!"
    echo "   Commit all changes before packaging or pass --allow-dirty for test runs."
    git status --short
    exit 1
  fi
fi

COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
if [ "$ALLOW_DIRTY" = true ]; then
  ZIP_NAME="pawsome3d-deploy-dirty.zip"
else
  ZIP_NAME="pawsome3d-deploy.zip"
fi

STAGING_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'paws_stage')
EXTRACT_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'paws_extract')

cleanup() {
  rm -rf "$STAGING_DIR" "$EXTRACT_DIR"
}
trap cleanup EXIT

# ── 2. Generate manifest into staging directory ──────────────────────────────
MANIFEST_STAGE="$STAGING_DIR/release-manifest.json"
node scripts/generate-manifest.mjs "--output=$MANIFEST_STAGE"

# Remove old zip
rm -f "$ZIP_NAME" pawsome3d-deploy.zip pawsome3d-deploy-dirty.zip 2>/dev/null || true

# ── 3. Create zip archive ───────────────────────────────────────────────────
if [ "$ALLOW_DIRTY" = true ]; then
  echo "⚠️  Packaging current worktree ($ZIP_NAME, --allow-dirty enabled)..."
  git ls-files --cached --others --exclude-standard | zip -q "$ZIP_NAME" -@
else
  echo "📦 Archiving exact commit $COMMIT_SHA into $ZIP_NAME..."
  git archive --format=zip --output="$ZIP_NAME" HEAD
fi

PROJECT_ROOT="$(pwd)"

# Add release-manifest.json to zip
(cd "$STAGING_DIR" && zip -q -u "$PROJECT_ROOT/$ZIP_NAME" release-manifest.json)

# ── 4. Extracted-Archive Smoke & Integrity Test ─────────────────────────────
echo ""
echo "── Extracted Archive Verification Gate ──"

# Test zip archive integrity
unzip -t "$ZIP_NAME" > /dev/null

# Extract to temporary directory
unzip -q "$ZIP_NAME" -d "$EXTRACT_DIR"

ALL_OK=true

# Check required files
MUST_HAVE=(
  "index.html"
  "server.ts"
  "db.ts"
  "package.json"
  "package-lock.json"
  "vite.config.ts"
  "release-manifest.json"
)

for f in "${MUST_HAVE[@]}"; do
  if [ -f "$EXTRACT_DIR/$f" ]; then
    echo "  ✅ Required file present: $f"
  else
    echo "  ❌ MISSING REQUIRED FILE: $f"
    ALL_OK=false
  fi
done

# Check forbidden files (exact relative path matching)
FORBIDDEN_FILES=(
  ".env"
  ".env.local"
  ".env.production"
)

for f in "${FORBIDDEN_FILES[@]}"; do
  if [ -f "$EXTRACT_DIR/$f" ]; then
    echo "  ❌ FORBIDDEN SECRET FILE INCLUDED: $f"
    ALL_OK=false
  else
    echo "  ✅ Forbidden secret absent: $f"
  fi
done

# Confirm .env.example IS present (not mistaken for .env)
if [ -f "$EXTRACT_DIR/.env.example" ]; then
  echo "  ✅ .env.example correctly preserved"
else
  echo "  ❌ .env.example missing"
  ALL_OK=false
fi

# Check forbidden directories
FORBIDDEN_DIRS=(
  ".git"
  "node_modules"
  "coverage"
  ".nyc_output"
)

for d in "${FORBIDDEN_DIRS[@]}"; do
  if [ -d "$EXTRACT_DIR/$d" ]; then
    echo "  ❌ FORBIDDEN DIRECTORY INCLUDED: $d"
    ALL_OK=false
  else
    echo "  ✅ Forbidden directory absent: $d"
  fi
done

# Verify recalculated SHA-256 checksums of EVERY file in manifest
CHECKSUM_RES=$(node -e "
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const extractDir = '$EXTRACT_DIR';
const manifestPath = path.join(extractDir, 'release-manifest.json');
if (!fs.existsSync(manifestPath)) { console.log('MISSING_MANIFEST'); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 17) { console.log('INVALID_SCHEMA_VERSION_' + manifest.schemaVersion); process.exit(1); }
if (!manifest.engineCompatible) { console.log('INCOMPATIBLE_ENGINE'); process.exit(1); }
let ok = true;
for (const [file, expectedHash] of Object.entries(manifest.checksums || {})) {
  const fullPath = path.join(extractDir, file);
  if (!fs.existsSync(fullPath)) { console.log('MISSING_FILE_' + file); ok = false; continue; }
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
  if (actualHash !== expectedHash) { console.log('CHECKSUM_MISMATCH_' + file); ok = false; }
}
if (ok) console.log('CHECKSUMS_OK');
else process.exit(1);
" 2>&1 || echo "CHECKSUM_VERIFICATION_FAILED")

if echo "$CHECKSUM_RES" | grep -q "CHECKSUMS_OK"; then
  echo "  ✅ All extracted file SHA-256 checksums verified against manifest (schemaVersion 17)"
else
  echo "  ❌ SHA-256 CHECKSUM VERIFICATION FAILED: $CHECKSUM_RES"
  ALL_OK=false
fi

echo ""
if $ALL_OK; then
  echo "✅ Archive verification passed for $ZIP_NAME ($(du -h "$ZIP_NAME" | cut -f1))"
else
  echo "❌ Archive verification failed!"
  exit 1
fi
