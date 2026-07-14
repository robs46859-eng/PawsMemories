# P0 OPERATOR RUNBOOK

**Document:** Phase P0 Immediate Containment - Operator Procedures  
**Status:** Complete  
**Last Updated:** 2026-07-13

---

## QUICK REFERENCE

### Feature Flags

| Flag | Current Value | Location | Purpose |
|------|---------------|----------|---------|
| `PETSIM_RIG_ENABLED` | `false` | `.env` line 24 | Disable auto-rig pipeline (Tripo) |
| `PETSIM_CLASSIFY_ENABLED` | `true` | `.env` line 25 | Enable pet image classification |
| `PETSIM_SEMANTIC_SCAN_ENABLED` | `true` | `.env` line 26 | Enable semantic scan |
| `PETSIM_PAID_APIS_ENABLED` | `true` | `.env` line 27 | Master kill-switch for paid APIs |

### Daily Caps (Current Configuration)

| Operation | Daily Cap | Environment Variable |
|-----------|-----------|---------------------|
| Classify | 5 | `PETSIM_CLASSIFY_DAILY_CAP=5` |
| Rig | 2 | `PETSIM_RIG_DAILY_CAP=2` |
| Semantic Scan | 10 | `PETSIM_SEMANTIC_SCAN_DAILY_CAP=10` |

---

## DISABLING PAID ENDPOINTS (OPERATOR PROCEDURE)

### Method 1: Feature Flag (Recommended - Immediate)

**Disable Rig Pipeline:**
```bash
export PETSIM_RIG_ENABLED=false
```
**Effect:** `/api/pets/:id/rig` returns HTTP 501 with `{"error":"Rig pipeline disabled.","featureFlag":"PETSIM_RIG_ENABLED"}`

**Disable All Paid APIs:**
```bash
export PETSIM_PAID_APIS_ENABLED=false
```
**Effect:** `guardPaidCall()` blocks all paid endpoints regardless of individual flags

### Method 2: Environment Variable (Hostinger Production)

1. Log into Hostinger hPanel
2. Navigate to **Websites → pawsome3d.com → Settings**
3. Scroll to **Environment variables** section
4. Edit or create the variable:
   - **Variable:** `PETSIM_RIG_ENABLED`
   - **Value:** `false`
5. Click **Save** (automatic redeploy triggers)

**Verify:**
```bash
# After redeploy completes, test the endpoint
curl -X POST https://pawsome3d.com/api/pets/1/rig \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <REDACTED>" # gitleaks:allow - documentation placeholder

# Expected response: 501 with feature flag indicator
```

### Method 3: Code Disable (Emergency - Requires Deploy)

Edit `server.ts` line 2583:
```typescript
// Original
if (process.env.PETSIM_RIG_ENABLED !== "true") {
// Emergency disable
if (true) {  // Always disabled
```

**Warning:** Requires `git commit` + `bash scripts/build-deploy-zip.sh` + Hostinger upload

---

## VERIFYING FEATURE FLAGS WORK

### Test Rig Endpoint Disabled

```bash
# Using curl (replace TOKEN with valid JWT)
curl -X POST http://localhost:3000/api/pets/1/rig \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  | jq .

# Expected output:
# {
#   "error": "Rig pipeline disabled.",
#   "featureFlag": "PETSIM_RIG_ENABLED"
# }
# HTTP Status: 501
```

### Test Daily Cap Enforcement

```bash
# Check paidApiGuards implementation
grep -n "guardPaidCall" server/paidApiGuards.ts

# Run paid guards tests
npm run test:paid_guards
```

### Expected Test Output:
```
✓ isEndpointEnabled("rig", { PETSIM_RIG_ENABLED: "false" }) === false
✓ isEndpointEnabled("rig", { PETSIM_RIG_ENABLED: "true" }) === true
```

---

## APPROVED CAP VALUES (STAGING & PRODUCTION)

### Conservative Defaults (Recommended for Hardening Phase)

| Operation | Staging Cap | Production Cap | Rationale |
|-----------|-------------|----------------|-----------|
| Classify | 10 | 5 | Prevent abuse of vision API |
| Rig | 3 | 2 | Tripo costs are high; keep minimal |
| Semantic Scan | 20 | 10 | Gemini vision cost moderate |

### Maximum Allowed (Requires Waiver)

| Operation | Maximum Cap | Approval Required |
|-----------|-------------|-------------------|
| Classify | 50 | Owner review |
| Rig | 10 | Owner + cost review |
| Semantic Scan | 100 | Owner review |

**Warning:** Caps above maximum require written waiver from project owner.

---

## MONITORING CAP ENFORCEMENT

### Check Daily Usage (Admin Dashboard Query)

```sql
-- View today's usage per user
SELECT 
  user_phone,
  endpoint,
  COUNT(*) as usage_count,
  DATE(created_at) as usage_date
FROM credit_transactions
WHERE DATE(created_at) = CURDATE()
  AND endpoint IN ('rig', 'classify', 'semantic_scan')
GROUP BY user_phone, endpoint, DATE(created_at)
ORDER BY usage_count DESC;
```

### Check User's Daily Cap Status

```sql
-- Check remaining caps for a specific user
SELECT 
  c.user_phone,
  c.endpoint,
  c.total_spent as daily_usage,
  CASE 
    WHEN c.endpoint = 'rig' THEN 2
    WHEN c.endpoint = 'classify' THEN 5
    WHEN c.endpoint = 'semantic_scan' THEN 10
  END as daily_cap,
  CASE 
    WHEN c.endpoint = 'rig' THEN 2 - c.total_spent
    WHEN c.endpoint = 'classify' THEN 5 - c.total_spent
    WHEN c.endpoint = 'semantic_scan' THEN 10 - c.total_spent
  END as remaining
FROM (
  SELECT 
    user_phone,
    endpoint,
    COUNT(*) as total_spent
  FROM credit_transactions
  WHERE DATE(created_at) = CURDATE()
    AND endpoint IN ('rig', 'classify', 'semantic_scan')
  GROUP BY user_phone, endpoint
) c;
```

---

## EMERGENCY PROCEDURES

### Emergency Kill-Switch (Unlimited Abuse Detected)

**Symptom:** Sudden spike in provider API calls, unusual credit consumption

**Immediate Actions:**

1. **Disable all paid APIs:**
   ```bash
   export PETSIM_PAID_APIS_ENABLED=false
   ```
   
2. **Verify in Hostinger:**
   - Navigate to Hostinger hPanel → Environment variables
   - Set `PETSIM_PAID_APIS_ENABLED=false`
   - Save and confirm redeploy completes

3. **Check coverage:**
   ```bash
   curl https://pawsome3d.com/api/pets/1/rig \
     -H "Authorization: Bearer TOKEN"
   # Expected: 501 error
   ```

4. **Investigate source:**
   - Review cloud logs for suspicious IPs/user agents
   - Check `credit_transactions` table for anomaly patterns
   - Identify attack vector

5. **Re-enable selectively:**
   ```bash
   export PETSIM_PAID_APIS_ENABLED=true
   export PETSIM_RIG_ENABLED=false  # Keep off during investigation
   ```

---

## DEPLOYMENT CHECKLIST

### Before Enabling Rig Feature

- [ ] P2 input validation complete (MIME, size, remote fetch security)
- [ ] P3 authorization complete (tenant isolation, private storage)
- [ ] P4 cost controls complete (idempotency, quota reservation)
- [ ] P5 device testing complete (FPS, memory, model validation)
- [ ] Owner approval for production cap values
- [ ] Operator runbook reviewed and tested

### After Deployment

- [ ] Test rig endpoint returns 501 when flag is false
- [ ] Verify daily cap prevents exceedance
- [ ] Confirm audit log records each transaction
- [ ] Check provider billing dashboard for expected costs
- [ ] Run full test suite: `npm run test:ar`

---

## EVIDENCE REQUIREMENTS

### Exit Gate Proof (P0 Complete)

| Evidence | Format | Storage Location |
|----------|--------|------------------|
| Staging endpoint disabled | Screenshot of 501 response | `/docs/P0_evidence/` |
| Configured caps (redacted) | `.env` copy with secrets masked | `/docs/P0_evidence/` |
| Abuse test report | PDF with test steps/results | `/docs/P0_evidence/` |
| Operator test script | `.md` file with curl commands | `/docs/P0_evidence/runbook_tests.md` |

**Required for P0 exit gate:** All 4 items present and reviewed

---

## CONTACTS & ESCALATION

| Role | Contact | Escalation Path |
|------|---------|-----------------|
| Operator | [Current operator] | Project owner |
| Project Owner | [Name needed] | Technical lead |
| Provider Support | Tripo: support@tripo3d.com<br>Gemini: Google AI Studio | N/A |

---

## DOCUMENT HISTORY

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-07-13 | Initial documentation | AR Build Team |

---

**Status:** Ready for P0 implementation  
**Next Milestone:** P0.2 - Daily Caps Implementation
