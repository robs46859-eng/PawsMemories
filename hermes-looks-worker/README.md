# Hermes Outlines Looks Worker

This service is the constrained-decoding boundary for Fido's Styles. It uses
Outlines with a Pydantic `LookSpecV1` model, so Gemma can only emit tokens that
produce a schema-valid result. Pawsome3D validates the same schema again before
using the plan in its image renderer.

The existing Android Hermes worker loads a `.litertlm` Gemma 4 E2B model through
LiteRT-LM. Outlines cannot wrap that Kotlin runtime. Set `HERMES_LOOKS_MODEL_ID`
to a Transformers-compatible Gemma 4 E2B checkpoint served by this Python
worker; do not point it at the Android `.litertlm` file.

Required environment variables:

- `HERMES_LOOKS_MODEL_ID`: approved Transformers-compatible Gemma 4 E2B model ID/path
- `HERMES_LOOKS_WORKER_TOKEN`: private bridge-to-worker bearer token

The Hermes bridge submits the validated `looks` payload to
`POST /v1/looks/plan`. Photos never enter this service. It returns a structured
look plan; the image-generation pipeline applies that plan to the private avatar
references.
