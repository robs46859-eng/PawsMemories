from __future__ import annotations

import os
from typing import Any, Protocol

from models import LookSpecV1, LooksRequest


class StructuredGenerator(Protocol):
    def __call__(self, prompt: str, output_type: type[LookSpecV1], **kwargs: Any) -> Any: ...


def build_prompt(request: LooksRequest) -> str:
    pack = request.look_pack or "custom"
    return f"""You are the Fido's Styles look director.
Create exactly {request.look_count} visually distinct photo-avatar looks.
The subject identity must remain recognizable and unchanged across every look.
Use only the supplied text metadata. Never claim to have inspected the reference photos.
Each render_prompt must explicitly describe outfit, pose, setting, camera, and lighting.
Each negative_prompt must reject identity drift, duplicate anatomy, text, logos, and artifacts.
Number IDs consecutively from look-1.

User request: {request.prompt}
Identity summary: {request.identity_summary}
Look pack: {pack}
Reference-photo count: {request.reference_photo_count}
Output aspect ratio: {request.aspect_ratio}
Schema version: {request.output_schema}
"""


class OutlinesLooksPlanner:
    def __init__(self, generator: StructuredGenerator, max_new_tokens: int = 2_400):
        self.generator = generator
        self.max_new_tokens = max_new_tokens

    @classmethod
    def from_environment(cls) -> "OutlinesLooksPlanner":
        model_id = os.environ.get("HERMES_LOOKS_MODEL_ID", "").strip()
        if not model_id:
            raise RuntimeError("HERMES_LOOKS_MODEL_ID must name a Transformers-compatible Gemma 4 E2B checkpoint")

        # Importing here keeps health checks fast and makes a missing inference
        # stack fail explicitly only when the planner is initialized.
        import outlines
        from transformers import AutoModelForCausalLM, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(model_id)
        model = AutoModelForCausalLM.from_pretrained(model_id, device_map="auto")
        return cls(outlines.from_transformers(model, tokenizer))

    def plan(self, request: LooksRequest) -> LookSpecV1:
        # Passing the Pydantic class to Outlines is the constrained-decoding
        # boundary. Invalid schema tokens are excluded during generation.
        generated = self.generator(
            build_prompt(request),
            LookSpecV1,
            max_new_tokens=self.max_new_tokens,
        )
        if isinstance(generated, LookSpecV1):
            result = generated
        elif isinstance(generated, str):
            result = LookSpecV1.model_validate_json(generated)
        else:
            result = LookSpecV1.model_validate(generated)

        if len(result.looks) != request.look_count:
            raise ValueError("constrained result did not contain the requested look count")
        expected_ids = [f"look-{index}" for index in range(1, request.look_count + 1)]
        if [look.id for look in result.looks] != expected_ids:
            raise ValueError("constrained result look IDs were not consecutive")
        return result
