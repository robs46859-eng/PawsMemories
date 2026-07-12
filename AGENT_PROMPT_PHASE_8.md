# Agent Prompt — Phase 8 (Final Production)

You are working in the **PawsMemories / Pawsome3D** repo (branch `main`, deployed on Hostinger). Read `PHASE8_FINAL_PRODUCTION_SPEC.md` at the repo root — it is the authoritative spec. Implement all of it, top to bottom. Each section has exact file paths, endpoints, and acceptance criteria.

## Rules
- `npx tsc --noEmit` must pass before every commit (a pre-commit hook enforces it). Run `npx vite build` too before finishing.
- When you add a file that another file imports, **stage both in the same commit** — `git status` before committing to catch untracked companions. (A prior phase broke the build by committing an import without its new module.)
- All new credit/token grants go through the existing server-authoritative functions only — `addCredits` / `refundCredits` / `restoreReservedGenerationCredits` and a new `grantPawprintTokens`. Amounts are fixed server constants, never client- or AI-supplied (Phase 7 §7.8 firewall still binds).
- Don't break the `DEPLOY_TARGET` main/warehouse split or the Screen-enum nav wiring; add new screens to the enum, both nav lists, and the two auth `includes([...])` guards.

## Build order (each its own commit; tsc between)
1. **`server/mail.ts`** transport (Resend/SES/SMTP) + **Help button** → emails rob@stelar.host. *(BLOCKER — several features need email; do first.)*
2. **Storage tiers** — 50 MB hot on pawsome3d.com, overflow to mypets.cc, 1 GB = 4 cr; `/api/storage/*` + usage meter.
3. **Profile editor** — fields, past purchases, credit + pawprint balances, storage meter, legal links; **100-cr profile-completion bonus** (email + verified phone + ZIP, once).
4. **Referral + share economy** — referral code/link (30 cr + 1 pawprint per referred completed signup); share to X/Meta/Snap/BlueSky/TikTok (12 cr or 1 pawprint, once per network); pawprint-token primitives.
5. **Rename Models tab → `Furball3D©️`** (label change; keep route stable).
6. **Pawprints tab** — 9 categories × 4 layouts, file-type-gated fields, AI text from a curated reference DB + AI image; 1 pawprint token per creation.
7. **Pawlisher tab** — big model viewer/editor (Edison-bulb light 3 settings, magnifier+% / pinch zoom, 360° turntable, rigging, body-part + posture/gait libraries, voice clone + lip-sync + **multi-voice picker §8c**, voice speed/pitch/tone, micro-mesh, locked Wardrobe, ✂️/💾/⬆️/🗑️ tools); hub cards (Wardrobe locked, Animation Creator, Pawprints).
8. **Fur Bin©️ tab** — storage/asset manager grouped by usage, incl. voice-clone files.

Final: full `vite build`, run migrations, prod smoke test (load `/legal/privacy` etc. still work).

## Legal / consent (already partly built)
- The `/legal/privacy`, `/legal/terms`, `/legal/sms` pages already exist (`server/legal.ts`). Link them from Profile + footer, record `accepted_terms_version` at signup, and gate voice-clone behind the consent checkbox (§3, §8).

## Defaults already decided (§15 — don't re-ask)
- Furball3D = the **Models** tab. Signup bonus = **single 100 cr on completion**. Pawprint = **1 token per stationery**. Share reward = **once per network per user lifetime**. Cold-storage offload = **auto-LRU** on hot-full. Voice picker defaults to the env voice when none chosen.
- **Email = Resend** (`server/mail.ts`, `RESEND_API_KEY` + `MAIL_FROM`; verify the sending domain). **Phone OTP = Telnyx Verify** (reuse `TELNYX_API_KEY` + new `TELNYX_VERIFY_PROFILE_ID`). No open blockers — implement directly.

Confirm the spec is readable, then implement. Ask before deviating from the §7.8 credit firewall or the §15 decisions.
