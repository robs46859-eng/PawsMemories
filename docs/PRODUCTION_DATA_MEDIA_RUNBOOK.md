# Production Data, Media, and Video Runbook

Status: implementation foundation in progress. This document does not authorize
production provider calls or claim a production deployment has occurred.

## Chosen topology

| Responsibility | Chosen service | Reason |
| --- | --- | --- |
| Primary relational database | Hostinger MySQL | The application and its atomic paid-usage transactions are already MySQL-specific. Migrating to PostgreSQL during AR hardening would replace tested concurrency behavior and increase launch risk. |
| Private media bytes | Backblaze B2, private bucket | S3-compatible uploads and short-lived pre-signed downloads fit the existing AWS SDK integration. Object ownership remains in MySQL. |
| Public web/API process | Existing Hostinger Node deployment | Keeps the API close to the current MySQL database and preserves the established ZIP deployment path. |
| Blender/IFC and long-running workers | Render background/private services | Isolates CPU-heavy work from the public web process. Render disk is scratch/workspace storage only; final media belongs in B2. |

Do not self-host a second MySQL instance on a Render persistent disk for this
release. It creates another backup and failover system while the application
already has a working MySQL contract.

If a Render service must connect directly to Hostinger MySQL, allowlist only the
service's published outbound CIDR ranges (or dedicated outbound IPs). Never use
Hostinger's **Any Host** option. Hostinger documents remote MySQL IP allowlisting
and port 3306; Render documents that outbound ranges are region-specific.

References:

- https://www.hostinger.com/support/1583546-how-to-set-up-remote-mysql-access-in-hostinger/
- https://render.com/docs/outbound-ip-addresses
- https://render.com/docs/disks

## Media ownership model

New generated video output follows this path:

1. The authenticated API validates the request and confirms ownership of the source creation.
2. An atomic MySQL reservation enforces the per-user request cap, global request cap, and global dollar cap.
3. The provider creates a supported-duration video.
4. The API downloads a bounded MP4, measures its duration, hashes it, and uploads it without an object ACL to the private B2 bucket.
5. MySQL stores the owner, opaque B2 object key, MIME type, byte count, and SHA-256 digest.
6. The API issues a short-lived pre-signed GET URL only after another ownership check.

Backblaze documents that object-level ACLs are not supported and that private
buckets support pre-signed upload/download URLs:
https://www.backblaze.com/docs/cloud-storage-s3-compatible-api

Legacy creation URLs remain readable during the migration. New video output is
the first media type moved behind the private-object boundary. Images, models,
Animator recordings, and existing rows must be migrated separately and must not
be reported as private until that work is complete.

## Video launch contract

- Provider/model: Veo 3.1 Fast preview through the existing Gemini integration.
- Supported duration: 8 seconds, matching the current Veo 3.1 contract.
- Exact 10-second output remains a future add-on.
- Supported aspect ratios: 16:9 and 9:16.
- Every completed job records requested duration, measured duration, model, aspect ratio, and duration-validation status.
- A duration mismatch fails closed instead of being labeled as the requested duration.

At the current published 720p Fast price of $0.10 per generated second, an
8-second output is approximately $0.80. The launch reservation is $1.00 per
attempt to leave headroom. Current pricing:
https://ai.google.dev/gemini-api/docs/pricing

## Pawprints template storage

- Curated layout definitions: `content/pawprints/templates/*.json` in Git.
- Loader and validation: `server/pawprintTemplates.ts`.
- Optional reviewed, reusable preview art: `public/pawprints/templates/<template-id>/`.
- User-uploaded photos, rendered cards, and generated videos: private B2 objects owned through MySQL.
- Future admin-authored templates: publish state/version in MySQL, binary assets in B2, with an exported JSON version retained for rollback.

The initial registry contains Hero, Split Screen, Polaroid/Floating Card, and
Grid/Collage layouts. Template JSON contains layout and customization metadata,
not user media or credentials.

The launch Pawprints renderer accepts JPEG, PNG, and WebP photos and produces a
static PNG card. Looping-video or animated-stationery slots are future work and
must not be advertised until their duration, playback, accessibility, storage,
and export contracts are implemented and tested.

## Required production settings

Set secrets in the Hostinger/Render environment UI. Do not include `.env` in a
deployment ZIP or commit it.

```text
DB_HOST=<hostinger-mysql-host>
DB_PORT=3306
DB_NAME=<production-database>
DB_USER=<least-privilege-user>
DB_PASSWORD=<secret>

PRIVATE_MEDIA_BUCKET_NAME=<private-b2-bucket>
PRIVATE_MEDIA_BUCKET_URL=https://s3.<b2-region>.backblazeb2.com
PRIVATE_MEDIA_BUCKET_REGION=<b2-region>
PRIVATE_MEDIA_BUCKET_KEY=<restricted-application-key-id>
PRIVATE_MEDIA_BUCKET_SECRET=<restricted-application-key>
MEDIA_SIGNED_URL_TTL_SECONDS=300

PETSIM_RIG_ENABLED=false
```

Use a B2 application key restricted to the one media bucket. Confirm the bucket
is private before enabling video generation.

## Activation gates

1. Create or select the private B2 bucket and restricted key.
2. Apply the additive MySQL schema by starting the new build against staging.
3. Run the staging-only paid-usage abuse test and retain its output as evidence.
4. Generate one landscape and one portrait 8-second video with test accounts.
5. Confirm another user cannot retrieve either media object.
6. Confirm expired signed URLs fail and newly issued URLs work.
7. Confirm failed jobs restore app credits and never claim a completed duration.
8. Confirm the daily global dollar cap blocks additional provider calls.
9. Have a human review the videos, mobile/desktop playback, prompt safety, Pawprints output, and AR evidence.
10. Enable paid video endpoints only after that human approval.

Production remains blocked until gates 1-10 have evidence. Code-complete is not
the same as deployment-complete.
