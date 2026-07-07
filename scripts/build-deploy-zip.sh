#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/build-deploy-zip.sh
#
# Creates a deployment zip that includes EVERY git-tracked file.
# Uses `git archive` so nothing can be accidentally omitted — no more
# hand-picked allow-lists that miss index.html, agent/, etc.
#
# Excludes: node_modules, dist, .env (via .gitignore / git tracking)
# Includes: everything `git ls-files` knows about, including uncommitted
#           staged changes (we archive from HEAD, so commit first).
#
# Usage:  bash scripts/build-deploy-zip.sh
# Output: pawsome3d-deploy.zip in the project root
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")/.."

ZIP_NAME="pawsome3d-deploy.zip"

# Remove stale zip if present.
rm -f "$ZIP_NAME"

# ── Archive from HEAD (all tracked files, respects .gitignore) ───────────────
git archive --format=zip --output="$ZIP_NAME" HEAD

# ── Sanity check: confirm critical files are present ─────────────────────────
echo ""
echo "── Sanity check ──"
MUST_HAVE=("index.html" "server.ts" "package.json" "vite.config.ts" "src/main.tsx" "agent/graph/orchestrator.ts" "agent/tools/blender_client.ts")
ZIP_LIST=$(unzip -l "$ZIP_NAME")
ALL_OK=true
for f in "${MUST_HAVE[@]}"; do
  if echo "$ZIP_LIST" | grep -qF "  $f"; then
    echo "  ✅  $f"
  else
    echo "  ❌  MISSING: $f"
    ALL_OK=false
  fi
done

echo ""
if $ALL_OK; then
  echo "✅  Created $ZIP_NAME ($(du -h "$ZIP_NAME" | cut -f1))"
  echo "    Upload this to Hostinger — it will run npm install && npm run build."
else
  echo "⚠️   Some critical files are missing! Did you forget to commit?"
  echo "    Run: git add -A && git commit, then re-run this script."
  exit 1
fi
