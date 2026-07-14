# Phase P2: Input/Upload/Remote-Fetch Security

**Status:** In Progress  
**Date:** 2026-07-14  
**Supersedes:** Original hardening plan H2 validation

---

## Verified Status on Stabilization Branch

This phase remains **partial**. The current branch wires strict Zod request schemas into
the production classify, rig, and semantic-scan router. Contract tests prove the covered
malformed requests, ownership failures, disabled endpoints, and exhausted caps stop
before deterministic provider fakes are called.

Implemented foundation:

- `src/schemas/pets.ts` and `src/schemas/ar.ts` validate production paid-route requests.
- Arbitrary `imageUrl` is rejected; classify and semantic scan require image data URLs.
- `src/security/image-input.ts` validates canonical base64, JPEG/PNG/WebP signatures,
  declared MIME agreement, encoded/decoded bytes, dimensions, pixels, aspect ratio,
  truncation, and trailing container data before quota or provider calls.
- `server/petSimRouter.ts` applies existing Express throttling, feature switches, and
  per-user daily caps before provider calls.
- `tests/security/image-input.test.mjs` provides seven focused image validation cases.
- `tests/contracts/petsim.test.mjs` provides 18 production-router contract cases and
  deterministic call counters.

Not yet implemented or evidenced:

- A complete adversarial fixture corpus beyond the current focused generated fixtures.
- Authenticated-user plus hashed-IP route buckets and trusted-proxy tests.
- Maximum-input memory profile and the remaining provider-zero rejection matrix.
- Production response-schema enforcement for every success/error variant.
- Production-safe remote fetch. `safe-fetch.ts` is not wired because DNS resolution,
  IPv6/reserved-range checks, redirect validation, and streaming limits are incomplete.

Do not mark P2 complete until the exit gate and evidence requirements below all pass.

---

## P2 Objectives

Phase P2 rejects hostile or excessive input **before** it consumes memory, storage, or paid API capacity.

**Exit gate:** Invalid MIME, oversized input, decompression bombs, private-network URLs, redirect pivots, and slow responses return controlled 4xx/5xx results **before any paid provider call**.

**Required evidence:**
- Adversarial test corpus
- Provider fake call counts at zero for rejected cases
- Memory profile for maximum accepted input

---

## P2 Implementation Milestones

### P2.1: Shared Zod Schemas

**Goal:** Define request/response schemas for all paid endpoints.

**Files:**
- `src/schemas/pets.ts` - Pet classification schema
- `src/schemas/ar.ts` - Semantic scan schema
- `src/schemas/rig.ts` - Rig generation schema
- `src/schemas/shared.ts` - Shared error/response schemas

**Validation rules:**
- All inputs validated against schema before processing
- Reject with 400 + validation details on schema failure
- Type checking, length limits, pattern matching
- Return `error` + `validation[]` array per spec

**Tests:**
- Each schema: valid input → 200, invalid input → 400
- Schema versioning tests
- Migration compatibility tests

---

### P2.2: MIME & File Signature Validation

**Goal:** Decode and verify file signatures; never trust data-URL MIME label.

**Files:**
- `src/security/file-signature.ts` - Magic number detection
- `src/security/mime-validator.ts` - MIME type enforcement

**Valid formats:**
- JPEG: `FF D8 FF`
- PNG: `89 50 4E 47`
- WebP: `52 49 46 46` + `WEBP`

**Validation:**
- Decode base64 → binary
- Match first 12 bytes against magic numbers
- Compare detected MIME vs declared MIME
- Reject mismatch with 400 + validation error

**Tests:**
- Valid JPEG/PNG/WebP → accept
- MIME mismatch (PNG declared as JPEG) → reject
- Truncated file → reject
- Polyglot file → reject

---

### P2.3: Size & Dimension Limits

**Goal:** Enforce encoded bytes, decoded bytes, pixel dimensions, aspect ratio, decompression-bomb limits.

**Limits:**
- **Encoded bytes (base64):** 5 MB max
- **Decoded bytes:** 10 MB max
- **Dimensions:** 4096x4096 max
- **Aspect ratio:** 1:10 to 10:1 max
- **Decompression bomb:** 100 MPix max (width × height)

**Implementation:**
- Calculate decoded size from base64 length
- Parse image dimensions without full decode
- Check aspect ratio before processing
- Reject oversized input with 413 Payload Too Large

**Tests:**
- 5MB base64 → accept, 5.1MB → reject
- 4096x4096 → accept, 4097x4097 → reject
- 1:20 aspect ratio → reject
- 200MPix image → reject (decompression bomb)

---

### P2.4: Safe Remote URL Fetching

**Goal:** Replace unrestricted `imageUrl` with owned-media object keys. If remote URLs required, implement strict safety controls.

**Files:**
- `src/security/safe-fetch.ts` - Remote URL fetcher with safety checks
- `src/security/url-sanitizer.ts` - URL parsing and validation

**Safety controls:**
- **Protocol:** HTTPS only
- **Domain allowlist:** Pre-approved domains only
- **Network isolation:** Reject loopback, private, link-local, metadata IPs
- **Redirect policy:** Max 3 redirects, validate each destination
- **Timeouts:** 
  - Connection: 5s
  - Headers: 3s
  - Total: 15s
  - Idle: 10s
- **Byte ceiling:** 5 MB max
- **Streaming:** No `arrayBuffer()` buffering, stream with byte counter

**Private IP ranges to reject:**
- 10.0.0.0/8
- 172.16.0.0/12
- 192.168.0.0/16
- 127.0.0.0/8
- 169.254.0.0/16
- 0.0.0.0/8
- FD00::/8 (IPv6 unique local)
- FE80::/10 (IPv6 link-local)

**Tests:**
- Public HTTPS URL → accept
- HTTP URL → reject
- HTTPS to private IP redirect → reject
- Redirect to different domain → reject
- Slow server (100KB/s) → timeout and reject
- 10MB response → reject (byte ceiling)

---

### P2.5: Malformed Base64 Rejection

**Goal:** Reject malformed base64 and trailing/polyglot content.

**Validation:**
- Strict base64 pattern: `[A-Za-z0-9+/]*={0,2}`
- Reject invalid characters
- Reject improper padding
- Detect trailing garbage after valid base64

**Tests:**
- Valid base64 → accept
- Invalid chars (spaces, newlines) → reject
- Improper padding (`==` when `=` needed) → reject
- Trailing garbage → reject

---

### P2.6: Rate Limiting

**Goal:** Apply route-specific rate-limit buckets by authenticated user and hashed IP.

**Files:**
- `src/security/rate-limiter.ts` - Rate limiting middleware
- `src/security/trusted-proxy.ts` - Proxy detection

**Rate limits:**
- **Per user, per endpoint:**
  - `/classify`: 25/hour
  - `/rig`: 5/hour
  - `/semantic-scan`: 50/hour
- **Per IP (hashed):**
  - Global: 100/hour
  - All endpoints combined

**Implementation:**
- Store in Redis (or in-memory fallback for dev)
- Track requests per user phone + endpoint
- Track requests per hashed IP
- Return 429 Too Many Requests when exceeded
- Include `Retry-After` header

**Tests:**
- Valid request under limit → accept
- Exceeds user limit → 429
- Exceeds IP limit → 429
- Trusted proxy header → trust X-Forwarded-For
- Untrusted proxy → reject spoofed IP

---

## P2 Test Corpus

### Adversarial Input Files

Create test fixtures directory: `tests/fixtures/`

**File types:**
- `valid_jpeg.jpg` - Valid JPEG
- `valid_png.png` - Valid PNG
- `valid_webp.webp` - Valid WebP
- `mime_mismatch.jpg` - PNG declared as JPEG
- `truncated.jpg` - Incomplete JPEG header
- `polyglot.png` - PNG with JPEG magic bytes at offset
- `oversized_base64.txt` - 6MB base64 string
- `malformed_base64.txt` - Invalid base64 characters
- `decompression_bomb.txt` - 1px image with huge decoded size
- `trailing_garbage.txt` - Valid base64 + garbage

### Network Attack Scenarios

**Test scenarios:**
- HTTP URL (should reject)
- HTTPS to 127.0.0.1 (should reject)
- HTTPS to 192.168.1.1 (should reject)
- HTTPS to metadata service (169.254.169.254)
- HTTPS redirect loop (should reject)
- HTTPS redirect to private IP
- HTTPS redirect to untrusted domain
- Slow response (100 bytes/second)
- Oversized response (10MB)

---

## P2 Implementation Plan

### Phase 1: Foundation (Day 1)
- [x] Create Zod schemas directory structure
- [x] Implement base64 size calculator
- [x] Create file signature detector
- [x] Write unit tests for each utility

### Phase 2: Input Validation (Day 2)
- [x] Implement MIME validator
- [x] Implement dimension checker
- [x] Create base64 parser with strict mode
- [x] Add validation to the production Express router

### Phase 3: Safe Fetch (Day 3)
- [ ] Implement network isolation checks
- [ ] Create redirect validator
- [ ] Build streaming byte counter
- [ ] Add timeout wrappers

### Phase 4: Rate Limiting (Day 4)
- [ ] Implement rate limiter middleware
- [ ] Create Redis in-memory fallback
- [ ] Add trusted proxy detection
- [ ] Test all rate limit scenarios

### Phase 5: Integration & Testing (Day 5)
- [x] Wire all current local-image validations into `/api/pets/classify`
- [x] Wire all current local-image validations into `/api/ar/semantic-scan`
- [ ] Run adversarial test corpus
- [ ] Verify provider fake call counts = 0 for rejected cases
- [ ] Memory profile max accepted input

---

## P2 Exit Gate Verification

**Before marking P2 complete:**

1. **Adversarial corpus test:**
   ```bash
   npm run test:adversarial
   ```
   All tests pass, all rejections return 4xx, no provider calls for invalid inputs.

2. **Provider call verification:**
   - Mock provider returns 0 calls for all rejection tests
   - Verified via `providerCallCount` counter

3. **Memory profile:**
   - Max accepted input (5MB base64) → < 50MB heap
   - Decompression bomb attempt → rejected before decode
   - Streaming 5MB → peak memory < 30MB

4. **CI integration:**
   - All P2 tests in GitHub Actions
   - Branch protection requires P2 test pass
   - Coverage baseline recorded

---

## Files to Create/Modify

### New Files
- `src/schemas/pets.ts`
- `src/schemas/ar.ts`
- `src/schemas/rig.ts`
- `src/schemas/shared.ts`
- `src/security/file-signature.ts`
- `src/security/mime-validator.ts`
- `src/security/safe-fetch.ts`
- `src/security/url-sanitizer.ts`
- `src/security/rate-limiter.ts`
- `src/security/trusted-proxy.ts`
- `tests/fixtures/` (adversarial corpus)
- `tests/security/adversarial.test.ts`
- `tests/security/safe-fetch.test.ts`
- `tests/security/rate-limiter.test.ts`

### Modified Files
- `server.ts` - Add P2 validation middleware
- `tests/contracts/petsim.test.mjs` - Extend production-router P2 contract cases
- `package.json` - Add dependencies if needed
- `.github/workflows/ci.yml` - Add P2 tests to workflow

---

## Dependencies

**Additional npm packages:**
- `zod` (if not already present) - Schema validation
- `proxy-addr` - Trusted proxy handling
- `ipaddr.js` - IP range checking

**Check existing:**
- `supertest` - Already added in P1
- `tsx` - Already in use

---

**Next:** Complete P2.4 safe remote fetch and trusted-proxy/user rate buckets, then run
the full adversarial corpus and maximum-input memory profile. Keep remote URL input
disabled until those controls pass.
