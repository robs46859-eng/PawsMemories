# Reference Sessions Domain (`server/reference-sessions/`)

Phase 2 High-Resolution Multiview Approval domain module.

## Architecture and Responsibilities

- **`types.ts`**: Core domain types, session state enum (`draft`, `queued`, `generating`, `ready`, `approved`, `failed`, `cancelled`), view kinds (`front`, `left`, `right`, `rear`, `front_three_quarter`), and provider interfaces.
- **`schemas.ts`**: Strict Zod validation schemas for requests, responses, AI consistency reports, and ordered reference view manifests.
- **`repository.ts`**: Transaction-safe MySQL persistence functions against Migration 20 tables (`reference_sessions`, `reference_attempts`, `reference_views`, `reference_reports`, `reference_approvals`).
- **`service.ts`**: State machine transitions, idempotency, retry tracking, source image replacement, and immutable approval validation.
- **`provider.ts`**: `ReferenceImageProvider` port definition and Gemini image generation adapter implementation.
- **`consistency.ts`**: Multi-perspective AI consistency analysis composition and Zod vision report parser.
- **`storage.ts`**: Server-minted private object key generation (`references/...`), SHA-256/size/MIME calculation, and S3/private storage persistence.
- **`routes.ts`**: Thin authenticated Express router mounted at `/api/reference-sessions`.
- **`featureFlag.ts`**: Server-authoritative feature flag checking `MULTIVIEW_APPROVAL_ENABLED`.

## State Machine

```
   +-------> [ draft ] <-------+
   |            |              | (replace input)
   |         (start)           |
   |            v              |
(cancel)     [ queued ] -------> (failure) -------> [ failed ]
   |            |                                      |
   |            v                                      | (retry)
   |       [ generating ]                              |
   |            |                                      |
   |            v                                      |
   +-------> [ ready ] <-------------------------------+
                |
             (approve)
                v
           [ approved ] (Terminal state for session)
```

- **`draft`**: Session created, awaiting prompt/photo input.
- **`queued` / `generating`**: Active generation attempt.
- **`ready`**: 5 high-resolution reference views generated, stored as canonical asset versions, and evaluated for consistency. Ready for user review.
- **`approved`**: User explicitly approved the exact 5-view manifest hash. Terminal state for this session.

## Ordered Reference Views Contract

Every approved session must contain exactly 5 ordered views:
1. `front`
2. `left`
3. `right`
4. `rear`
5. `front_three_quarter`

## Billing Policy
Per platform pricing rules (`pricing.ts`), Phase 2 reference generation and retries cost 0 PupCoins. No credits are debited during Phase 2. Model build charges occur only in Phase 3.
