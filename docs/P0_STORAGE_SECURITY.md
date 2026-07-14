# P0 STORAGE SECURITY ASSESSMENT

**Document:** Phase P0.4 Storage Security - B2 Bucket ACL Analysis  
**Date:** 2026-07-13  
**Status:** Issue Documented - Requires P3 Migration

---

## CURRENT STATE: PUBLIC READ ACCESS

### Problem Identified

All media uploads use `ACL: "public-read"` when storing to Backblaze B2:

**Location:** `storage.ts` lines 110, 152, 193

```typescript
// uploadBase64Image (line 110)
await s3Client.send(
  new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: mimeType,
    ACL: "public-read",  // ← PUBLIC ACCESS
  })
);

// uploadBase64Binary (line 152)
await s3Client.send(
  new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: mimeType,
    ACL: "public-read",  // ← PUBLIC ACCESS
  })
);

// uploadBinaryFromUrl (line 193)
await s3Client.send(
  new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: mimeType,
    ACL: "public-read",  // ← PUBLIC ACCESS
  })
);
```

### Impact

**HIGH RISK - Violates P3 Exit Gate Requirement:**

From AR_PET_SIM_HARDENING_PLAN_V2 §8:
> **3. Auth and isolation** | Partial | Pet profile and paid pet routes query by authenticated owner | **B2 uploads use `public-read`; URLs do not expire; no automated cross-tenant route matrix was found**

**Security Implications:**
1. Any user can access any media URL if they guess/derive the filename
2. No ownership verification before media access
3. Permanent public URLs (no expiration)
4. Bucket can potentially be enumerated to discover all files

---

## P0 CONTAINMENT OPTIONS

### Option 1: Accept Current State (Not Recommended)

**Pros:**
- No immediate changes required
- Existing URLs remain functional

**Cons:**
- Violates hardening plan requirement H3
- Exposes user media to potential unauthorized access
- P3 private storage migration delayed indefinitely

### Option 2: Disable Public ACL at P0 (Breaks Existing URLs)

**Changes Required:**
```typescript
// Remove ACL: "public-read" from all uploads
await s3Client.send(
  new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: mimeType,
    // No ACL specified - uses bucket default
  })
);
```

**Then set bucket policy to private:**
- B2 Bucket Settings → Access → Disable "List Files" permission
- Bucket default ACL: private

**Pros:**
- New uploads are private by default
- Immediate containment

**Cons:**
- **BREAKS ALL EXISTING PUBLIC URLS**
- Avatar images, memories, community uploads all stop working
- Requires full URL regeneration (complex)

### Option 3: Document for P3 Migration (RECOMMENDED)

**Keep current state** but document:
1. All media currently public
2. P3 migration required to implement:
   - Private bucket ACL
   - Signed URL generation
   - Ownership verification
   - URL expiration

---

## P3 MIGRATION PLAN (Required for Production)

### Phase P3: Authorization and Private Asset Delivery

**Exit Gate:** Neither anonymous nor user A can retrieve user B's media

### Required Changes:

#### 1. Storage Layer (`storage.ts`)

```typescript
// Change: Remove public ACL, add ownership verification
export async function uploadBase64Image(
  base64String: string, 
  folderOverride?: string,
  ownerPhone?: string  // ← NEW: Track ownership
): Promise<string> {
  // ... existing code ...
  
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: buffer,
      ContentType: mimeType,
      ACL: "private",  // ← PRIVATE
      Metadata: {
        "owner-phone": ownerPhone || "",
        "upload-timestamp": Date.now().toString(),
      },
    })
  );
  
  // Return object key, NOT public URL
  return `b2://${bucketName}/${fileName}`;  // ← INTERNAL KEY
}
```

#### 2. New Signed URL Endpoint

```typescript
// server.ts: Add signed URL route
app.get("/api/media/:key", requireAuth, async (req, res) => {
  const objectKey = req.params.key;  // e.g., "b2://bucket/models/123-uuid.glb"
  const userPhone = req.user.phone;
  
  // Verify ownership
  const metadata = await getObjectMetadata(objectKey);
  if (metadata.ownerPhone !== userPhone) {
    return res.status(403).json({ error: "Access denied" });
  }
  
  // Generate signed URL
  const signedUrl = await generateSignedUrl(objectKey, { expiresIn: 3600 });
  res.redirect(signedUrl);
});
```

#### 3. Bucket Policy Changes

**B2 Bucket Configuration:**
- ACL: private (no public-read)
- List files: disabled
- Public access: blocked
- CORS: restricted to `https://pawsome3d.com` only

#### 4. Migration Script

**For existing data:**
1. Scan all existing objects
2. For each object with owner reference in DB:
   - Set metadata: `owner-phone`, `upload-timestamp`
   - Revoke public access
3. For objects without owner reference:
   - Mark as `orphaned`
   - Delete after 30-day grace period

---

## EVIDENCE REQUIREMENTS (P3 Exit Gate)

| Item | Format | Source |
|------|--------|--------|
| Private bucket policy | Export + redacted screenshot | B2 Console |
| Signed URL expiry test | Test report | Automated test |
| Ownership verification | Test matrix | `tests/p3_isolation.test.mjs` |
| Legacy migration report | CSV + summary | Migration script output |

---

## IMMEDIATE P0 ACTIONS

### Recommended: Document and Plan

1. **Document current state:**
   - ✅ This assessment
   - List all endpoints returning public URLs
   - Count objects currently public

2. **Verify bucket listing is disabled:**
   ```bash
   # Test if bucket can be listed
   curl "https://YOUR_BUCKET.b2api.com/v1/b2_api/v2/list_keys"
   # Should fail without auth
   ```

3. **Add monitoring alert:**
   - Track any requests that fail due to missing ownership
   - Log potential enumeration attempts

4. **P3 schedule:**
   - Budget 9 days for full implementation
   - Plan maintenance window for migration
   - Prepare rollback plan

---

## RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Unauthorized media access | Medium | High | P3 migration required |
| Bucket enumeration | Low | Medium | Disable list permission |
| URL guessing attacks | Medium | Medium | UUID filenames help |
| Data exposure compliance | Low | Critical | P3 required before public beta |

---

## RECOMMENDATION

**Do NOT enable rig feature (PETSIM_RIG_ENABLED=false) until P3 complete**

Current state (public media) violates hardening plan H3 requirements. Until P3 migration is complete:
- Keep all expensive features disabled
- Treat all media as potentially public
- Do not deploy to production with sensitive user data

---

**Next Steps:**
1. Review this assessment
2. Decide if immediate bucket hardening is feasible
3. If not, schedule P3 migration before enabling rig
4. Update P0 evidence register with this finding

---

**Document Created:** 2026-07-13  
**Status:** Awaiting P3 implementation planning
