"""
Shared Pydantic schemas for the Studio AI Animation Pipeline.
Every agent, worker, and API endpoint references these models.
"""

from __future__ import annotations
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4
from pydantic import BaseModel, Field
import time


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class Edition(str, Enum):
    conservative = "conservative"
    cinematic = "cinematic"
    experimental = "experimental"

class TrackType(str, Enum):
    visual = "visual"
    sound = "sound"
    voice = "voice"

class ProductionStatus(str, Enum):
    draft = "draft"
    directing = "directing"          # Directors running in parallel
    assembling = "assembling"        # Editor building EDL
    preview_rendering = "preview_rendering"
    awaiting_approval = "awaiting_approval"
    revision = "revision"
    final_rendering = "final_rendering"
    done = "done"
    failed = "failed"

class VersionTag(str, Enum):
    original = "original"
    director_v1 = "director_v1"      # conservative
    director_v2 = "director_v2"      # cinematic
    director_v3 = "director_v3"      # experimental
    editor_assembly = "editor_assembly"
    user_revision = "user_revision"
    final_master = "final_master"

class Resolution(str, Enum):
    r480p = "480p"
    r720p = "720p"
    r1080p = "1080p"
    r1440p = "1440p"
    r4k = "4k"

class AspectRatio(str, Enum):
    landscape_16_9 = "16:9"
    portrait_9_16 = "9:16"
    square_1_1 = "1:1"
    cinema_21_9 = "21:9"

class StylePreset(str, Enum):
    realistic = "realistic"
    cinematic = "cinematic"
    cartoon = "cartoon"
    anime = "anime"
    documentary = "documentary"
    experimental = "experimental"


# ---------------------------------------------------------------------------
# Core Cue — the atom shared by all directors
# ---------------------------------------------------------------------------

class Cue(BaseModel):
    """
    The atomic instruction unit shared across all directors and the Editor.
    Every director produces lists of Cues; the Editor selects/combines them
    into the locked Edit Decision List.
    """
    cue_id: str = Field(default_factory=lambda: str(uuid4()))
    scene_id: str
    shot_id: str
    track: TrackType
    start_ms: int = Field(ge=0, description="Inclusive start in milliseconds")
    end_ms: int = Field(gt=0, description="Exclusive end in milliseconds")
    source_agent: str                       # "visual_director" | "sound_director" | "voice_director" | "editor"
    edition: Edition
    asset_id: Optional[str] = None          # GLB, audio file, etc.
    instruction: str                        # Human-readable production note
    intensity: float = Field(ge=0.0, le=1.0, default=0.5)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    locked: bool = False
    dependencies: List[str] = Field(default_factory=list, description="cue_ids this cue depends on")
    parent_version_id: Optional[str] = None

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


# ---------------------------------------------------------------------------
# Director-specific Cue sub-types with typed parameters
# ---------------------------------------------------------------------------

class VisualCueParams(BaseModel):
    camera: Optional[str] = None        # "close_up" | "medium" | "wide" | "dutch_angle" | ...
    expression: Optional[str] = None    # "happy" | "sad" | "neutral" | ...
    lighting: Optional[str] = None      # "soft_rim" | "harsh_key" | "ambient" | ...
    movement: Optional[str] = None      # "dolly_in" | "pan_left" | "static" | ...
    transition: Optional[str] = None    # "cut" | "dissolve" | "wipe" | ...
    blocking: Optional[str] = None      # character position note
    environment: Optional[str] = None   # environment/background id or description
    depth_of_field: Optional[float] = None

class SoundCueParams(BaseModel):
    sound_type: Optional[str] = None    # "music" | "foley" | "ambience" | "sfx" | "silence"
    asset_key: Optional[str] = None     # reference to sound asset
    volume_db: Optional[float] = None
    pan: Optional[float] = None         # -1.0 (left) to 1.0 (right)
    spatial_x: Optional[float] = None
    spatial_y: Optional[float] = None
    spatial_z: Optional[float] = None
    fade_in_ms: Optional[int] = None
    fade_out_ms: Optional[int] = None
    loop: bool = False
    reverb: Optional[str] = None

class VoiceCueParams(BaseModel):
    speaker_id: str                     # avatar/character id
    voice_model: Optional[str] = None   # TTS model/voice name
    text: str                           # the exact dialogue line
    emotion: Optional[str] = None       # "calm" | "excited" | "sad" | ...
    pacing: Optional[float] = None      # words per minute
    emphasis_words: List[str] = Field(default_factory=list)
    pause_before_ms: int = 0
    pause_after_ms: int = 0
    pronunciation_overrides: Dict[str, str] = Field(default_factory=dict)
    phoneme_timing: Optional[List[PhonemeTiming]] = None  # set by voice worker

class PhonemeTiming(BaseModel):
    phoneme: str
    viseme: str                         # mouth shape id
    start_ms: int
    end_ms: int


# ---------------------------------------------------------------------------
# Director outputs — three editions each
# ---------------------------------------------------------------------------

class DirectorOutput(BaseModel):
    director: str                       # "visual_director" | "sound_director" | "voice_director"
    production_id: str
    created_at: float = Field(default_factory=time.time)
    conservative: List[Cue]
    cinematic: List[Cue]
    experimental: List[Cue]
    notes: str = ""

    def edition(self, e: Edition) -> List[Cue]:
        return getattr(self, e.value)


# ---------------------------------------------------------------------------
# Scene and Shot manifest built by Editor AI
# ---------------------------------------------------------------------------

class Shot(BaseModel):
    shot_id: str
    scene_id: str
    start_ms: int
    end_ms: int
    description: str

class Scene(BaseModel):
    scene_id: str
    start_ms: int
    end_ms: int
    description: str
    shots: List[Shot] = Field(default_factory=list)

class SceneManifest(BaseModel):
    production_id: str
    original_script: str               # NEVER modified
    total_duration_ms: int
    scenes: List[Scene]
    created_at: float = Field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Edit Decision List (EDL) — the locked Editor output
# ---------------------------------------------------------------------------

class EditConflict(BaseModel):
    description: str
    affected_cue_ids: List[str]
    resolution: str

class EDL(BaseModel):
    """
    The locked Edit Decision List produced by the Editor AI.
    Contains selected/merged cues from all directors.
    """
    production_id: str
    version_id: str
    created_at: float = Field(default_factory=time.time)
    visual_track: List[Cue]
    sound_track: List[Cue]
    voice_track: List[Cue]
    conflicts_resolved: List[EditConflict] = Field(default_factory=list)
    total_duration_ms: int
    locked: bool = False

    def all_cues(self) -> List[Cue]:
        return self.visual_track + self.sound_track + self.voice_track


# ---------------------------------------------------------------------------
# Production — top-level object stored in DB
# ---------------------------------------------------------------------------

class ProductionVersion(BaseModel):
    version_id: str = Field(default_factory=lambda: str(uuid4()))
    tag: VersionTag
    created_at: float = Field(default_factory=time.time)
    data: Dict[str, Any]               # serialized SceneManifest | EDL | etc.
    render_urls: Dict[str, str] = Field(default_factory=dict)  # resolution -> URL

class Production(BaseModel):
    production_id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str                        # ties to existing users table
    status: ProductionStatus = ProductionStatus.draft
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    workflow_id: Optional[str] = None  # Temporal workflow ID

    # User inputs
    original_script: str
    target_duration_ms: int
    avatar_asset_ids: List[str] = Field(default_factory=list)
    style: StylePreset = StylePreset.cinematic
    voice_model: Optional[str] = None
    aspect_ratio: AspectRatio = AspectRatio.landscape_16_9
    output_resolution: Resolution = Resolution.r1080p

    # Pipeline outputs (null until each phase completes)
    scene_manifest: Optional[Dict[str, Any]] = None
    director_outputs: Dict[str, Any] = Field(default_factory=dict)  # agent -> DirectorOutput
    edl: Optional[Dict[str, Any]] = None
    preview_url: Optional[str] = None
    render_urls: Dict[str, str] = Field(default_factory=dict)

    # Immutable version history
    versions: List[ProductionVersion] = Field(default_factory=list)

    # Feedback
    feedback: List[TimelineFeedback] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# User-facing feedback model
# ---------------------------------------------------------------------------

class TimelineFeedback(BaseModel):
    feedback_id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    created_at: float = Field(default_factory=time.time)
    timestamp_ms: Optional[int] = None    # null = global note
    scene_id: Optional[str] = None
    shot_id: Optional[str] = None
    cue_id: Optional[str] = None
    message: str
    action: Optional[str] = None          # "replace_edition" | "regenerate_scene" | "style_change"
    action_params: Dict[str, Any] = Field(default_factory=dict)
    resolved: bool = False


# ---------------------------------------------------------------------------
# API Request / Response models
# ---------------------------------------------------------------------------

class CreateProductionRequest(BaseModel):
    original_script: str = Field(min_length=10, max_length=50_000)
    target_duration_ms: int = Field(ge=3_000, le=600_000, description="3s to 10min")
    avatar_asset_ids: List[str] = Field(default_factory=list)
    style: StylePreset = StylePreset.cinematic
    voice_model: Optional[str] = None
    aspect_ratio: AspectRatio = AspectRatio.landscape_16_9
    output_resolution: Resolution = Resolution.r1080p

class ProductionSummary(BaseModel):
    production_id: str
    status: ProductionStatus
    created_at: float
    updated_at: float
    style: StylePreset
    aspect_ratio: AspectRatio
    output_resolution: Resolution
    preview_url: Optional[str]
    render_urls: Dict[str, str]

class SubmitFeedbackRequest(BaseModel):
    timestamp_ms: Optional[int] = None
    scene_id: Optional[str] = None
    shot_id: Optional[str] = None
    cue_id: Optional[str] = None
    message: str = Field(min_length=1, max_length=2000)
    action: Optional[str] = None
    action_params: Dict[str, Any] = Field(default_factory=dict)

class RegenerateSceneRequest(BaseModel):
    scene_id: str
    edition: Optional[Edition] = None
    notes: Optional[str] = None

class StyleChangeRequest(BaseModel):
    instruction: str = Field(min_length=3, max_length=500,
                             description="e.g. 'less dramatic', 'faster pacing'")

class ApproveProductionRequest(BaseModel):
    resolutions: List[Resolution] = Field(
        default=[Resolution.r720p, Resolution.r1080p],
        description="Which resolutions to render"
    )
    include_transparent_bg: bool = False
    include_stems: bool = True
    include_subtitles: bool = True

class ProgressUpdate(BaseModel):
    production_id: str
    status: ProductionStatus
    phase: str
    percent: float = Field(ge=0.0, le=100.0)
    message: str
    timestamp: float = Field(default_factory=time.time)
