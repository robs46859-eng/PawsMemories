# GAME_LOOP_SPEC.md — Pawsome3D Game Layer Specification

**Status:** SPEC — authoritative design for the game layer on top of the existing pet-sim, animator, and AR stacks.
**Companions:** `ANIMATOR_SPEC.md` (runtime this drives), `AR_PET_SIM_SPEC.md` + `AR_PET_SIM_HARDENING_PLAN_V2.md` (world + safety rails), `SKILLS.md` (ANIM-* skills reused here), `FULL_FEATURE_BREAKDOWN.md` (BIM environments).
**Reference corpus:** Systems Engineering Manual for Game Loops; Engineering Life (avatar behavior); The Game Designer's Handbook; Engagement Engineering; The Soul and the Suit (physics); Cross-Platform Audio & Physics Integration Standard; Game Design Behaviors/Mechanics table.

---

## 1. Purpose, Scope & Design Pillars

Turn the AR pet simulator into a **game**: objectives, scoring, progression, minigames, physics props, HUD, and adaptive audio — composed strictly from systems that already exist (brain/needs engine, layered animation runtime, EmoteQueue, clip library, viseme engine, AR navmesh plan, BIM environments, credits/pawprint economy, per-user persistence).

**Design pillars (non-negotiable, from the reference corpus):**

1. **Reinforcement over punishment ("positivating").** Penalties are re-framed as missed bonuses, never as losses. No stat debuffs, no feedback-loop-of-failure, no progress wipes. A pet game must never make the player feel worse about their pet.
2. **Layered rewards ("sophisticated simplicity").** Layer 1 obvious objectives for casual players; Layer 2 visual mastery claims (stars); Layer 3 hidden under-par challenges for the hardcore. Depth is hidden, never demanded.
3. **Entertaining fail states.** Failure is spectacle, discovery, or comedy — physics slapstick, pet reactions, deferred callbacks — and always ends in an immediate, frictionless retry.
4. **Cooperative framing first.** The player and pet succeed *together*; household co-care and shared goals over zero-sum competition. Competitive leaderboards exist but are opt-in and per-minigame.
5. **Intrinsic motivation is protected.** Variable-ratio rewards are used, but never bolted onto already-fun actions (over-justification effect). Petting the dog is its own reward; we do not pay players to love their pet.
6. **Server-authoritative value.** Anything that grants credits, tokens, or leaderboard rank is validated server-side (GameMode principle: rules live where clients can't modify them). Aligns with hardening plan P4 (idempotency, quota, reconciliation).

**Out of scope:** multiplayer netcode (prediction/reconciliation noted as future work), aging/mortality mechanics (off by default per hardening P8), real-money mechanics beyond the existing credit store.

---

## 2. Baseline: What Already Exists (build on, never duplicate)

| Game subsystem | Existing implementation |
|---|---|
| Character controller | Layered mixer L0–L3, blend tree, EmoteQueue, IK/foot-lock, spring bones (ANIMATOR_SPEC §6) |
| NPC AI | `src/brain/` needs/behavior engine (31 tests), `BehaviorAction` set, commands, buttons, trainer score |
| Dialogue | Lip-sync Tiers A/B/C + TTS (ANIMATOR_SPEC §5) |
| World | AR planes/mesh/occlusion/navmesh (hardening P5A), BIM environments + prefabs, animator scenes/environments |
| Spatial truth | `ModelSpatialMetadata`, meters everywhere, measurement utils |
| Economy | Credits, pawprint tokens, referral economy, Stripe packs |
| Persistence | Pet state, avatars, placed objects, per-user DB (`db.ts`), storage tiers |
| Audio DSP | `src/animator/audio/dsp.ts` (envelope, onsets, mel), `audioMux.ts`, sound in `src/animator/scenes/sound` |
| Capture | Recording/encoder (share your high score clip) |

---

## 3. Module GAME-CORE — Loop, Time & Orchestration

### 3.1 Loop architecture
- **Hybrid fixed-step accumulator loop**, decoupled from rendering (R3F's `useFrame` renders as fast as the GPU allows; simulation ticks at a fixed step).
  - `SIM_DT = 1/50` s (50 Hz). Accumulate real elapsed time; run `simTick(SIM_DT)` until the accumulator is drained; clamp accumulator at `5 × SIM_DT` (spiral-of-death guard — drop time, never freeze).
  - **Render interpolation:** visual transforms of sim-driven objects interpolate between previous and current sim states using `accumulator / SIM_DT` as the weight. No jitter, no stutter.
  - Physics (GAME-PHYS), game timers, combo windows, and score accrual live in sim ticks. Input sampling, camera, UI live in render frames. Procedural animation (L3) stays render-side as today.
- **Frame-rate clamping** on battery-sensitive targets (AR): cap render FPS and sleep the remainder (hardening P5 thermal budgets).

### 3.2 Pattern commitments (from the design-pattern catalog)
| Pattern | Use here |
|---|---|
| **Game Loop / Update Method** | `GameDirector.simTick()` fans out to registered updatables |
| **State** | `GameDirector` FSM: `freeplay → minigame(id) → paused → results`; minigames are **secondary state machines** nested inside it (§7) |
| **Command** | Player inputs (tap, throw, command word) become `GameCommand` objects — replayable, testable, remappable |
| **Observer / Event Queue** | `GameEventBus`: sim emits typed events (`prop:collision`, `score:combo`, `objective:complete`, `fail:slapstick`); HUD, audio, EmoteQueue, and reward engine subscribe. Events are queued and drained once per render frame (serialization + decoupling) |
| **Component** | Props are entities with composable behaviors (physics body, grabbable, chewable, scoring-target) |
| **Object Pool** | Pooled props/particles/score-popups — no allocation spikes in AR sessions (P5 memory gate) |
| **Dirty Flag** | Needs/stat HUD widgets re-render only on change events |
| **Spatial Partition** | Simple uniform grid over the play area for prop↔pet↔target proximity queries (AR rooms are small; a 0.5 m cell grid suffices) |
| **Service Locator** | `game/services.ts` — audio, physics, save, telemetry behind interfaces so the web and future Unity tiers share contracts |

### 3.3 Files
`src/game/` (new): `director.ts`, `loop.ts`, `events.ts`, `commands.ts`, `services.ts`. The director mounts inside the existing pet scene (`PetScene.tsx`) and AR stage without replacing them — freeplay state is a passthrough to today's behavior.

---

## 4. Module GAME-PHYS — Props & Reactive Physics

The pet needs things to play *with*. Physics follows the **Rigid Body ("soul") + Shape ("suit")** model.

### 4.1 Engine & tiers
- **Web:** `@dimforge/rapier3d-compat` (WASM), **lazy-chunked** (ANIM-CORE-00 bundle discipline) and loaded only when a physics minigame starts. Fallback tier: dependency-free ballistic integrator (gravity + restitution vs. ground plane) for devices where WASM fails — Fetch still works, degraded.
- **Native (later):** Unity PhysX under the same data contracts (deterministic-enough; exact parity not required cross-tier).

### 4.2 Body & shape rules (from the physics references — enforced by code review + tests)
- **Primitives only** for gameplay props (sphere = ball, box = crate/treat, capsule = bone/stick). Trimeshes are forbidden for dynamic props; the AR environment mesh participates as **static** collision geometry (and static geometry carries no rigid body — solver optimization).
- Motion control: props are **Dynamic**; floor/walls/BIM elements **Static**; the pet is **Kinematic** (animation/navmesh-driven — it influences props but is never shoved by them; absolute control over avatar precision).
- **Transform target "Root"** for single-body props; **never** more than one root-driving body per entity (multi-body = "Self", per the multiple-rigid-body rule).
- **Mass set manually per prop** (auto-mass off for interactive actors): ball 0.15 kg, bone 0.3 kg, crate 2 kg. Realistic mass prevents "floaty" props.
- **Materials:** friction/restitution pairs per prop (`ball: μ0.4 e0.75`, `bone: μ0.6 e0.2`, floor from semantic surface class when AR provides it — carpet vs hardwood changes roll and bounce *and* audio §9).
- **CCD enabled on thrown props** (anti-tunneling through thin AR mesh); **linear/angular drag** for air resistance; **sleep** resting bodies; interpolate kinematic targets.
- **Collision groups:** pet-self group never collides with itself (no exploding physics); prop↔prop, prop↔world, prop↔petMouth (trigger) groups explicit.
- **Trigger volumes** (`isTrigger`) for scoring zones, pet mouth "catch" sphere, and audio snapshot zones.

### 4.3 Prop interactions with existing systems
- Pet "grabs" a prop: prop switches Dynamic → Kinematic and parents to the `jaw` bone (the rigid-attachment machinery from ANIM-RIG-03 reused at runtime).
- Throw: player drag-gesture → `GameCommand{type:"throw", impulse}` → impulse applied at release; arc previewed with the ballistic integrator (cheap, deterministic).
- Prop collisions emit `prop:collision {materialA, materialB, impulse}` events → audio + score + EmoteQueue reactions.
- **Dynamic reset rule:** on scene transitions/teleports, zero velocities and re-pose (prevents spawn flailing).

---

## 5. Module GAME-STAT — Stats, Progression & Pacing Math

### 5.1 Data-driven stats (ScriptableObject principle, web-shaped)
- **Base definitions** are versioned JSON data containers (`src/game/data/stats/*.json`, zod-validated), never code: species base stats, growth curves, ability definitions. **Instance state** (current values, buffs) lives in the pet's DB row / runtime store. Base data is read-shared; instances never write to it.
- Pet stats (all bounded 0–100, complementing existing needs): `agility`, `smarts`, `bond`, `showmanship`. Stats grow from *doing* (agility course raises agility) — hybrid progression: XP + skill-use + item.
- **Character-bound XP:** progression attaches to each pet, not a global account level — investment in *this* pet, supporting multi-pet households.

### 5.2 XP & level curves (choose per track, all implemented in one `progression.ts`)
- Linear: `xpNext(L) = a·L + b` — used for early tutorial levels only (predictable, fast).
- **Exponential (primary):** `xpTotal(L) = base · (L^1.8)`, `xpNext(L) = xpTotal(L+1) − xpTotal(L)` — accessible early milestones, dedication later.
- Sigmoid: `xpNext(L) = max / (1 + e^(−k(L−L₀)))` — used for `bond` (mirrors real relationship curves: fast early attachment, plateau at devotion).
- Logarithmic clamp on any stat-derived power: `effect(L) = c · ln(L+1)` — no late-game power creep; a level-40 pet is more *expressive*, not 40× better, keeping minigames skill-based.
- Curves are data (`{track, type, params}`), graphable in a debug panel, and tuned without code changes.

### 5.3 Trainer score upgrade
The existing single `trainerScore` becomes the **account-level meta track** feeding the layered reward system (§6): it aggregates per-pet milestones but grants only recognition assets + cosmetic unlocks (never gameplay power — fair-play principle).

---

## 6. Module GAME-REWARD — Scoring, Bonuses & the Layered Reward Ecosystem

### 6.1 Scoring rules (the five essentials, enforced as review criteria)
1. **Simple:** every minigame scores on at most 3 visible components (base + combo + time bonus).
2. **Linked to outcomes:** score reflects skill/care mastery, never luck alone; random drops are *rewards*, never *score*.
3. **Transparent:** the results screen itemizes every component; the HUD shows the live formula state (combo counter, timer).
4. **Varied & precise:** speed, precision, and efficiency are separate metrics; time recorded to 0.1 s.
5. **Minimized negative emphasis:** results screens lead with what was earned; misses appear as unfilled bonuses, not red ✗ lists.

### 6.2 Score math (implemented once in `scoring.ts`, data-parameterized per minigame)
- **Base scoring:** per successful action `score += basePoints × multiplier`.
- **Combo multiplier:** consecutive successes within a `comboWindowSec` (default 4 s) increment `multiplier` (+0.5, cap ×5). A miss or window expiry resets to ×1 — risk/reward tension without punishment (nothing is subtracted).
- **Exponential time bonus (leaderboard differentiator):** `bonus = maxBonus · e^(−k·(t − parTime))` for `t ≥ parTime`, clamped to `maxBonus` under par; 0.1 s precision guarantees elite-tier separation (no stagnant ties).
- **Positivated bonuses:** `No-Hint Bonus`, `First-Try Bonus`, `Flawless Bonus` — the inversion of penalties. Using a hint costs nothing; not using one pays.
- **Variable-ratio drop table:** after objective completion, a seeded roll on a rarity table (common treat → rare accessory → very rare pattern unlock). Applies **only** to completion events, at most every-other completion on average — reinforcement without slot-machine pacing; no purchasable rolls.

### 6.3 The three layers, mapped to concrete mechanics
| Layer | Mechanic | Reward class |
|---|---|---|
| **1 — Obvious objective** | Complete the minigame / daily care goals | Completion praise + XP + stage unlock (Praise, Completion) |
| **2 — Explicit mastery** | 1–3 **stars** per minigame level (score thresholds); unfilled stars are the visible "claim" pulling replays | Stars, badges, pawprint tokens (Resources, Recognition) |
| **3 — Hidden depth** | **Under-par discoveries** (beat the hidden dev time), flawless-combo runs, secret objectives ("fetch over the couch"), *unachievements* (absurd feats: "bury 10 toys") | Unique cosmetics (collar skins, particle trails — rigid attachments from ANIM-RIG-03), leaderboard entry, "Fiero" (Spectacle, Powers-as-expression) |

- **Reward taxonomy coverage check:** every minigame must emit at least Praise (instant feedback flash + audio), one Resource path, and one Prolonged-Play unlock; Spectacle on personal bests (confetti + pet `celebrate`/`play-bow` via EmoteQueue).
- **Deferred consequences:** notable moments write to the brain's memory ("remembers you threw the ball onto the roof") and surface later as dialogue/emotes — actions never feel pointless.
- **Cosmetics never alter gameplay balance.** Ever.

### 6.4 Reward engine
`rewards.ts`: pure function `(ScoreResult, PlayerContext) → RewardGrant[]`, unit-testable; grants applied **server-side** (§11). Drop tables are versioned JSON data.

---

## 7. Module GAME-MINI — Minigame Framework & Roster

### 7.1 Framework (secondary state machine)
- Each minigame is a self-contained FSM (`intro → active → success|fail → results`) mounted by the `GameDirector`; it **cannot write to global state directly** — it returns a `ScoreResult` and emits events. This sandbox prevents balance leaks.
- **MinigameManifest v1** (zod): `{ id, version, kind: "ingame"|"outgame", systems: [...], parTime, scoreParams, starThresholds[3], underPar?, rewards, unlockRequirement }` — data-first so tuning never touches code.
- Design rules: minigames are **optional** (freeplay is never gated on them); rewards capped at aesthetics + incremental stat XP; each is polished to main-game standard or cut; "gimmick levels" (recontexted core mechanics) preferred over novel mechanics.

### 7.2 Roster v1 (each entry: objective / systems reused / win / fail / scoring)
1. **Fetch** *(ingame — the vertical slice)*. Throw the ball; pet retrieves. Systems: GAME-PHYS throw + CCD, navmesh chase, `run`/`play`/`interact` clips, jaw-grab, EmoteQueue celebration. Win: N retrievals before the fun-meter timer. Fail: spectacle only (ball behind the couch → pet's confused `head_tilt` + digging = comedy, retry instantly). Scoring: base per catch, combo for consecutive clean catches, distance multiplier, exponential time bonus. Stars + hidden "trick-shot" under-par (bounce off a wall first).
2. **Agility Course** *(ingame)*. Guide the pet through AR waypoint gates (spatial UI rings on the navmesh). Systems: navmesh, blend-space locomotion, phase-marker foot-work, BIM/placed-object obstacles. Scoring: gate streak combo + time bonus; fail = knocked-over prop physics slapstick, gate re-arms.
3. **Training Trials** *(ingame)*. Simon-says command recall using the existing command/button system. Scoring: precision (correct command) + response-time bonus; raises `smarts`; wrong command → pet does something *deliberately absurd* from the emote pool (entertaining fail, Duck-Game randomness).
4. **Hide & Seek** *(ingame, AR-gated)*. Pet hides using occlusion/anchors; player finds it. Systems: AR meshing/occlusion, spatial audio bark hints (§9), persistence anchors. Scoring: time-based, hint-forgoing bonus.
5. **Show Time** *(ingame, creator-loop)*. Stage a routine in the Animator sequencer (clips + viseme lines + camera), "perform" it; judged on variety/sync heuristics; exports a share clip via the capture module. Raises `showmanship`; the bridge between the game and the studio product.
6. **Bubble Pop** *(outgame palate cleanser)*. Tap floating bubbles; pet swats along (`play` overlay on L1). Pure dexterity, no pet stats — cognitive rest, small token drip.

Roster is data-extensible; new manifests + a scene component = new minigame.

### 7.3 Difficulty
**DDA-lite:** par times and gate spacing adjust ±15% from a rolling window of the player's last 5 results (accessibility, flow maintenance); never adjusts mid-run; hidden Layer-3 thresholds are **fixed** (fair leaderboards).

---

## 8. Module GAME-HUD — Interface

- **Taxonomy discipline:** *Diegetic* — pet's collar tag shows level; props show wear. *Spatial* — AR waypoint rings, throw-arc preview, floating score popups at the event location. *Non-diegetic* — top bar (needs, score, combo meter, timer), results screens. *Meta* — full-screen flourishes (confetti vignette on personal best).
- Web implementation: existing React/Tailwind (our USS-equivalent); design tokens shared with TerraPaw system; reference layout 390×844 portrait scaling fluidly (AR is phone-first); transitions/hover states in CSS, never in game logic.
- **Results screen = the transparency contract:** itemized base/combo/time-bonus/positivated bonuses, three stars with unfilled claims, "a faster time exists…" hint line once Layer 3 is discovered, one-tap **retry** (the compulsion loop) and **share** (capture clip).
- Pop-up modals (pause, settings incl. remaps/haptics/audio sliders) via the State pattern (`paused` freezes sim ticks, render continues).
- Score/combo widgets subscribe to the EventBus with dirty-flag re-render only.

---

## 9. Module GAME-AUD — Adaptive Audio

- **Architecture:** one `AudioDirector` service (Service Locator) wrapping WebAudio; sounds grouped into **banks** (`ambience`, `sfx`, `ui`, `music`) with independent volume buses and lazy loading per bank — FMOD's bank discipline without the middleware. Native tier maps the same event names onto FMOD later (per the cross-platform standard).
- **Event-driven:** the audio system is a pure EventBus subscriber; game code never plays sounds directly.
- **Vertical layering:** music stems (matching tempo/key) fade by game state — needs-critical stem when the pet is neglected, tension stem when the timer < 10 s, triumph stem on combo ≥ ×3.
- **Horizontal resequencing** on director state changes (freeplay ↔ minigame ↔ results) with bar-aligned transitions.
- **Spatial:** three.js `PositionalAudio` for pet vocalizations and prop impacts; distance attenuation + occlusion-informed low-pass when AR mesh data exists (Hide & Seek's core mechanic).
- **Surface-material foley:** footstep/impact variants selected by semantic surface class (carpet/hardwood/grass) with ±2 semitone pitch randomization + round-robin per material — no repetition fatigue.
- **Feedback matrix (from the integration standard):** standard collision → material SFX; high-risk success → spectacle SFX + achievement sting; **fail state → abrupt music cut + one-shot comedic sting** (the "jarring return to reality"); under-par discovery → exclusive audio layer nobody else hears (Layer-3 Fiero).
- **Reward audio:** every RewardGrant class has a distinct, brief sting; praise sounds within 100 ms of the triggering event (immediacy rule).
- Mix discipline: −1 dB ceiling, sidechain duck ambience under stings; all assets normalized on import.

---

## 10. Module GAME-FAIL — Failure Engineering

- **Tier policy:** only Tier 1 (time) and soft Tier 2 (repeat a section) failures exist. Tier 3 (resource loss) and Tier 4 (reset) are **banned** — nothing the player owns is ever taken. No health/damage/death mechanics (pet wellbeing ≠ HP; aging/mortality stays off per hardening P8).
- **Anti-pattern guard:** no failure may make the next attempt harder (no debuffs, no consumed items) — the feedback-loop-of-failure is a blocked design, enforced in minigame manifest review.
- **Entertaining failure toolkit** (every minigame picks ≥ 2):
  - *Slapstick physics:* exaggerated spring-bone wobble + prop tumbles (Gang-Beasts principle, scaled to "cute").
  - *Purposeful randomness:* the pet's fail reaction is drawn from a rotating emote pool — failure looks different every time (Duck Game).
  - *Discovery:* fails reveal information (the agility gate that got clipped glows on retry — Dark Souls' teaching death, gentled).
  - *Deceptive simplicity:* Layer-3 challenges are Flappy-Bird-simple to state, hard to master — the "one more time" compulsion.
  - *Narrative acknowledgment:* the brain memory writes a callback line (Frog-in-the-well "remembers" rule).
- **Retry ergonomics:** results-to-retry in one tap, < 1.5 s, checkpoint immediately before the challenge (Tier-1 mitigations).
- **Cooperative fail framing:** copy always shares the outcome — "you two almost had it!" — never "you failed."

---

## 11. Module GAME-SAVE — Persistence, Authority & Anti-Cheat

- **State split (GameMode/GameState/GameInstance principle):**
  - *Rules & grants* — server-only (`server/game/`): score validation, reward issuance, leaderboards. Clients propose, servers dispose.
  - *Shared progress* — DB: new tables `game_progress` (per pet: stats, XP, level per track), `minigame_results` (best scores, stars, under-par flags), `reward_grants` (idempotent ledger), `leaderboards` (per minigame per level — multi-tier design prevents global score inflation).
  - *Session state* — client-side only (current run, combo, timers); losing it loses nothing durable.
- **Server validation:** `POST /api/game/results` carries the full `ScoreResult` + event summary; server recomputes score from the summary against the manifest's parameters, rejects physically implausible values (time < authored minimum, combo > event count), and applies rewards **idempotently** (client-generated `runId` key — hardening P4 pattern). Credits/token grants ride the existing ledger.
- **Zod contracts (versioned, §12 discipline):** `StatDefinition`, `ProgressionCurve`, `MinigameManifest`, `GameCommand`, `ScoreEvent`, `ScoreResult`, `RewardGrant`, `LeaderboardEntry`.
- Offline/degraded: results queue locally and reconcile on reconnect; leaderboard submission is best-effort, personal progress is not.

---

## 12. Social Layer (v1-lite)

- **Cooperative first:** household co-care goals (shared daily objectives across accounts linked to one pet — win/lose together), gift sends (tokens → treats).
- **Leaderboards:** per-minigame **and per-level** (skill-focused, inflation-resistant), friends-scope by default, global opt-in; exponential time bonuses guarantee tie-free elite rankings.
- **Achievements:** completion set (Layer 1), mastery set (Layer 2), discovery set (Layer 3, including unachievements). Badge assets render on the profile and as collar charms (diegetic recognition).
- Share loop: capture module exports the personal-best clip with score overlay.

---

## 13. Phased Implementation (no timelines; each phase ships playable)

**G0 — Rails.** `src/game/` skeleton: fixed-step loop + interpolation, EventBus, Command layer, Director FSM (freeplay passthrough), all zod contracts, `server/game/` stub routes (empty-shape reads per ANIM-CORE-00), DB tables. *Exit:* loop ticks at 50 Hz under a 20 FPS render without drift (node:test with fake clocks); freeplay unchanged.

**G1 — Value.** Stats/progression (curves + data containers), scoring engine (combo, exponential time bonus, positivated bonuses), reward engine + drop tables, server validation + idempotent grants. *Exit:* full unit coverage of every formula; replayed `runId` grants exactly once; curves render in a debug panel.

**G2 — Play (vertical slice).** GAME-PHYS (rapier lazy-chunk + fallback integrator, prop set, materials, groups) + **Fetch** end-to-end with HUD score widgets and results screen. *Exit:* Fetch is fun on a mid-range phone; thrown ball never tunnels; bundle adds no eager chunks; results validate server-side.

**G3 — Feel.** AudioDirector (banks, vertical layers, spatial, surface foley, feedback matrix), full HUD (stars, itemized results, retry loop), entertaining-fail toolkit wired to EmoteQueue + brain memory. *Exit:* audio latency < 100 ms on praise events; fail states produce visibly varied reactions across 10 consecutive fails.

**G4 — Depth.** Minigame roster (Agility, Training Trials, Bubble Pop; Hide & Seek behind AR capability gate; Show Time behind animator flag), star thresholds + under-par layer + unachievements, DDA-lite. *Exit:* every manifest passes the design-rule linter (optional, reward-capped, ≥ 2 fail-toolkit entries, ≤ 3 score components); a hidden under-par is discoverable in Fetch.

**G5 — Together.** Leaderboards (per-level, friends default), achievements, household co-care goals, share clips. *Exit:* two-user isolation tests pass (hardening P1/P3 patterns); leaderboard writes only via validated results.

**G6 — Everywhere.** AR-tier integration polish (navmesh gates, occlusion Hide & Seek, semantic foley) and the contract freeze that lets the Unity native tier implement the same manifests. *Exit:* same MinigameManifest drives web and (stubbed) native; device matrix from hardening P5 passes with the game layer active.

---

## 14. Verification & QA

- **Determinism:** sim tick with seeded RNG replays a recorded command stream to identical `ScoreResult` (node:test) — the anti-cheat recompute depends on this.
- **Formula suite:** golden tests for every curve/bonus at boundary values (level 1/max, t = par, combo cap).
- **Design-rule linter:** CI check over MinigameManifests (§13 G4 rules + banned-tier guard).
- **Physics gates:** tunneling test (200 throws at max impulse through thinnest BIM wall = 0 passes), sleep test (props sleep < 2 s after rest), pool test (0 allocations during a 60 s Fetch run).
- **Server gates:** implausible-result corpus rejected; idempotency replay; grant-ledger reconciliation.
- **Experience gates (manual, per release):** the "one more time" test — 5 testers, does anyone retry Fetch unprompted ≥ 3×; the "sting" test — no tester reports feeling punished by any failure.
- Ground rules inherited wholesale: ANIM-CORE-00 (tsc, node:test, lazy chunks, graceful degradation, zod versioning).

---

## 15. SKILLS.md Extension (register these as GAME-*)

| Skill_ID | Covers |
|---|---|
| GAME-CORE-01 | Fixed-step loop, interpolation, director FSM, EventBus/Command |
| GAME-PHYS-01 | Soul/suit prop physics, motion-control + transform-target + collision-group rules |
| GAME-STAT-01 | Data-driven stats, curve library, character-bound XP |
| GAME-REWARD-01 | Scoring math, layered rewards, positivated bonuses, drop tables |
| GAME-MINI-01 | Minigame FSM sandbox, manifest schema, design-rule linter |
| GAME-HUD-01 | UI taxonomy, results transparency, retry ergonomics |
| GAME-AUD-01 | Banked adaptive audio, feedback matrix, surface foley |
| GAME-FAIL-01 | Failure tiers policy, entertaining-fail toolkit |
| GAME-SAVE-01 | Server authority, idempotent grants, leaderboards |

Personas: **Gameplay Engineer** (CORE/PHYS/MINI), **Economy Designer** (STAT/REWARD/SAVE — constraint: no cosmetic may alter balance; no Tier 3/4 failure), **Experience Engineer** (HUD/AUD/FAIL — constraint: praise-feedback ≤ 100 ms, retry ≤ 1 tap).
