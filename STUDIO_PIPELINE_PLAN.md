# Studio AI Animation Pipeline — Implementation Plan

## Overview
Adds an **AI animation orchestration pipeline** to the existing Pawsome3D / PawsMemories
system. A Python FastAPI microservice (`server/studio/`) runs alongside the existing
Node/Express server. The Node server proxies `/api/studio/*` calls to the Python service.
Temporal provides durable workflow execution. Four OpenAI Agents (Editor, Visual Director,
Sound Director, Voice Director) collaborate via structured JSON.

---

## New API Endpoints

### Proxied via Express → Python FastAPI (`/api/studio/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/studio/productions` | Create a new production |
| GET | `/api/studio/productions` | List user's productions |
| GET | `/api/studio/productions/:id` | Get production + current status |
| GET | `/api/studio/productions/:id/versions` | List immutable versions |
| POST | `/api/studio/productions/:id/feedback` | Submit timestamped comment |
| POST | `/api/studio/productions/:id/approve` | Approve EDL → trigger final render |
| POST | `/api/studio/productions/:id/scenes/:sceneId/regenerate` | Re-run one scene |
| POST | `/api/studio/productions/:id/style` | Broad style change ("less dramatic") |
| GET | `/api/studio/productions/:id/download/:resolution` | Download rendered output |
| GET | `/api/studio/productions/:id/stems/:stem` | Download isolated audio stem |
| GET | `/api/studio/ws/:id/progress` | WebSocket live progress |

---

## New Environment Variables

```env
# Python studio service
STUDIO_SERVICE_URL=http://localhost:8001          # Internal URL Node proxies to

# Temporal
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=studio

# OpenAI (Agents SDK)
OPENAI_API_KEY=sk-...                              # Already used, confirm present
OPENAI_MODEL=gpt-4o                               # Model for director agents
OPENAI_EDITOR_MODEL=gpt-4o                        # Model for Editor AI

# TTS (swappable adapter)
STUDIO_TTS_PROVIDER=openai                        # openai | elevenlabs | azure
ELEVENLABS_API_KEY=...                            # if provider=elevenlabs
AZURE_TTS_KEY=...                                 # if provider=azure
AZURE_TTS_REGION=eastus

# Lip sync (swappable adapter)
STUDIO_LIPSYNC_PROVIDER=rhubarb                  # rhubarb | did | wav2lip
RHUBARB_PATH=/usr/local/bin/rhubarb

# Rendering
STUDIO_BLENDER_PATH=/usr/bin/blender
STUDIO_FFMPEG_PATH=/usr/bin/ffmpeg
STUDIO_RENDER_OUTPUT_DIR=/var/pawsmemories/renders
STUDIO_PREVIEW_WIDTH=640
STUDIO_PREVIEW_HEIGHT=360
STUDIO_WORKER_CONCURRENCY=2

# Storage (reuse existing S3 bucket or set separate)
STUDIO_S3_BUCKET=pawsmemories-studio
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY already in env

# Cache / progress
REDIS_URL=redis://localhost:6379

# DB (MySQL — existing connection, new tables added via migration)
# DB_HOST / DB_USER / DB_PASS / DB_NAME already in env
```

---

## Architecture Layers

```
Browser / React Timeline Editor
         │
         ▼
Express (Node) ──proxy──▶ FastAPI (Python :8001)
                                    │
                          ┌─────────┴──────────┐
                          │   Temporal Client   │
                          └─────────┬──────────┘
                                    │  starts workflow
                          ┌─────────▼──────────────────────────────────┐
                          │        ProductionWorkflow (Temporal)        │
                          │  1. EditorAgent → scene manifest            │
                          │  2. [Parallel] VisualDirector │ SoundDir │  │
                          │              VoiceDirector (3 editions ea)  │
                          │  3. EditorAgent → EDL assembly              │
                          │  4. Low-res Blender preview render          │
                          │  5. [Wait for human approval]               │
                          │  6. Full-res FFmpeg multi-resolution export │
                          └─────────────────────────────────────────────┘
                                    │
                          ┌─────────┴──────────┐
                          │  MySQL (new tables) │
                          │  S3 (assets/renders)│
                          │  Redis (progress)   │
                          └────────────────────┘
```

---

## File Structure Created

```
server/studio/
├── main.py                          # FastAPI app, routes
├── schemas.py                       # All Pydantic models / shared timeline schema
├── config.py                        # Env var loading
├── db.py                            # MySQL async pool
├── storage.py                       # S3 upload/download helpers
├── redis_client.py                  # Redis progress publisher
├── agents/
│   ├── __init__.py
│   ├── editor.py                    # Editor AI (OpenAI Agents SDK)
│   ├── visual_director.py           # Visual Director AI
│   ├── sound_director.py            # Sound Director AI
│   └── voice_director.py           # Voice Director AI
├── adapters/
│   ├── tts.py                       # Swappable TTS adapter
│   └── lipsync.py                   # Swappable lip-sync adapter
├── workers/
│   ├── blender_worker.py            # Headless Blender render
│   └── ffmpeg_worker.py             # Audio mix + multi-res export
├── workflows/
│   ├── production_workflow.py       # Main Temporal workflow
│   └── activities.py                # Temporal activity implementations
├── requirements.txt
└── Dockerfile

server/migrations/
└── 003_studio_tables.sql            # New MySQL tables

server/animator/
└── studio_proxy.ts                  # Express proxy to Python service (new)
```

---

## Shared Cue Schema (millisecond-accurate)

Every director writes `Cue` objects:

```json
{
  "cue_id": "uuid",
  "scene_id": "s01",
  "shot_id": "s01_sh01",
  "track": "visual | sound | voice",
  "start_ms": 0,
  "end_ms": 2500,
  "source_agent": "visual_director",
  "edition": "conservative | cinematic | experimental",
  "asset_id": "uuid | null",
  "instruction": "Close-up on Bubba's face, soft rim light from left",
  "intensity": 0.7,
  "parameters": { "camera": "close_up", "expression": "happy" },
  "confidence": 0.92,
  "locked": false,
  "dependencies": ["voice_cue_003"],
  "parent_version_id": null
}
```

---

## Version Hierarchy

Each production stores immutable snapshots:
- `original` — user-submitted script and assets (never modified)
- `director_v1` — conservative editions from all 3 directors
- `director_v2` — cinematic editions
- `director_v3` — experimental editions
- `editor_assembly` — locked EDL produced by Editor AI
- `user_revision_N` — each round of user feedback applied
- `final_master` — approved, fully rendered master

---

## Credit Costs (suggested)

| Operation | Credits |
|-----------|---------|
| Director pass (3 agents × 3 editions) | 15 |
| Editor assembly + EDL | 5 |
| Low-res preview render (per minute) | 3 |
| Scene regeneration | 8 |
| Final render 1080p (per minute) | 20 |
| Final render 4K (per minute) | 40 |

---

## Implementation Phases

### Phase 1 (this PR) — Schema + Agents + DB
- `schemas.py` — all Pydantic models
- `agents/` — all 4 agents with OpenAI Agents SDK
- `003_studio_tables.sql` — DB migration
- `main.py` — FastAPI routes (no Temporal yet, synchronous for dev)
- `studio_proxy.ts` — Express proxy

### Phase 2 — Temporal Workflows
- `workflows/production_workflow.py`
- `workflows/activities.py`
- Redis progress streaming
- Human approval checkpoint

### Phase 3 — Rendering
- `workers/blender_worker.py`
- `workers/ffmpeg_worker.py`
- Multi-resolution export
- Stems isolation

### Phase 4 — Frontend
- React timeline editor component
- Timestamped comment UI
- Director edition switcher
- Download panel
