#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/build-deploy-zip.sh
#
# Creates a deployment zip from the project root that includes EVERY file
# Hostinger's Node.js builder needs: the Vite entry (index.html), all source,
# config, and public assets.
#
# Usage:  bash scripts/build-deploy-zip.sh
# Output: pawsome3d-deploy.zip in the project root
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")/.."

ZIP_NAME="pawsome3d-deploy.zip"

# Remove stale zip if present.
rm -f "$ZIP_NAME"

# ── Explicit allow-list ──────────────────────────────────────────────────────
# Vite entry point — THIS MUST BE INCLUDED or the build fails with
# "Could not resolve entry module index.html".
ROOT_FILES=(
  index.html
  landing-index.html
  package.json
  package-lock.json
  vite.config.ts
  tsconfig.json
  server.ts
  db.ts
  auth.ts
  storage.ts
  heygen.ts
  tripo.ts
  ollama-agent.ts
  checkUsers.ts
  clear-db.ts
  metadata.json
  .env.example
)

# Directories (recursive).
DIRS=(
  src/
  public/
  scripts/
)

# ── Build the zip ────────────────────────────────────────────────────────────
zip -r "$ZIP_NAME" "${ROOT_FILES[@]}" "${DIRS[@]}" \
  -x "**/node_modules/*" \
  -x "**/.DS_Store" \
  -x "**/dist/*"

echo ""
echo "✅  Created $ZIP_NAME ($(du -h "$ZIP_NAME" | cut -f1))"
echo "    Upload this to Hostinger — it will run npm install && npm run build."
