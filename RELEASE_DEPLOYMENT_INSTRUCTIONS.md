# Schema 30 Release Deployment Instructions

Status: implementation closed; live-product debugging deferred to the next pass.

This release replaces the rejected deployment archive. Deploy the services in the
order below. Do not reuse an older zip and do not run any SQL manually.

## Release Contents

- Full-body human reference framing and fail-closed crop detection.
- Durable create/rig recovery with leases, attempt limits, source fingerprints,
  and idempotent refunds.
- Blender STL repair plus validation of the exact manufacturing export.
- Authenticated `physics_validate` worker operation.
- Visible Voice Test and Scaled BIM preview screens.
- Legacy marketplace and manual print-request panels removed from Shop routing.
- X-DM fallback polling disabled by default and stopped after authorization errors.
- Managed database schema version 30.

## Before Deployment

1. Use only the `pawsome3d-deploy.zip` supplied with this release.
2. Confirm the release commit is present on GitHub `main`.
3. Do not edit the zip, `package.json`, or generated manifest.
4. Do not run an SQL command. The main application applies additive migration 30
   during startup.
5. Keep all existing secrets unchanged.

## Step 1: Deploy The Render Blender Worker

Service:

- Name: `PawsMemories`
- Service ID: `srv-d8mpjr8k1i2s7390v8h0`
- Type: Docker
- URL: `https://pawsmemories.onrender.com`
- Repository: `robs46859-eng/PawsMemories`
- Branch: `main`

Instructions:

1. Open the Render service dashboard.
2. Open **Environment** and confirm `WORKER_SHARED_SECRET` is present. Do not
   generate a replacement unless the same new value will also be installed in
   Hostinger.
3. Confirm `IFC_MAX_CONCURRENT=1` and `PORT=10000` if those values are explicitly
   configured.
4. Select **Manual Deploy** then **Deploy latest commit**.
5. Wait until Render reports **Live**.
6. Open `https://pawsmemories.onrender.com/health`. It must return a successful
   health response.
7. A direct unauthenticated request to `/physics-validate` should return HTTP 401.
   That is expected and confirms the new endpoint is protected.

Do not deploy Hostinger until the worker is Live. The worker and main app contain
matching halves of the new print-validation contract.

## Step 2: Handle The Optional X-DM Service

The X-DM service is separate from the Blender worker.

If `pawsmemories-1` is unused:

1. Open that Render service.
2. Suspend or delete it.

If it must remain online:

1. Add `X_DM_POLLING_ENABLED=false` in that service's Render environment.
2. Deploy the latest `main` commit.
3. Confirm the logs say polling fallback is disabled and no longer emit a 401
   request every minute.

Do not add `X_DM_POLLING_ENABLED` to Hostinger or the Blender worker.

## Step 3: Confirm Hostinger Values

Open Hostinger hPanel, then **Websites > pawsome3d.com > Deployments > Settings >
Environment variables**.

Confirm these existing values:

| Variable | Required value or rule |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://pawsome3d.com` |
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `3306` |
| `BLENDER_WORKER_URL` | `https://pawsmemories.onrender.com/render` |
| `WORKER_SHARED_SECRET` | Exactly the same value as the Render Blender worker |
| `BIM_V2_ENABLED` | `false` |
| `VITE_BIM_V2_ENABLED` | `false` in the environment used to build the zip |
| `MODEL_BUILD_V3_ENABLED` | `false` |
| `RIG_PIPELINE_V4_ENABLED` | `false` |
| `FUR_BIN_V5_ENABLED` | `false` |
| `STATIONERY_V2_ENABLED` | `false` |
| `WAGS_V2_ENABLED` | `false` |

The Voice Test requires the existing `ELEVENLABS_API_KEY`. The optional
`ELEVENLABS_MODEL_ID` and `ELEVENLABS_DEFAULT_VOICE_ID` select the model and voice.
`RHUBARB_BIN` is optional and must be a filesystem path to an installed Linux
Rhubarb executable, not an SQL value.

No new Hostinger variable is introduced by schema 30.

## Step 4: Upload The Hostinger Package

1. In hPanel, open **Websites > pawsome3d.com > Deployments**.
2. Select **Upload new files**.
3. Upload the new `pawsome3d-deploy.zip` from the repository root.
4. Select **Redeploy**.
5. Wait for installation and startup to complete.
6. Confirm the deployment log shows the server started without a database
   migration, storage, or worker-configuration error.
7. Open `https://pawsome3d.com/readyz` and confirm the application reports ready.
8. Open `https://pawsome3d.com/version` and confirm it reports the new release
   commit and schema version 30.

The archive already contains the production client and server build. Hostinger's
staged `npm run build` is intentionally a verified no-op.

## Step 5: Close The Deployment

After both services are online:

1. Confirm the home page loads and sign-in opens.
2. Confirm Render is not repeatedly restarting.
3. Confirm Hostinger does not log repeated stale rig recovery work.
4. Confirm the X-DM service is suspended or quiet.

No additional acceptance test phase is required for this release. Full-body model,
physical checkout, voice, BIM, and visual debugging are deferred to the next pass.

## Rollback

If Hostinger fails to start:

1. Roll Hostinger back to the previous successful deployment.
2. Leave schema 30 in place; it is additive and older application code ignores its
   added columns.
3. Keep the new Blender worker online unless its own health check fails.

If the Blender worker fails:

1. Roll Render back to its previous successful deployment.
2. Do not deploy the schema 30 Hostinger package until the corrected worker is Live.

