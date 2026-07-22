# Phase 8 Evidence: Randy Product Assistant

Status: Security and grounding code complete; production 3D asset acceptance pending
Branch: `fix/text-mode-reference-screen`
Release commit: TBD
Feature flag: none for the existing chat; every action is a low-risk proposal requiring a user click

## Implemented Contract

- `server/randy/registry.ts` is the versioned source for module capabilities, prerequisites, current credit prices, routes, actions, and limitations.
- The request receives only live credit/admin context. Missing entitlement or job state must be described as unverifiable.
- `RandyChatRequestSchema` bounds untrusted history and rejects unknown fields.
- `RandyActionProposalSchema` permits only known navigation, tour, highlight, AR, and credit-store proposals. It permits no purchase, refund, balance, job, admin, deletion, or data-mutation action.
- Strict response parsing fails closed to `none`; malformed model output cannot smuggle an action.
- The existing client renders the action as a button, so execution requires a separate user click. The client route map includes every server-allowlisted screen.
- Calls are rate-limited. Privacy-safe action audit logs use a truncated SHA-256 actor hash and registry version, without chat content.

## Automated Evidence

| Gate | Result |
|---|---|
| TypeScript | PASS |
| Focused Randy tests | 14/14 PASS |
| Full Node suite under Node 24.18 | 1,031 pass / 1,034 total / 3 opt-in skips / 0 failures |
| Production build and manifest | PASS, 59 release files |
| Animator subsystem doctor | PASS; optional Rhubarb warning only |

## Remaining Exit Work

- Replace the procedural head with the accepted versioned Randy GLB and measured LODs.
- Verify actual body/head rig, eyes, jaw, blink, canonical visemes, and fallback behavior.
- Measure weak-GPU/mobile budgets and keyboard/screen-reader non-3D fallback.
- Run the complete module/pricing/status walkthrough corpus against live context.

Decision: AI grounding/security may merge independently. Phase 8 is not signed off as complete.
