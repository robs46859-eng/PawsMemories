#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/ship-ui-seo-fixes.sh
#
# Runs the pre-deploy checklist from DEPLOYMENT_NOTES.md for the
# SEO-canonical + shell/FurBin/model-card/soft-delete change set, then builds
# the Hostinger deploy zip.
#
# WHY THIS EXISTS: the deploy zip is `git archive HEAD`, so the work has to be
# committed before the zip is built or it ships stale code. Commits can't be
# made from the Cowork sandbox (the mount blocks git's unlink/lock calls — see
# DEPLOYMENT_NOTES.md §4), so this has to run on the Mac.
#
# Usage:  bash scripts/ship-ui-seo-fixes.sh
# Output: pawsome3d-deploy.zip in the project root, ready to upload.
#
# Safe to re-run. Stops at the first failure and changes nothing after it.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()  { printf '   \033[32m✅ %s\033[0m\n' "$1"; }
warn(){ printf '   \033[33m⚠️  %s\033[0m\n' "$1"; }

# ── 0. Clear the stale lock the sandbox left behind ──────────────────────────
# A `git add` attempted from the sandbox created .git/index.lock and then could
# not remove it. It is zero-length and no git process owns it, but it will block
# every git command here until it's gone.
say "Clearing stale git lock"
if [ -f .git/index.lock ]; then
  if pgrep -x git >/dev/null 2>&1; then
    warn "A real git process is running — not touching the lock."
    warn "Close any open git/editor operation, then re-run this script."
    exit 1
  fi
  rm -f .git/index.lock
  ok "Removed stale .git/index.lock"
else
  ok "No stale lock"
fi

# ── 1. Confirm we're on main with the expected work present ──────────────────
say "Checking working tree"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
printf '   branch: %s\n' "$BRANCH"
if [ "$BRANCH" != "main" ]; then
  warn "Not on main. Continuing anyway — but the deploy zip archives THIS branch."
fi

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  ok "Nothing to commit — tree already clean, using current HEAD"
  SKIP_COMMIT=1
else
  SKIP_COMMIT=0
  git status --short
fi

# ── 2. Typecheck ─────────────────────────────────────────────────────────────
say "Typecheck (tsc --noEmit)"
npm run lint
ok "Typecheck clean"

# ── 3. Tests ─────────────────────────────────────────────────────────────────
# These were green in the sandbox apart from animator_import / animator_worker,
# which failed only on a sandbox EPERM when unlinking job files. They should
# pass here on macOS. If they fail on the Mac too, that is a real regression —
# stop and investigate rather than shipping.
say "Tests"
npm test
ok "Unit tests pass"
npx tsx --test tests/contracts/*.test.mjs tests/security/*.test.mjs
ok "Contract + security tests pass"

# ── 4. Production build ──────────────────────────────────────────────────────
# Also proves dist/index.html is emitted, which is what flips server.ts into
# production mode on the host (DEPLOYMENT_NOTES.md §1).
say "Production build"
rm -f dist/.DS_Store 2>/dev/null || true   # Finder leaves these; vite's emptyDir trips on them
npm run build
test -f dist/index.html || { echo "dist/index.html missing after build"; exit 1; }
ok "dist/index.html emitted"

# ── 5. Verify the SEO fix actually made it into the bundle ───────────────────
# The whole point of this deploy. If seoMeta didn't get bundled into
# dist/server.cjs, the canonical bug ships unfixed and looks fixed.
say "Verifying SEO fix is in the built server"
if grep -q "injectMeta" dist/server.cjs; then
  ok "injectMeta present in dist/server.cjs"
else
  echo "   ❌ injectMeta NOT found in dist/server.cjs — the canonical fix would not deploy."
  exit 1
fi

# ── 6. Commit ────────────────────────────────────────────────────────────────
say "Committing"
if [ "$SKIP_COMMIT" = "1" ]; then
  ok "Skipped (nothing staged)"
else
  git add -A
  git commit -F - <<'MSG'
fix: per-route SEO canonical, shell/FurBin UX, model-card GPU crash, soft-delete

SEO (the high-value fix): every route served the same static dist/index.html,
so every page declared the homepage as its canonical. A canonical is a
directive, not a hint — the five landing pages were instructing Google to drop
them in favour of "/", overriding the sitemap that submits them. og:url had the
same problem, so every social share resolved to the homepage too.

Adds server/seoMeta.ts and rewrites the app.get('*') handler to inject
title/description/OG/Twitter/canonical per route before sending. No SSR, no
prerender service, no build change. Unknown app routes still get a
self-referential canonical rather than inheriting the homepage's.

Also:
- Randy is drag-to-reposition (src/randy/useDraggable.ts) — he sat at a fixed
  bottom-right corner and covered page controls on several screens. Position
  persists and is re-clamped on resize so it can't strand off-screen.
- Mobile bottom bar drops Profile and Marketplace (both already one tap away in
  the header) and derives its column count from MOBILE_NAV.length + 1. It was
  hard-coded to grid-cols-5 while rendering six items.
- FurBin: models moved above the fold, "Show me how" removed, storage panel
  replaced by a compact health widget with an "Add more" CTA.
- Model cards no longer mount one WebGL context per card on mobile, which blew
  past the ~8-context ceiling and took the GPU process down. Mobile renders the
  poster; the detail modal keeps a live viewer. Desktop pins the camera
  front-facing and auto-rotate now defaults off everywhere.
- Removing a model is now a soft hide (avatars.hidden_at) instead of DELETE.
  The row and the GLB survive, it stops counting against the model cap, and
  Profile gains a "Removed models" section to restore it. Hard delete stays
  available to admins via ?purge=1. The old confirm dialog promised "this can't
  be undone", which was about to become untrue.

Schema: avatars.hidden_at is added by the idempotent requiredAvatarColumns list
in db.ts at boot — no manual SQL step.

Tests: adds tests/seo_meta.test.mjs (10 assertions incl. a guard that fails if
index.html is restructured so the injection silently no-ops). Updates the two
shell contract tests that pinned the old nav shape.

Tripo/marketplace licensing decision recorded in MARKETPLACE_SELLER_SPEC.md
§3.4-3.5 (launch Personal-only) and the Stripe fee split in §4.1 (seller
absorbs, $3.00 minimum).
MSG
  ok "Committed"
fi

# ── 7. Build the deploy zip from HEAD ────────────────────────────────────────
say "Building deploy zip"
bash scripts/build-deploy-zip.sh

# ── 8. What's left, which is not automatable from here ───────────────────────
cat <<'NEXT'

────────────────────────────────────────────────────────────────────────
Ready to upload. Remaining steps are manual (DEPLOYMENT_NOTES.md §3, §9):

  1. Upload pawsome3d-deploy.zip to Hostinger.
  2. Host runs:  npm install && npm run build
     Confirm dist/index.html exists before starting — a missing dist is the
     cause of the "blank page / 500 mentioning vite" symptom.
  3. npm start (server picks up avatars.hidden_at automatically at boot).
  4. Smoke-test:
       curl -s https://pawsome3d.com/api/config          # JSON, not HTML
       open https://pawsome3d.com/                       # renders, not blank

  5. VERIFY THE CANONICAL FIX — this is the reason for the deploy:

     for p in / /pricing /3d-pet-models /custom-dog-figurines \
              /pet-memorial-models /how-it-works; do
       printf '%-26s -> ' "$p"
       curl -s "https://pawsome3d.com$p" | grep -oE 'rel="canonical" href="[^"]*"'
     done

     Each line must echo its OWN url. If they all still say
     https://pawsome3d.com/ the new server.cjs is not the one running.

  6. Google Search Console -> URL Inspection on one landing page: confirm
     "User-declared canonical" now matches the page itself. Then request
     re-indexing for the five landing pages; they've been self-excluded, so
     they won't come back on their own schedule quickly.

  7. git push origin main  (the zip is built from your local commit; the
     remote is not updated by this script)
────────────────────────────────────────────────────────────────────────
NEXT
