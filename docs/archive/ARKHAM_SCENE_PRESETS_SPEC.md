# Arkham Prison — 5 Animator Scene Presets (Spec)

**For:** Pawsome3D Animator / Scene generator (`server/animator/environments/*.json`, `GET /api/scenes/environments`, `POST /api/scenes/backgrounds`).
**Prepared:** July 10, 2026

This spec turns your attached art (3 rendered rooms + 5 blueprint sheets) into **5 reusable environment presets** your pet avatars can be dropped into and animated. Each entry says exactly how to produce the background asset, whether you need AI image gen, and gives **drop-in preset JSON** matching your existing schema.

---

## How backgrounds actually work in your code (read once)

Your environment preset schema (`environments.ts`) is:

```
id, tier(basic|generic|hdri), label,
backdrop{ kind(hdri|dome360|image|glb-scene|procedural), url? },
ground{ color? }, allowedWeather[clear|rain|snow|fog|overcast],
ambientSound?, defaultTimeOfDay(morning|afternoon|evening|night),
cameraStart?, license(CC0|owned|generated), source, sourceUrl?
```

Two ways a background reaches the scene:

| Path | Route | Best for | Lights the pet? | 360°? |
|---|---|---|---|---|
| **Flat billboard** (`kind:"image"`) or ad-hoc upload | preset JSON, or `POST /api/scenes/backgrounds` `type:"upload"` | Your rendered rooms | ❌ No — you set interior lights | ❌ No |
| **HDRI / dome360** (`kind:"hdri"`) | preset JSON | Real image-based lighting + reflections | ✅ Yes | ✅ Yes |
| **Prompt-generated** | `POST /api/scenes/backgrounds` `type:"prompt"` → Gemini/Imagen | Rooms you only have as blueprints | (produces a flat image → billboard) | ❌ No |

**Consequence for your assets:**
- The 3 rendered rooms are flat perspective images → `kind:"image"` billboards. They will **not** light your pet, so each preset below fixes `defaultTimeOfDay` and you should use indoor lighting. They also won't have camera parallax — keep the animator camera roughly at the render's eye level (all 3 of yours are eye-level, floor-level shots, which is ideal).
- The blueprints can't be backdrops. Use them as **reference** in a prompt to generate the room render.

**Asset prep for the 3 renders (do this once each):**
1. Crop to ~16:9, export ~2048px wide JPG (billboards read best wide; your sources are 4:3 — crop or pad).
2. Place the file so it serves at `/animator-files/environments/<file>.jpg` (same location as the Poly Haven set), and mirror to B2 via `uploadBase64Image` like the import script does.
3. Drop the JSON below into `server/animator/environments/`. It's zod-validated at boot.

---

## The 5 presets

### 1 — Security Operations Center  🖥️  *(uses attached render #1, ready now)*

- **Source asset:** your Arkham SOC render (banks of cracked CCTV monitors, blast door, grated floor).
- **Make it:** **no AI needed.** Crop 16:9 → `soc_arkham.jpg` → register. `kind:"image"`.
- **Mood:** cold blue-grey, dead monitors, one warm ceiling panel. Indoor, night feel, no weather.
- **Best pet actions:** idle/alert, head-tilt, patrol walk across the grating.

```json
{
  "id": "arkham-security-ops",
  "tier": "generic",
  "label": "Security Ops Center",
  "backdrop": { "kind": "image", "url": "/animator-files/environments/soc_arkham.jpg" },
  "ground": { "color": "#3a3f42" },
  "allowedWeather": ["clear"],
  "defaultTimeOfDay": "night",
  "license": "owned",
  "source": "Arkham Prison concept render (owned)"
}
```

### 2 — Prison Gymnasium  🏀  *(uses attached render #2, ready now)*

- **Source asset:** your green-lit gymnasium (basketball racks, cracked court, benches, riveted steel walls).
- **Make it:** **no AI needed.** Crop 16:9 → `gym_arkham.jpg` → register. `kind:"image"`.
- **Mood:** teal/green fluorescents + warm patches, big open floor — the most "playroom" of the set.
- **Best pet actions:** run, play/pounce, fetch, tail_wave — the open court suits energetic clips.

```json
{
  "id": "arkham-gymnasium",
  "tier": "generic",
  "label": "Prison Gymnasium",
  "backdrop": { "kind": "image", "url": "/animator-files/environments/gym_arkham.jpg" },
  "ground": { "color": "#4a5550" },
  "allowedWeather": ["clear"],
  "defaultTimeOfDay": "afternoon",
  "license": "owned",
  "source": "Arkham Prison concept render (owned)"
}
```

### 3 — Abandoned Infirmary  🏥  *(uses attached render #3, ready now)*

- **Source asset:** your medical wing (rotted beds, x-ray monitor, green haze, cobblestone floor).
- **Make it:** **no AI needed.** Crop 16:9 → `infirmary_arkham.jpg` → register. `kind:"image"`.
- **Mood:** eerie green, horror-leaning. Great for a spooky/Halloween scene template.
- **Best pet actions:** slow walk, cautious idle, ear-twitch; pair with fog SFX for atmosphere.

```json
{
  "id": "arkham-infirmary",
  "tier": "generic",
  "label": "Abandoned Infirmary",
  "backdrop": { "kind": "image", "url": "/animator-files/environments/infirmary_arkham.jpg" },
  "ground": { "color": "#2f3a34" },
  "allowedWeather": ["clear", "fog"],
  "defaultTimeOfDay": "night",
  "license": "owned",
  "source": "Arkham Prison concept render (owned)"
}
```

> Note: `allowedWeather` includes `fog` for mood, but since this is an indoor billboard the fog is a scene volumetric on the pet's side of the glass — subtle, not weather on the backdrop. Keep it light.

### 4 — Cell Block  🔒  *(from the blueprints — needs one AI generation)*

- **Source asset:** none rendered yet. You have it only as the "CELL BLOCK UPPER/LOWER LEVEL" plans + the "CELL (TOP LEVEL) PLAN 1:50".
- **Make it:** **AI gen required.** Use the `type:"prompt"` path (UI: background = *Generate from prompt*), or generate offline and register as `kind:"image"`. Prompt below.
- **Mood:** long corridor of barred cells, hard shadows, single perspective vanishing point down the row.
- **Best pet actions:** walk down the block, sit, look-up-at-camera.

**Ready-to-use generation prompt:**
> *"Interior of a decaying gothic prison cell block, long central corridor receding to a vanishing point, rows of barred iron cell doors on both sides, riveted steel and cracked plaster walls, wet stone floor with a central drainage channel, dim overhead cage lights casting hard shadows, cold desaturated palette with one warm bulb, eye-level camera at floor height, empty, no people, cinematic concept-art render, 16:9."*

```json
{
  "id": "arkham-cell-block",
  "tier": "generic",
  "label": "Cell Block",
  "backdrop": { "kind": "image", "url": "/animator-files/environments/cellblock_arkham.jpg" },
  "ground": { "color": "#3b3a37" },
  "allowedWeather": ["clear"],
  "defaultTimeOfDay": "night",
  "license": "generated",
  "source": "Gemini/Imagen from Arkham blueprint reference"
}
```

### 5 — Prison Yard (Exterior on the Rock)  🌉  *(from blueprints — best as a real HDRI, or AI dome)*

- **Source asset:** the site plan + "WEST ELEVATION" (the prison on a rock island, four yards).
- **Make it:** two options —
  - **(a) Best quality:** grab a **CC0 outdoor HDRI** (Poly Haven, like your existing set) for a *courtyard/overcast* sky so the pet is **actually lit** by the environment and casts correct shadows. `kind:"hdri"`, `license:"CC0"`.
  - **(b) Stylized match:** AI-generate a walled yard render from the blueprint and use `kind:"image"` (`license:"generated"`). Won't light the pet, but matches your art style.
- **Mood:** open exterior, high stone walls, guard towers, moody sky — the only preset that should allow real weather.
- **Best pet actions:** run, play, roll, weather interaction (rain/snow particles land on the ground plane).

**Option (a) — HDRI (recommended, real lighting + weather):**
```json
{
  "id": "arkham-prison-yard",
  "tier": "hdri",
  "label": "Prison Yard",
  "backdrop": { "kind": "hdri", "url": "/animator-files/environments/<courtyard_overcast>.jpg" },
  "allowedWeather": ["clear", "overcast", "fog", "rain", "snow"],
  "defaultTimeOfDay": "evening",
  "license": "CC0",
  "source": "Poly Haven",
  "sourceUrl": "https://polyhaven.com/hdris/outdoor"
}
```

**Option (b) — AI billboard prompt:**
> *"Exterior prison exercise yard at dusk, tall weathered stone perimeter walls topped with razor wire, two stone guard towers, cracked concrete ground with faded painted lines, overcast stormy sky, distant gothic prison silhouette on a rocky island, cold blue-grey palette, eye-level wide shot, empty, cinematic concept-art render, 16:9."*

### 6 — Approach Road, Angel Island  🛣️  *(uses attached road render, ready now)*

- **Source asset:** your establishing render — cracked two-lane road across a drained San Francisco Bay seabed leading to the gothic prison on Angel Island, wrecked sailboats, dead trees, stormy overcast sky. This is the **exterior arrival / establishing shot** that matches the blueprint site plan (the "cracked asphalt road" + "dry seabed" callouts).
- **Make it:** **no AI needed.** Crop 16:9 (it's already ~16:9) → `approach_road_arkham.jpg` → register. `kind:"image"`.
- **Mood:** bleak, wide, cinematic depth — strong central vanishing point straight down the road to the prison. The only *exterior* billboard, so it can carry real weather particles on the pet's ground plane.
- **Best pet actions:** walk/run toward camera down the road, sit-and-look-back at the prison, weather interaction (rain/fog). Great as the opening shot of a scene sequence before cutting to an interior preset.

```json
{
  "id": "arkham-approach-road",
  "tier": "generic",
  "label": "Approach Road (Angel Island)",
  "backdrop": { "kind": "image", "url": "/animator-files/environments/approach_road_arkham.jpg" },
  "ground": { "color": "#4b4a45" },
  "allowedWeather": ["clear", "overcast", "fog", "rain"],
  "defaultTimeOfDay": "evening",
  "license": "owned",
  "source": "Arkham Prison approach render — Angel Island, San Francisco Bay (owned)"
}
```

> Note: this is a flat billboard, so weather particles fall on the pet's local ground plane, not "into" the painted scene — keep it subtle. For weather that visibly hits the whole environment, that yard would need the HDRI route (Preset 5a). The road's own cracked asphalt already reads as ground, so set `ground.color` dark and low-camera so the pet appears to stand on the road.

---

## Decision cheat-sheet

| You want… | Do this |
|---|---|
| Use a room you already rendered | `kind:"image"` billboard — no AI. (Presets 1–3) |
| A room you only have as a blueprint | AI-generate from the blueprint + prompt → `kind:"image"` (`license:"generated"`). (Presets 4, 5b) |
| The pet to be **lit** by the scene + cast real shadows + reflections | Use an **HDRI** (`kind:"hdri"`) — needs a real 360° pano, not a flat render. (Preset 5a) |
| Just a quick one-off, no permanent preset | Scenes UI → Upload / Generate from prompt (`POST /api/scenes/backgrounds`), no JSON |
| Weather (rain/snow/fog) to matter | Only meaningful on an **exterior**; indoor billboards should stay `["clear"]` |

## Gotchas to respect (from your own §0 rules)

- **Licensing is validated at boot.** Owned renders = `"owned"`, AI = `"generated"`, true CC0 panos = `"CC0"`. A wrong/missing license fails the environment test.
- **Billboards don't light the pet.** Set an indoor lighting profile (your `lightingRig` indoor path ignores the sun and uses fixed interior lights) so the pet doesn't look sunlit in a dark room.
- **Match camera height to the render.** All 3 of your renders are floor-level eye-level → keep the animator's `cameraStart` low; a high camera exposes the billboard as flat.
- **`ambientSound` is optional** — omitted here so nothing 404s. To add hums/echo/drips, ship a CC0 or owned audio file and point `ambientSound` at it.
```
