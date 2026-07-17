from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LooksRequest(StrictModel):
    avatar_id: int = Field(gt=0)
    prompt: str = Field(min_length=1, max_length=2_000)
    identity_summary: str = Field(min_length=1, max_length=1_000)
    look_pack: str | None = Field(default=None, min_length=1, max_length=80)
    look_count: int = Field(ge=1, le=4)
    reference_photo_count: int = Field(ge=10, le=30)
    aspect_ratio: Literal["1:1", "4:5", "9:16", "16:9"]
    output_schema: Literal["pawsome.look-spec.v1"]


class Outfit(StrictModel):
    style: str = Field(min_length=1, max_length=120)
    garments: list[str] = Field(min_length=1, max_length=8)
    colors: list[str] = Field(min_length=1, max_length=6)
    accessories: list[str] = Field(max_length=6)


class Pose(StrictModel):
    stance: str = Field(min_length=1, max_length=160)
    expression: str = Field(min_length=1, max_length=120)
    gaze: str = Field(min_length=1, max_length=100)


class Environment(StrictModel):
    setting: str = Field(min_length=1, max_length=180)
    background: str = Field(min_length=1, max_length=180)


class Camera(StrictModel):
    shot: Literal["close-up", "waist-up", "three-quarter", "full-body"]
    angle: str = Field(min_length=1, max_length=100)


class Look(StrictModel):
    id: Literal["look-1", "look-2", "look-3", "look-4"]
    title: str = Field(min_length=1, max_length=80)
    outfit: Outfit
    pose: Pose
    environment: Environment
    camera: Camera
    lighting: str = Field(min_length=1, max_length=180)
    render_prompt: str = Field(min_length=1, max_length=1_200)
    negative_prompt: str = Field(min_length=1, max_length=800)


class LookSpecV1(StrictModel):
    schema_version: Literal["pawsome.look-spec.v1"]
    request_summary: str = Field(min_length=1, max_length=500)
    identity_rules: list[str] = Field(min_length=1, max_length=8)
    looks: list[Look] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def unique_look_ids(self) -> "LookSpecV1":
        ids = [look.id for look in self.looks]
        if len(set(ids)) != len(ids):
            raise ValueError("look IDs must be unique")
        return self
