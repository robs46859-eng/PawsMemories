import express from "express";
import compression from "compression";
import path from "path";
// Vite is imported dynamically below — only in dev mode
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import Stripe from "stripe";
import fs from "fs";
import twilio from "twilio";
import rateLimit from "express-rate-limit";
import { initDb, findUserByPhone, findUserByEmail, createUserByEmail, EmailTakenError, completeUserProfile, toPublicUser, deductCredits, addCredits, getCreditBalance, getCreditHistory, wasSessionCredited, getCommunityMemories, addCommunityMemory, setProfilePhoto, addUserPhoto, getUserPhotos, deleteUserPhoto, saveCreation, getCreations, getAllCreations, updateCreation, createJob, updateJobStatus, getJob, getRunningJobs, refundCredits, setCreationVideoUrl, setCreationModelUrl, getDailyVideoCount, isUserAdmin, addPet, getPets, updatePet, deletePet, createAlbum, getAlbums, createAvatar, updateAvatarModel, updateAvatarGenerationStatus, getAvatarById, getAvatars, feedAvatar, waterAvatar, giveTreatToAvatar, getAvatarNeeds, saveAvatarNeeds, getPlacedObjects, addPlacedObject, deletePlacedObject, updateAvatarRiggedModel, updateAvatarMultiview, parseMultiview, getPool, claimDailyStreak, claimAchievement, getPetProfileByAvatar, getPetProfileById, upsertPetProfile, savePetState, savePetRigUrls, getSemanticScan, saveSemanticScan, getPetCommands, addPetCommand, getPetButtons, addPetButton, incrementTrainerScore, updatePetSettings, bumpDailyUsage, getSceneActors, addSceneActor, updateSceneActor, deleteSceneActor } from "./db";
import { isEndpointEnabled, dailyCapFor, withinDailyCap, type PaidEndpoint } from "./server/paidApiGuards";
import { classifyPetImage, type GenerateFn } from "./server/petClassify";
import { semanticScan as runSemanticScan } from "./server/semanticScan";
import { animatorRouter } from "./server/animator/routes.ts";
import { startWorker as startAnimatorWorker } from "./server/animator/worker.ts";
import { phraseKey } from "./src/three/ar/voice";
import { decayCompliance, pointsForTrial, creditsFromPoints, type TrialType } from "./src/brain";
import { createHash } from "crypto";
import { resolveBreedProfile } from "./server/breedProfiles";
import { decayDrives, DEFAULT_DRIVES, DEFAULT_HORMONES, weightsFromTemperament } from "./src/brain";
import { uploadBase64Image, uploadBinaryFromUrl, fetchUrlAsBase64, uploadBase64Binary } from "./storage";
import { runBuildPipeline } from "./agent/graph/orchestrator";
import { analyzePetImage, type PetAnalysis } from "./ollama-agent";
import { getBlenderClient } from "./agent/tools/blender_client";
import { startTalkingVideo, pollTalkingVideo, fetchMp4AsDataUrl, isHeyGenHandle } from "./heygen";
import { startImageTo3D, pollImageTo3D, isTripoHandle, startRig, pollTripoTask, isTripoInsufficientCredit } from "./tripo";
import { checkBudget, needsRetargetFallback, type BakeStats } from "./server/rigBudget";
import { registerSnapgenRoutes } from "./server/snapgen";
import { SKELETON_CONTRACTS } from "./skeletonContract";
import { buildReferencePrompt, turnaroundViewsForType, paletteLockClause, extractPaletteInstruction, buildTextPrompt, geometryToTripo, type TextPromptFields, type SubjectClass } from "./avatarPrompts";
import { triageReferenceImage, triagePasses, correctiveFromTriage, friendlyQualifyError, isClassMismatch, classLabel, type TriageResult } from "./server/imageTriage";
import { objectBuildProfile, humanRigHints } from "./server/subjectProfiles";
import {
  signToken,
  requireAuth,
  hashPassword,
  verifyPassword,
  type AuthedRequest,
} from "./auth";

dotenv.config();

async function startServer() {
  const app = express();
  // Gzip/deflate every text response (JSON, JS, CSS, HTML). The main bundle is
  // ~1.7MB raw → ~490KB on the wire. Must be mounted before route/static handlers.
  app.use(compression());
  // Hostinger runs the app behind a reverse proxy (LiteSpeed) which sets
  // X-Forwarded-For. Without this, express-rate-limit throws
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and rate-limits by proxy IP.
  app.set("trust proxy", 1);
  const PORT = Number(process.env.PORT) || 3000;

  process.on("unhandledRejection", (reason) => {
    console.error("[FATAL] Unhandled rejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[FATAL] Uncaught exception:", err);
  });

  // Fix 3: JWT_SECRET startup guard — refuse to start with an insecure empty secret.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "MY_JWT_SECRET" || process.env.JWT_SECRET.length < 16) {
    console.error("❌ FATAL: JWT_SECRET is missing or too short. Set a long random string in your .env file.");
    process.exit(1);
  }

  // Initialize the user database (creates the users table if needed)
  await initDb();

  // Reaper: recover avatars stranded in an intermediate generation state.
  // The build runs as fire-and-forget work; if the process is recycled mid-build
  // a row can freeze in rigging/retargeting/baking_*, after which the status
  // endpoint reports "generating" forever and /retry used to refuse. This flips
  // stale rows to a terminal state: "done" if a model was already produced,
  // otherwise "failed" (which is retryable). Threshold is generous so it never
  // touches a genuinely in-progress build.
  async function reapStuckAvatars() {
    try {
      const [result]: any = await getPool().query(
        `UPDATE avatars
            SET generation_status = CASE WHEN model_url IS NOT NULL AND model_url <> '' THEN 'done' ELSE 'failed' END,
                generation_error  = CASE WHEN model_url IS NOT NULL AND model_url <> '' THEN generation_error
                                         ELSE 'Generation stalled and was auto-recovered by the reaper.' END
          WHERE generation_status IN ('rigging','retargeting','baking_clips','baking_sprites')
            AND created_at < (NOW() - INTERVAL 45 MINUTE)`
      );
      if (result?.affectedRows) {
        console.log(`[Reaper] Recovered ${result.affectedRows} stalled avatar(s).`);
      }
    } catch (err: any) {
      console.warn(`[Reaper] Failed to reap stuck avatars: ${err?.message || err}`);
    }
  }
  reapStuckAvatars();
  setInterval(reapStuckAvatars, 5 * 60 * 1000);

  // Initialize Stripe client safely
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let stripe: Stripe | null = null;
  if (stripeSecretKey && stripeSecretKey !== "MY_STRIPE_SECRET_KEY" && stripeSecretKey !== "") {
    stripe = new Stripe(stripeSecretKey);
  } else {
    console.warn("⚠️ STRIPE_SECRET_KEY is missing or invalid. Server will run in Sandbox Simulation mode.");
  }

  // Local persistent order saving
  const ORDERS_FILE = path.join(process.cwd(), "orders.json");
  const saveOrder = (order: any) => {
    try {
      let orders: any[] = [];
      if (fs.existsSync(ORDERS_FILE)) {
        const data = fs.readFileSync(ORDERS_FILE, "utf-8");
        orders = JSON.parse(data);
      }
      orders.push(order);
      fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
      console.log(`Order ${order.orderId} saved successfully to orders.json`);
    } catch (err) {
      console.error("Failed to save order to local orders.json file:", err);
    }
  };

  // Stripe Webhook Route (must be registered BEFORE global express.json body parser)
  app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    
    if (!stripe || !stripeWebhookSecret) {
      console.warn("Stripe or Stripe Webhook Secret not configured. Webhook ignored.");
      return res.status(400).send("Webhook secret not configured");
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig as string, stripeWebhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const handleSuccessfulPayment = async (session: Stripe.Checkout.Session) => {
      const metadata = session.metadata;
      if (!metadata) return;

      if (metadata.type === "credit_purchase" && metadata.userPhone && metadata.creditsToAdd) {
        const creditsToAdd = parseInt(metadata.creditsToAdd, 10);
        // Idempotency: skip if the redirect-confirm path already credited this session.
        if (await wasSessionCredited(session.id)) {
          console.log(`↩︎ Session ${session.id} already credited; webhook skipping.`);
        } else {
          await addCredits(metadata.userPhone, creditsToAdd, "purchase:" + session.id);
          console.log(`✅ Added ${creditsToAdd} credits to ${metadata.userPhone} via Stripe purchase.`);
        }
      } else {
        // Standard physical album order
        const order = {
          orderId: `ord_${Date.now()}`,
          creationId: metadata.creationId,
          creationName: metadata.creationName,
          style: metadata.style,
          creditsDeducted: parseInt(metadata.creditsDeducted || "800", 10),
          cashPaid: parseFloat(metadata.cashPaid || "12.00"),
          shippingName: metadata.shippingName,
          shippingAddress: metadata.shippingAddress,
          shippingCity: metadata.shippingCity,
          shippingState: metadata.shippingState,
          shippingZip: metadata.shippingZip,
          shippingCountry: metadata.shippingCountry,
          createdAt: new Date().toISOString(),
          status: "pending",
          stripeSessionId: session.id,
          mode: "live_stripe"
        };
        saveOrder(order);

        if (metadata.userPhone) {
          await deductCredits(metadata.userPhone, parseInt(metadata.creditsDeducted || "800", 10));
          console.log(`✅ Deducted ${metadata.creditsDeducted} credits from ${metadata.userPhone} for album order.`);
        }
      }
    };

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`Checkout session completed: ${session.id}, status: ${session.payment_status}`);
      if (session.payment_status === "paid") {
        await handleSuccessfulPayment(session);
      }
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`Async payment succeeded: ${session.id}`);
      await handleSuccessfulPayment(session);
    }

    res.json({ received: true });
  });

  // Content Security Policy — strict but permits what the app needs
  app.use((_req, res, next) => {
    const bucketEndpointUrl = new URL(process.env.MEDIA_BUCKET_URL || "https://example.invalid");
    const bucketOrigin = bucketEndpointUrl.origin;
    // storage.ts builds public URLs virtual-host style: https://<bucket>.<endpoint-host>/...
    // That is a DIFFERENT origin from the raw endpoint, so both must be allowed or
    // every GLB fetch (model-viewer, GLTFLoader) is blocked by connect-src
    // ("TypeError: Failed to fetch" in the browser, avatar never renders).
    const bucketPublicOrigin = process.env.MEDIA_BUCKET_NAME
      ? `${bucketEndpointUrl.protocol}//${process.env.MEDIA_BUCKET_NAME}.${bucketEndpointUrl.host}`
      : bucketOrigin;
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.google.com https://*.googleapis.com https://ajax.googleapis.com https://cdn.jsdelivr.net",
        // ajax.googleapis.com serves <model-viewer>; cdn.jsdelivr.net serves the 8th Wall AR engine.
        "script-src-elem 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.google.com https://ajax.googleapis.com https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://maps.googleapis.com",
        "worker-src 'self' blob:",
        `img-src 'self' blob: data: https: http://localhost:*`,
        `media-src 'self' blob: ${bucketOrigin} ${bucketPublicOrigin}`,
        // blob:/data: needed by model-viewer for AR (USDZ/scene-viewer export) and texture loading.
        `connect-src 'self' blob: data: https://maps.googleapis.com https://*.googleapis.com https://maps.google.com https://cdn.jsdelivr.net ${bucketOrigin} ${bucketPublicOrigin}`,
        "font-src 'self' https://fonts.gstatic.com data:",
        "frame-src 'self' https://*.google.com https://js.stripe.com",
      ].join("; ")
    );
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: "Too many requests from this IP, please try again after a minute" } });
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/signup", authLimiter);
  app.use("/api/create-video", authLimiter);

  // SnapGen (pic-to-3D storefront) routes — see server/snapgen.ts
  registerSnapgenRoutes(app);

  // GUARD RULE (§6.1): Any authentication guard mounted on a shared prefix
  // (like "/api") MUST be strictly path-scoped to the namespaces it intends to protect.
  // Do NOT mount a blanket `requireAuth` on "/api" or you will inadvertently block
  // public routes (like /api/auth/login and /api/auth/signup). Furthermore, ensure
  // public routes are registered BEFORE any shared-prefix catch-all or guard to ensure
  // they remain reachable regardless of registration order.
  // 
  // Here, we guard ONLY the animator + scenes namespaces so public routes stay reachable.
  app.use(
    "/api",
    (req, res, next) => {
      if (req.path.startsWith("/animator") || req.path.startsWith("/scenes")) {
        return requireAuth(req as AuthedRequest, res, next);
      }
      return next();
    },
    animatorRouter
  );

  // Serve animator files statically
  app.use("/animator-files", express.static(path.join(process.cwd(), "data", "animator")));
  
  if (process.env.ANIMATOR_WORKER_ENABLED !== "false") {
    startAnimatorWorker();
  }

  // requireAuth so req.user is populated for the key. (H2)
  const paidLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => req.user?.phone || "anon",
    message: { error: "Too many requests. Please slow down and try again in a minute." },
  });

  /**
   * Kill-switch + per-user daily-cap guard for a paid AR endpoint (H2/H7).
   * Returns true if the caller may proceed. Call AFTER cache/ownership checks
   * so cached hits and validation failures never consume paid quota.
   */
  const guardPaidCall = async (
    ep: PaidEndpoint,
    req: AuthedRequest,
    res: express.Response,
  ): Promise<boolean> => {
    if (!isEndpointEnabled(ep)) {
      res.status(503).json({ error: "This feature is temporarily unavailable. Please try again later.", endpoint: ep });
      return false;
    }
    const used = await bumpDailyUsage(req.user!.phone, ep);
    if (!withinDailyCap(ep, used)) {
      const cap = dailyCapFor(ep);
      res.status(429).json({ error: `Daily limit reached (${cap}/day for ${ep}). Please try again tomorrow.`, endpoint: ep, cap });
      return false;
    }
    return true;
  };

  // ---------------------------------------------------------------------------
  // Authentication: email/password + session tokens (JWT)
  // ---------------------------------------------------------------------------

  // Step 1: create an account with email + password (profile still incomplete).
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      const confirmPassword = String(req.body?.confirmPassword || "");

      if (!email || !password || !confirmPassword) {
        return res.status(400).json({ error: "Email, password, and confirmation are required." });
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: "Please enter a valid email address." });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match." });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
      }

      const passwordHash = hashPassword(password);
      const user = await createUserByEmail(email, passwordHash);
      const token = signToken({ phone: user.phone, uid: user.id });
      res.json({ success: true, token, user: toPublicUser(user) });
    } catch (err: any) {
      if (err instanceof EmailTakenError) {
        return res.status(409).json({ error: err.message });
      }
      console.error("signup error:", err?.message || err);
      res.status(500).json({ error: "Could not create your account. Please try again." });
    }
  });

  // Step 2: required profile setup (name, birthdate, city, pets). Grants the 50 free credits.
  app.post("/api/auth/complete-profile", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const fullName = String(req.body?.fullName || "").trim();
      const birthdate = String(req.body?.birthdate || "");
      const city = String(req.body?.city || "").trim();

      if (!fullName || !birthdate || !city) {
        return res.status(400).json({ error: "Full name, birthdate, and city are required." });
      }

      const dob = new Date(birthdate);
      const ageDifMs = Date.now() - dob.getTime();
      const ageDate = new Date(ageDifMs);
      const age = Math.abs(ageDate.getUTCFullYear() - 1970);
      if (age < 13) {
         return res.status(400).json({ error: "You must be at least 13 years old to use Paws & Memories." });
      }

      const user = await completeUserProfile(req.user!.phone, fullName, birthdate, city);

      const pets = req.body?.pets;
      if (Array.isArray(pets)) {
        for (const pet of pets) {
          if (pet.name && pet.kind) {
            await addPet(req.user!.phone, pet.name, pet.kind);
          }
        }
      }

      res.json({ success: true, user: toPublicUser(user) });
    } catch (err: any) {
      console.error("complete-profile error:", err?.message || err);
      res.status(500).json({ error: "Could not save your profile. Please try again." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

      // ORDER BY id makes the lookup deterministic even if legacy duplicate-email rows still exist.
      const [rows] = await getPool().query("SELECT * FROM users WHERE email = ? ORDER BY id LIMIT 1", [email]) as any;
      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: "Invalid email or password." });
      }
      const user = rows[0];
      if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      const token = signToken({ phone: user.phone, uid: user.id });
      res.json({ success: true, token, user: toPublicUser(user) });
    } catch (err: any) {
      console.error("login error:", err);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });

  app.get("/api/me", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = await findUserByPhone(req.user!.phone);
      if (!user) return res.status(404).json({ error: "User not found." });
      res.json({ user: toPublicUser(user) });
    } catch (err: any) {
      console.error("me error:", err?.message || err);
      res.status(500).json({ error: "Could not load your account." });
    }
  });

  app.post("/api/streak/claim", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const result = await claimDailyStreak(req.user!.phone);
      if (!result.success) return res.status(400).json({ success: false, error: "Streak already claimed today" });
      const user = await findUserByPhone(req.user!.phone);
      res.json({ success: true, user: toPublicUser(user) });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to claim streak" });
    }
  });

  app.post("/api/achievements/claim", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { id } = req.body;
      const result = await claimAchievement(req.user!.phone, id);
      if (!result.success) return res.status(400).json({ success: false, error: "Already claimed" });
      const user = await findUserByPhone(req.user!.phone);
      res.json({ success: true, user: toPublicUser(user) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to claim achievement" });
    }
  });

  // Redirect-confirm fallback: after Stripe checkout, the browser lands on
  // success_url with ?session_id=. This verifies the session server-side and
  // credits it if the webhook hasn't already — so a misconfigured/failed webhook
  // can never silently swallow a purchase. Idempotent with the webhook via the
  // "purchase:<sessionId>" ledger key.
  app.get("/api/credits/confirm", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) return res.status(400).json({ success: false, error: "Missing session_id" });
      if (!stripe) {
        return res.json({ success: true, credited: 0, balance: await getCreditBalance(req.user!.phone) });
      }
      if (await wasSessionCredited(sessionId)) {
        return res.json({ success: true, alreadyCredited: true, balance: await getCreditBalance(req.user!.phone) });
      }
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const md = session.metadata || {};
      const creditsToAdd = parseInt(md.creditsToAdd || "0", 10);
      if (session.payment_status !== "paid" || md.type !== "credit_purchase" || md.userPhone !== req.user!.phone || !creditsToAdd) {
        return res.status(400).json({ success: false, error: "Session not eligible for crediting." });
      }
      await addCredits(req.user!.phone, creditsToAdd, "purchase:" + sessionId);
      res.json({ success: true, credited: creditsToAdd, balance: await getCreditBalance(req.user!.phone) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: "Failed to confirm purchase." });
    }
  });

  // Credit transaction history — powers spend tracking / the Profile ledger.
  app.get("/api/credits/history", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const history = await getCreditHistory(req.user!.phone, 25);
      res.json({ history });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load credit history" });
    }
  });

  // Server-persisted share reward. Capped per day (via the ledger) to prevent farming.
  const SHARE_REWARD = 3;
  const SHARE_DAILY_CAP = 3;
  app.post("/api/credits/reward", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { platform } = req.body || {};
      const platformName = typeof platform === "string" && platform ? platform.slice(0, 40) : "share";
      const today = new Date().toISOString().split("T")[0];
      const [rows] = await getPool().query(
        `SELECT COUNT(*) AS c FROM credit_transactions
          WHERE user_phone = ? AND reason LIKE 'share_reward%' AND DATE(created_at) = ?`,
        [req.user!.phone, today]
      ) as any;
      if (Number(rows?.[0]?.c || 0) >= SHARE_DAILY_CAP) {
        return res.status(429).json({ success: false, error: "Daily share reward limit reached" });
      }
      await addCredits(req.user!.phone, SHARE_REWARD, `share_reward:${platformName}`);
      const user = await findUserByPhone(req.user!.phone);
      res.json({ success: true, reward: SHARE_REWARD, user: toPublicUser(user) });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to grant reward" });
    }
  });

  // ---------------------------------------------------------------------------
  // Community endpoints (Local Info + Memory Board). All degrade gracefully so
  // the Community page never breaks if an upstream API is down or unconfigured.
  // ---------------------------------------------------------------------------

  const weatherCodeToText = (code: number): string => {
    const m: Record<number, string> = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
      61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow",
      75: "Heavy snow", 80: "Rain showers", 81: "Rain showers", 82: "Violent showers",
      95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Thunderstorm w/ hail",
    };
    return m[code] ?? "—";
  };

  // Nearby parks via Google Places Nearby Search (server key).
  app.get("/api/community/parks", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { lat, lng } = req.query;
      const key = process.env.GOOGLE_MAPS_API_KEY_SERVER;
      if (!lat || !lng || !key) return res.json({ parks: [] });
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=6000&type=park&key=${key}`;
      const r = await fetch(url);
      const j: any = await r.json().catch(() => ({}));
      const parks = (j.results || []).slice(0, 8).map((p: any) => ({
        name: p.name,
        address: p.vicinity || "",
        rating: p.rating ?? null,
        open: p.opening_hours?.open_now ?? null,
      }));
      res.json({ parks });
    } catch {
      res.json({ parks: [] });
    }
  });

  // Weather: try Google Weather API, fall back to free open-meteo so it always renders.
  app.get("/api/community/weather", requireAuth, async (req: AuthedRequest, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.json({ weather: null });
    const key = process.env.GOOGLE_MAPS_API_KEY_SERVER;
    if (key) {
      try {
        const gUrl = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${key}&location.latitude=${lat}&location.longitude=${lng}`;
        const r = await fetch(gUrl);
        if (r.ok) {
          const j: any = await r.json();
          const tempC = j?.temperature?.degrees;
          if (typeof tempC === "number") {
            return res.json({ weather: {
              tempC: Math.round(tempC),
              tempF: Math.round(tempC * 9 / 5 + 32),
              condition: j?.weatherCondition?.description?.text || "—",
              source: "google",
            } });
          }
        }
      } catch { /* fall through to open-meteo */ }
    }
    try {
      const oUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code`;
      const r = await fetch(oUrl);
      const j: any = await r.json();
      const t = j?.current?.temperature_2m;
      if (typeof t === "number") {
        return res.json({ weather: {
          tempC: Math.round(t),
          tempF: Math.round(t * 9 / 5 + 32),
          condition: weatherCodeToText(j?.current?.weather_code),
          source: "open-meteo",
        } });
      }
    } catch { /* ignore */ }
    res.json({ weather: null });
  });

  // Pet-related recall news via openFDA food enforcement (free, no key).
  app.get("/api/community/recalls", requireAuth, async (_req: AuthedRequest, res) => {
    try {
      const url = `https://api.fda.gov/food/enforcement.json?search=product_description:(pet+dog+cat+animal)&sort=recall_initiation_date:desc&limit=8`;
      const r = await fetch(url);
      const j: any = await r.json().catch(() => ({}));
      const recalls = (j.results || []).map((x: any) => ({
        product: (x.product_description || "Pet product").slice(0, 160),
        reason: (x.reason_for_recall || "").slice(0, 200),
        company: x.recalling_firm || "",
        date: x.recall_initiation_date || "",
        classification: x.classification || "",
      }));
      res.json({ recalls });
    } catch {
      res.json({ recalls: [] });
    }
  });

  // Community memory board: list + upload.
  app.get("/api/community/memories", requireAuth, async (_req: AuthedRequest, res) => {
    try {
      res.json({ memories: await getCommunityMemories(30) });
    } catch {
      res.json({ memories: [] });
    }
  });

  app.post("/api/community/memories", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { image, caption } = req.body || {};
      if (!image || typeof image !== "string" || !image.startsWith("data:image")) {
        return res.status(400).json({ error: "A photo is required." });
      }
      const imageUrl = await uploadBase64Image(image);
      const id = await addCommunityMemory(req.user!.phone, imageUrl, typeof caption === "string" ? caption : null);
      res.json({ success: true, memory: { id, image_url: imageUrl, caption: caption || null } });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to share memory." });
    }
  });

  // ---------------------------------------------------------------------------
  // Scene Backgrounds (Phase 5)
  // ---------------------------------------------------------------------------
  app.post("/api/scenes/backgrounds", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { type, locationUrl, uploadDataUrl, prompt } = req.body;
      let finalDataUrl: string | null = null;
      
      if (type === "location" && locationUrl) {
        // e.g. from /api/landmarks
        finalDataUrl = await fetchUrlAsBase64(locationUrl);
      } else if (type === "upload" && uploadDataUrl) {
        if (!uploadDataUrl.startsWith("data:image")) {
          return res.status(400).json({ error: "Invalid image data url" });
        }
        finalDataUrl = uploadDataUrl;
      } else if (type === "prompt" && prompt) {
        finalDataUrl = await generateImageWithFallback([{ text: prompt }], "scene-background");
      } else {
        return res.status(400).json({ error: "Valid type (location|upload|prompt) and payload required" });
      }

      if (!finalDataUrl) {
        return res.status(500).json({ error: "Failed to resolve background image" });
      }

      // Save to local scenes/backgrounds + mirror to B2 via uploadBase64Image
      const imageUrl = await uploadBase64Image(finalDataUrl);
      const bgId = require("uuid").v4();
      
      // We also store it in the workspace for consistency
      const match = finalDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (match) {
        const { resolveWithinWorkspace } = require("./server/animator/paths.ts");
        const fs = require("fs");
        const ext = match[1].includes("png") ? ".png" : ".jpg";
        const localPath = resolveWithinWorkspace(`scenes/backgrounds/${bgId}${ext}`);
        fs.writeFileSync(localPath, Buffer.from(match[2], "base64"));
      }

      res.json({ success: true, bgId, imageUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to prepare background" });
    }
  });


  // ---------------------------------------------------------------------------
  // User photo library: profile thumbnail + add/remove gallery.
  // ---------------------------------------------------------------------------

  // Set (or replace) the profile thumbnail. Also files it into the photo library.
  app.post("/api/profile/photo", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { image } = req.body || {};
      if (!image || typeof image !== "string" || !image.startsWith("data:image")) {
        return res.status(400).json({ error: "A photo is required." });
      }
      const url = await uploadBase64Image(image);
      await setProfilePhoto(req.user!.phone, url);
      await addUserPhoto(req.user!.phone, url, "profile");
      const user = await findUserByPhone(req.user!.phone);
      res.json({ success: true, user: toPublicUser(user) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update profile photo." });
    }
  });

  app.get("/api/profile/photos", requireAuth, async (req: AuthedRequest, res) => {
    try {
      res.json({ photos: await getUserPhotos(req.user!.phone) });
    } catch {
      res.json({ photos: [] });
    }
  });

  app.post("/api/profile/photos", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { image } = req.body || {};
      if (!image || typeof image !== "string" || !image.startsWith("data:image")) {
        return res.status(400).json({ error: "A photo is required." });
      }
      const url = await uploadBase64Image(image);
      const id = await addUserPhoto(req.user!.phone, url, "upload");
      res.json({ success: true, photo: { id, image_url: url, source: "upload" } });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to add photo." });
    }
  });

  app.delete("/api/profile/photos/:id", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const ok = await deleteUserPhoto(Number(req.params.id), req.user!.phone);
      res.json({ success: ok });
    } catch {
      res.status(500).json({ success: false, error: "Failed to delete photo." });
    }
  });

  // --- Pets Endpoints ---
  app.get("/api/pets", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const pets = await getPets(req.user!.phone);
      res.json({ pets });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch pets." });
    }
  });

  app.post("/api/pets", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { name, kind } = req.body;
      if (!name || !kind) return res.status(400).json({ error: "Name and kind required." });
      const id = await addPet(req.user!.phone, name, kind);
      res.json({ success: true, id });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to add pet." });
    }
  });

  app.put("/api/pets/:id", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { name, kind } = req.body;
      const success = await updatePet(Number(req.params.id), req.user!.phone, name, kind);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update pet." });
    }
  });

  app.delete("/api/pets/:id", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const success = await deletePet(Number(req.params.id), req.user!.phone);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete pet." });
    }
  });

  // --- Avatar Endpoints ---
  app.get("/api/avatars", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const avatars = await getAvatars(req.user!.phone);
      res.json({ avatars });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch avatars." });
    }
  });

  /**
   * Layer 1 of avatar generation: fuse one or more pet photos into a single
   * hyper-realistic reference image (standing on all 4 legs, facing forward,
   * slight panting expression) that is then fed to the image-to-3D pipeline.
   * Returns a data URL, or null if generation fails (caller falls back to first photo).
   */
  /**
   * COLOR-COORDINATION LOCK. Extract a short, explicit palette descriptor from
   * the approved front view and inject it verbatim into every turnaround prompt
   * so all four views share exactly the same colours. Colour drift between views
   * is the #1 failure mode of multiview-to-3D, producing muddy/striped textures.
   */
  async function extractPalette(frontDataUrl: string, type: SubjectClass): Promise<string | null> {
    const m = frontDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (!m) return null;
    const part = { inlineData: { data: m[2], mimeType: m[1] } };
    const instruction = extractPaletteInstruction(type);
    for (const model of ["gemini-2.5-flash", "gemini-2.0-flash-exp"]) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [part, { text: instruction }] },
        });
        const text = (response.text || "").trim().replace(/\s+/g, " ");
        if (text) return text.slice(0, 300);
      } catch (err) {
        console.warn(`[palette] ${model} failed:`, err);
      }
    }
    return null;
  }

  // Best-first image model chain (Nano Banana family, per ai.google.dev/models).
  //  - gemini-3-pro-image      = Nano Banana Pro  (state-of-the-art, studio 4K) → best quality
  //  - gemini-3.1-flash-image  = Nano Banana 2    (fast, production-scale)
  //  - gemini-2.5-flash-image  = Nano Banana      (older, known generateContent-compatible fallback)
  // Override without a redeploy via GEMINI_IMAGE_MODELS (comma-separated).
  const IMAGE_MODELS: string[] = (process.env.GEMINI_IMAGE_MODELS ||
    "gemini-3-pro-image,gemini-3.1-flash-image,gemini-2.5-flash-image")
    .split(",").map((s) => s.trim()).filter(Boolean);

  /**
   * Generate one image from parts with model fallback; returns a data URL or null.
   *
   * CRITICAL: image output from `generateContent` requires
   * `config.responseModalities` to include "IMAGE" — without it the model returns
   * TEXT only, no inlineData part, and the whole avatar pipeline silently produces
   * nothing (and never uploads to Backblaze). Aspect-ratio control is only honoured
   * by `gemini-2.5-flash-image`, so `imageConfig` is sent only to that model.
   */
  async function generateImageWithFallback(
    parts: any[],
    label: string,
    errRef?: { code?: number | string; message?: string; quota?: boolean }
  ): Promise<string | null> {
    for (const model of IMAGE_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          // responseModalities MUST include IMAGE or the model returns text only.
          // All current Nano Banana models honour imageConfig.aspectRatio.
          config: {
            responseModalities: ["IMAGE", "TEXT"],
            imageConfig: { aspectRatio: "1:1" },
          },
        });
        const cand: any = response.candidates?.[0];
        const outParts: any[] = cand?.content?.parts || [];
        for (const part of outParts) {
          if (part.inlineData?.data) {
            const mt = part.inlineData.mimeType || "image/png";
            return `data:${mt};base64,${part.inlineData.data}`;
          }
        }
        // No image part — surface WHY so this never fails silently again.
        const finish = cand?.finishReason || "unknown";
        const block = (response as any)?.promptFeedback?.blockReason;
        let txt = "";
        try { txt = (response.text || "").slice(0, 160); } catch { /* no text accessor */ }
        console.warn(`[${label}] ${model} returned no image part (finishReason=${finish}${block ? ", block=" + block : ""}). text="${txt}"`);
        if (errRef) errRef.message = `no image part from ${model} (finishReason=${finish}${block ? ", block=" + block : ""})`;
      } catch (err: any) {
        const msg = err?.message || String(err);
        const code = err?.status ?? err?.code;
        const quota = /RESOURCE_EXHAUSTED|resource_?exhausted|depleted|quota|too_many_requests|\b429\b/i.test(msg) || code === 429;
        if (errRef) { errRef.code = code; errRef.message = msg; errRef.quota = errRef.quota || quota; }
        console.warn(`[${label}] ${model} failed:`, msg);
      }
    }
    console.error(`[${label}] all image models failed to return an image.`);
    return null;
  }

  /**
   * Generate the full turnaround (left side, back, right side) from the front
   * view, with the palette lock injected so all four views stay colour-matched.
   * Returns whatever views succeeded — the Tripo caller degrades gracefully.
   */
  async function generateTurnaroundViews(
    frontDataUrl: string,
    palette: string | null,
    type: SubjectClass
  ): Promise<Partial<Record<"left" | "back" | "right", string>>> {
    const m = frontDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (!m) return {};
    const frontPart = { inlineData: { data: m[2], mimeType: m[1] } };
    const lock = paletteLockClause(type, palette);
    const views = turnaroundViewsForType(type);
    const results = await Promise.all(
      views.map(async ({ view, prompt }) => {
        const img = await generateImageWithFallback(
          [frontPart, { text: prompt + lock + " Respond with only the generated image." }],
          `turnaround:${view}`
        );
        return [view, img] as const;
      })
    );
    const out: Partial<Record<"left" | "back" | "right", string>> = {};
    for (const [view, img] of results) if (img) out[view] = img;
    return out;
  }

  async function generatePetReferenceImage(
    photos: string[],
    accent: string | null | undefined,
    type: SubjectClass,
    hasFacePhoto?: boolean,
    extra?: string,
    errRef?: { code?: number | string; message?: string; quota?: boolean },
    style?: string | null,
  ): Promise<string | null> {
    const imageParts: any[] = [];
    photos.forEach((p, idx) => {
      const matches = p.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!matches || matches.length < 3) return;

      // Label each image part so Gemini knows its role
      if (hasFacePhoto && idx === 0) {
        imageParts.push({ text: `[FACE CLOSE-UP]: Use this as the primary reference for facial features.` });
      } else {
        const photoNum = hasFacePhoto ? idx : idx + 1;
        imageParts.push({ text: `[REFERENCE PHOTO ${photoNum}]: Additional angle for body, proportions, and details.` });
      }
      imageParts.push({ inlineData: { data: matches[2], mimeType: matches[1] } });
    });

    if (imageParts.length === 0) return null;

    const corrective = (extra || "").trim();
    const referencePrompt = buildReferencePrompt(type, accent, hasFacePhoto, photos.length, style)
      + (corrective ? ` IMPORTANT — fix these issues from the previous attempt: ${corrective}.` : "");
    // Route through the shared helper so the responseModalities fix + failure
    // logging apply identically to every image path in the pipeline.
    return generateImageWithFallback([...imageParts, { text: referencePrompt }], "referenceImage", errRef);
  }

  app.post("/api/avatars", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { name, photo, photos, palette, avatar_type, face_photo, input_mode, subject, detail, texture, style, lighting } = req.body;
      // Defensive: accept either camelCase or snake_case so a frontend mismatch can't silently break text mode.
      const inputMode = input_mode ?? req.body.inputMode;
      const avatarTypeRaw = avatar_type ?? req.body.avatarType;
      const facePhotoRaw = face_photo ?? req.body.facePhoto;
      // Normalize the UI type to a canonical SubjectClass ('dog' == animal).
      let avatarType: SubjectClass = avatarTypeRaw === 'human' ? 'human' : avatarTypeRaw === 'object' ? 'object' : 'dog';
      // Accept new multi-photo payload; keep backward compat with single `photo`.
      const photoList: string[] = Array.isArray(photos) && photos.length > 0
        ? photos.filter((p: unknown) => typeof p === "string" && p.length > 0)
        : (photo ? [photo] : []);
      // Optional UI-selected accent palette for colour coordination.
      const accent: string | null = typeof palette === "string" && palette ? palette : null;
      // Dedicated face photo from the face upload slot
      const hasFacePhoto: boolean = typeof facePhotoRaw === "string" && facePhotoRaw.length > 0;

      if (!name) {
        return res.status(400).json({ error: "Name is required." });
      }

      // Input validation up-front (before any paid image generation).
      if (inputMode === "text") {
        if (!subject || typeof subject !== "string" || subject.trim().length < 2) {
          return res.status(400).json({ error: "Describe what to make (a short subject phrase)." });
        }
        if (subject.length > 600) {
          return res.status(400).json({ error: "Subject description is too long (max 600 characters)." });
        }
      } else {
        if (photoList.length === 0) {
          return res.status(400).json({ error: "At least one photo required." });
        }
        if (photoList.length > 6) {
          return res.status(400).json({ error: "Maximum 6 photos per avatar (1 face + 5 body)." });
        }
      }

      const isAdmin = await isUserAdmin(req.user!.phone);
      if (!isAdmin) {
        const balance = await getCreditBalance(req.user!.phone);
        if (balance < 400) {
          return res.status(402).json({ error: "Insufficient credits. You need 400 credits." });
        }
      }

      let finalImageUrl = "";
      let viewSet: { left?: string; back?: string; right?: string } | undefined;
      let usedReferenceImage = false;

      // ── Step 1–3: generate an AI reference image → SAVE it to Backblaze →
      // QUALIFY the saved image (score) → only a passing image proceeds to Tripo.
      // Up to 2 regenerations (3 attempts total). We NEVER silently ship the raw
      // uploaded photo: if the AI image can't be generated we stop with a clear
      // error and no credits are deducted (they're only deducted after a pass).
      const MAX_ATTEMPTS = 3;
      let triage: TriageResult | null = null;
      let chosenImage: string | null = null;     // the passing AI-generated data URL
      let chosenUrl: string | null = null;        // its Backblaze URL
      let corrective = "";
      const imgErr: { code?: number | string; message?: string; quota?: boolean } = {};

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Produce a candidate AI image (front-facing 3D render).
        let candidate: string | null;
        if (inputMode === "text") {
          const fields: TextPromptFields = { subject, style, lighting, corrective };
          candidate = await generateImageWithFallback([{ text: buildTextPrompt(fields) }], "text-to-reference", imgErr);
        } else {
          candidate = await generatePetReferenceImage(photoList, accent, avatarType, hasFacePhoto, corrective, imgErr, style);
        }

        if (!candidate) {
          // AI generation failed. Quota/billing errors won't recover on retry — stop early.
          if (imgErr.quota || attempt >= MAX_ATTEMPTS) break;
          continue;
        }

        // SAVE the generated image to Backblaze FIRST, so every AI render is
        // persisted (and inspectable) before we score it.
        let uploadedUrl: string | null = null;
        try {
          uploadedUrl = candidate.startsWith("data:image") ? await uploadBase64Image(candidate) : candidate;
        } catch (e: any) {
          console.warn("[POST /api/avatars] could not upload candidate image:", e?.message || e);
        }

        // QUALIFY + auto-detect in one vision call. If the QA call itself fails
        // (LLM unavailable), don't block generation — accept the saved candidate.
        try {
          const { data, mimeType } = splitDataUrl(candidate);
          triage = await triageReferenceImage(classifyGenerate, { imageBase64: data, mimeType, userType: avatarType });
        } catch (e: any) {
          console.warn("[POST /api/avatars] triage unavailable; accepting candidate:", e?.message || e);
          triage = null;
          chosenImage = candidate;
          chosenUrl = uploadedUrl;
          usedReferenceImage = true;
          break;
        }

        if (triagePasses(triage)) {
          chosenImage = candidate;
          chosenUrl = uploadedUrl;
          usedReferenceImage = true;
          break;
        }
        // Failed QA → build corrective guidance and regenerate.
        corrective = correctiveFromTriage(triage);
        console.log(`[POST /api/avatars] QA attempt ${attempt} rejected (score ${triage.qualify.score}); corrective: ${corrective}`);
      }

      // No usable AI image was produced.
      if (!chosenImage) {
        // (a) all attempts generated an image but failed QA → quality rejection.
        if (triage && !triagePasses(triage)) {
          return res.status(422).json({ error: friendlyQualifyError(triage), code: "IMAGE_QUALITY_REJECTED" });
        }
        // (b) the AI image model itself failed. Distinguish quota/billing so the
        // operator sees the real cause (top up the Gemini API billing account).
        if (imgErr.quota) {
          console.error("[POST /api/avatars] Gemini image generation quota/billing exhausted:", imgErr.message);
          return res.status(503).json({
            error: "AI image generation is temporarily unavailable (image model quota/billing exhausted). Please try again later.",
            code: "IMAGE_QUOTA_EXHAUSTED",
          });
        }
        return res.status(502).json({
          error: "Could not generate an AI image. Please try again with a clearer photo or a more descriptive prompt.",
          code: "IMAGE_GENERATION_FAILED",
        });
      }

      // ── Auto-detection soft-switch: if the detected class disagrees with what
      // the user picked (high confidence), switch and tell them.
      let detectNotice: string | undefined;
      if (triage && isClassMismatch(triage, avatarType)) {
        const detected = triage.subjectClass;
        detectNotice = `We detected a ${classLabel(detected)}, so we're generating a ${detected === 'object' ? 'static model' : classLabel(detected) + ' avatar'} instead of a ${classLabel(avatarType)}. You can change the type and regenerate if that's wrong.`;
        console.log(`[POST /api/avatars] class mismatch: user=${avatarType} detected=${detected} (${triage.classConfidence}) — switching.`);
        avatarType = detected;
      }

      // ── Layer 1.5: COLOR-COORDINATION LOCK + multiview turnaround. Animals only
      // (dogs); humans stay single-image (intentional), objects default to single-image.
      if (avatarType === 'dog' && chosenImage.startsWith("data:image")) {
        try {
          const paletteStr = usedReferenceImage ? await extractPalette(chosenImage, avatarType) : null;
          const rawViews = await generateTurnaroundViews(chosenImage, paletteStr, avatarType);
          const uploaded: { left?: string; back?: string; right?: string } = {};
          for (const key of ["left", "back", "right"] as const) {
            const v = rawViews[key];
            if (v) uploaded[key] = v.startsWith("data:image") ? await uploadBase64Image(v) : v;
          }
          if (Object.keys(uploaded).length) viewSet = uploaded;
        } catch (e: any) {
          console.warn("[POST /api/avatars] Turnaround/multiview generation skipped:", e?.message || e);
        }
      }

      // Reuse the Backblaze URL from the save-then-score step (upload once).
      finalImageUrl = chosenUrl || (chosenImage.startsWith("data:image") ? await uploadBase64Image(chosenImage) : chosenImage);

      // Persist uploaded photos to the user's library (image mode only). Fire-and-forget.
      if (inputMode !== "text" && photoList.length) {
        const phoneForPhotos = req.user!.phone;
        (async () => {
          for (const p of photoList) {
            try {
              const purl = p.startsWith("data:image") ? await uploadBase64Image(p) : p;
              await addUserPhoto(phoneForPhotos, purl, "avatar_builder");
            } catch (e: any) {
              console.warn("[avatar photos] could not persist an uploaded photo:", e?.message || e);
            }
          }
        })();
      }

      const geo = (detail || texture) ? geometryToTripo(detail, texture) : undefined;

      // Deduct credits ONLY now that we have a qualified image and are starting Tripo.
      if (!isAdmin) {
        await deductCredits(req.user!.phone, 400);
      }

      // Compact analysis record persisted for the build/rig stage (§8 "memory").
      const generationAnalysis = triage
        ? {
            subjectClass: avatarType,
            detected: triage.subjectClass,
            classConfidence: triage.classConfidence,
            species: triage.species || (avatarType === 'human' ? 'human' : undefined),
            breed: triage.breed || undefined,
            breedConfidence: triage.breedConfidence,
            bodyType: triage.bodyType,
            legCount: triage.legCount,
            hasTail: triage.hasTail,
            coatColors: triage.coatColors,
            coatPattern: triage.coatPattern,
            objectCategory: avatarType === 'object' ? triage.objectCategory : undefined,
            objectCategoryConfidence: avatarType === 'object' ? triage.objectCategoryConfidence : undefined,
            humanAnatomy: avatarType === 'human' ? triage.humanAnatomy : undefined,
            qualify: triage.qualify,
          }
        : null;

      // Layer 2: start Tripo3D generation (multiview when turnaround views exist).
      const handle = await startImageTo3D({ imageUrl: finalImageUrl, views: viewSet, geometry: geo });
      const avatarId = await createAvatar(req.user!.phone, name, finalImageUrl, handle, {
        avatar_type: avatarType,
        breed: triage?.breed || undefined,
        generation_analysis: generationAnalysis,
      });
      if (viewSet) {
        try { await updateAvatarMultiview(avatarId, viewSet); }
        catch (e: any) { console.warn("[POST /api/avatars] could not persist multiview views:", e?.message || e); }
      }

      res.json({ avatarId, status: "pending", referenceImageUrl: finalImageUrl, usedReferenceImage, avatarType, notice: detectNotice });
    } catch (err: any) {
      if (isTripoInsufficientCredit(err)) {
        console.error("[Tripo] Platform account out of credits — top up TRIPO_API_KEY account");
        return res.status(503).json({
          error: "3D generation is temporarily unavailable. Please try again later.",
          code: "GENERATION_SERVICE_UNAVAILABLE"
        });
      }
      console.error("[POST /api/avatars] Error creating avatar:", err);
      res.status(500).json({ error: "Failed to create avatar. Please try again." });
    }
  });

  const avatarBuildLocks = new Set<number>();

  // Fix 4 (durability): auto-resume builds that were interrupted mid-flight.
  // The build runs in-process as fire-and-forget work, so a Hostinger process
  // recycle kills it after the mesh is done but before the model is saved,
  // leaving the row in a build-phase status forever. This sweep detects that
  // exact fingerprint — a post-mesh status (rigging/retargeting/baking_*) with
  // the Tripo handle already consumed (meshy_handle NULL), no model yet, aged
  // past the point a healthy build would take, and NOT locked in this process —
  // and restarts the pipeline from Tripo (same path as /retry). The 45-minute
  // reaper above remains the terminal backstop if resumes keep failing.
  async function resumeStalledBuilds() {
    let rows: any[] = [];
    try {
      const [result]: any = await getPool().query(
        `SELECT id, image_url, multiview_json, avatar_type FROM avatars
          WHERE generation_status IN ('rigging','retargeting','baking_clips','baking_sprites')
            AND (meshy_handle IS NULL OR meshy_handle = '')
            AND model_url IS NULL
            AND created_at < (NOW() - INTERVAL 12 MINUTE)
            AND created_at > (NOW() - INTERVAL 45 MINUTE)`
      );
      rows = Array.isArray(result) ? result : [];
    } catch (err: any) {
      console.warn(`[Resume] sweep query failed: ${err?.message || err}`);
      return;
    }

    for (const row of rows) {
      const avatarId = Number(row.id);
      if (avatarBuildLocks.has(avatarId)) continue; // actively building in this process
      if (!row.image_url) continue;                 // nothing to restart from
      try {
        let imageUrl: string = row.image_url;
        if (imageUrl.startsWith("data:image")) {
          imageUrl = await uploadBase64Image(imageUrl);
          await getPool().query(`UPDATE avatars SET image_url = ? WHERE id = ?`, [imageUrl, avatarId]);
        }
        let views = parseMultiview(row.multiview_json) || undefined;
        if (row.avatar_type === 'human') {
          views = undefined;
        }
        const handle = await startImageTo3D({ imageUrl, views });
        await getPool().query(
          `UPDATE avatars SET meshy_handle = ?, generation_status = 'pending', generation_error = NULL WHERE id = ?`,
          [handle, avatarId]
        );
        console.log(`[Resume] Restarted stalled build for avatar ${avatarId}`);
      } catch (err: any) {
        console.warn(`[Resume] Could not restart avatar ${avatarId}: ${err?.message || err}`);
      }
    }
  }
  resumeStalledBuilds();
  setInterval(resumeStalledBuilds, 3 * 60 * 1000);

  app.get("/api/avatars/:id/status", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const avatarId = Number(req.params.id);
      const avatar = await getAvatarById(avatarId, req.user!.phone);
      if (!avatar) return res.status(404).json({ error: "Avatar not found" });

      if (avatar.generation_status === "done" || avatar.generation_status === "failed") {
        return res.json({ 
          status: avatar.generation_status,
          model_url: avatar.model_url,
          sprite_sheet_url: avatar.sprite_sheet_url
        });
      }

      // Check Tripo3D for status
      if (avatar.meshy_handle) {
        const poll = await pollImageTo3D(avatar.meshy_handle);
        if (poll.done && !poll.error) {
          if (avatarBuildLocks.has(avatarId)) {
            return res.json({ status: "rigging" });
          }
          avatarBuildLocks.add(avatarId);
          await getPool().query(`UPDATE avatars SET meshy_handle = NULL WHERE id = ?`, [avatarId]);

          const avatarPhone = req.user!.phone;
          const originalImageUrl = avatar.image_url;
          const glbUrl = poll.glbUrl!;

          // ── STATIC OBJECT: no rig, no brain, no clips. Persist the raw GLB and
          // mark done. (The UI promises "static GLB, no rigging" for objects.)
          // The build now BRANCHES on the detected object sub-category: a
          // blueprint is a 2D plan (not reconstructable) and is failed cleanly;
          // every other kind stores a placement/orientation profile alongside
          // the mesh so the AR/3D scene knows how to place it.
          if (avatar.avatar_type === 'object') {
            (async () => {
              try {
                const gaObj: any = avatar.generation_analysis
                  ? (typeof avatar.generation_analysis === "string" ? JSON.parse(avatar.generation_analysis) : avatar.generation_analysis)
                  : null;
                const profile = objectBuildProfile(gaObj?.objectCategory);

                if (!profile.reconstructable) {
                  console.log(`[Avatar ${avatarId}] Object rejected as non-reconstructable (${profile.category}).`);
                  await updateAvatarGenerationStatus(avatarId, "failed", profile.reason || "This subject can't be built as a 3D object.");
                  return;
                }

                let finalModelUrl: string;
                try {
                  finalModelUrl = await uploadBinaryFromUrl(glbUrl, "model/gltf-binary");
                } catch (e: any) {
                  console.error(`[Avatar ${avatarId}] Failed to mirror object GLB:`, e?.message || e);
                  await updateAvatarGenerationStatus(avatarId, "failed", "Failed to mirror model to durable storage (retryable).");
                  return;
                }
                await updateAvatarModel(avatarId, avatarPhone, finalModelUrl, "", {
                  subjectClass: "object",
                  objectProfile: profile,
                });
                await updateAvatarGenerationStatus(avatarId, "done");
                console.log(`[Avatar ${avatarId}] Static ${profile.label} stored (no rigging; placement=${profile.placement}, enterable=${profile.enterable}).`);
              } catch (err: any) {
                console.error(`[Avatar ${avatarId} Object Error]`, err);
                await updateAvatarGenerationStatus(avatarId, "failed", err.message || "Failed to store static model");
              } finally {
                avatarBuildLocks.delete(avatarId);
              }
            })();
            return res.json({ status: "rigging" });
          }

          await updateAvatarGenerationStatus(avatarId, "rigging");

          // Spawn background agent pipeline
          (async () => {
             try {
                 if (!originalImageUrl) {
                    throw new Error("Missing original image URL for this avatar.");
                 }
                 if (!glbUrl) {
                    throw new Error("Missing GLB URL from 3D generation API.");
                 }
                 
                 const originalImageBase64 = await fetchUrlAsBase64(originalImageUrl);
                 const glbBase64 = await fetchUrlAsBase64(glbUrl);

                 // §8 "memory": prefer the triage record captured at generation time
                 // (detection + anatomy) so we don't pay for a second vision analysis.
                 // Fall back to analyzePetImage only when no usable triage exists.
                 const ga: any = avatar.generation_analysis
                   ? (typeof avatar.generation_analysis === "string" ? JSON.parse(avatar.generation_analysis) : avatar.generation_analysis)
                   : null;
                 let petAnalysis: PetAnalysis;
                 if (ga && (ga.bodyType || ga.species)) {
                    petAnalysis = {
                       species: ga.species || (avatar.avatar_type === 'human' ? 'human' : 'dog'),
                       breed: ga.breed || avatar.breed || "Mixed",
                       bodyType: ga.bodyType && ga.bodyType !== 'static' ? ga.bodyType : (avatar.avatar_type === 'human' ? 'biped' : 'quadruped'),
                       estimatedPose: "standing",
                       legCount: Number.isFinite(ga.legCount) && ga.legCount > 0 ? ga.legCount : (avatar.avatar_type === 'human' ? 2 : 4),
                       hasTail: !!ga.hasTail && avatar.avatar_type !== 'human',
                       hasWings: ga.bodyType === 'winged',
                       bodyProportions: { headSize: "medium", legLength: "medium", bodyLength: "medium", neckLength: "medium" },
                       coatColors: Array.isArray(ga.coatColors) && ga.coatColors.length ? ga.coatColors : ["#C0A080"],
                       coatPattern: ga.coatPattern || "solid",
                    };
                 } else {
                    petAnalysis = await analyzePetImage(originalImageBase64);
                 }
                 // Human anatomy audit → rig hints. Canonical figures are safe to
                 // articulate (e.g. finger rigging); anomalies (a missing eye, a
                 // six-fingered hand the generator slipped through) are logged and
                 // carried into the build metadata so the rig stage can play safe.
                 let humanRig: ReturnType<typeof humanRigHints> | null = null;
                 if (avatar.avatar_type === 'human') {
                    petAnalysis = { ...petAnalysis, species: 'human', bodyType: 'biped', legCount: 2, hasTail: false };
                    humanRig = humanRigHints(ga?.humanAnatomy);
                    if (!humanRig.canonical) {
                       console.warn(`[Avatar ${avatarId}] Human anatomy anomalies: ${humanRig.anomalies.join("; ")} — fingerRig=${humanRig.fingerRig}`);
                    }
                 }

                 const buildState = await runBuildPipeline(
                   petAnalysis,
                   glbBase64,
                   async (step, pct, detail) => {
                      // Fire-and-forget progress log
                      console.log(`[Avatar ${avatarId}] ${step}: ${detail} (${pct}%)`);
                   },
                   originalImageBase64
                );
                
                if (buildState.status === "failed") {
                   await updateAvatarGenerationStatus(avatarId, "failed", buildState.statusMessage);
                } else if (buildState.status === "completed") {
                   let finalModelUrl: string;
                   let finalSpriteSheetUrl = "";
                   if (buildState.riggedGlbBase64) {
                      finalModelUrl = await uploadBase64Binary(buildState.riggedGlbBase64, "model/gltf-binary");
                   } else {
                      finalModelUrl = await uploadBinaryFromUrl(glbUrl, "model/gltf-binary");
                   }
                   if (buildState.spriteSheetBase64) {
                      finalSpriteSheetUrl = await uploadBase64Image(buildState.spriteSheetBase64);
                   }
                   
                   const modelMetadata = humanRig
                      ? { ...(buildState.animationMetadata || {}), humanRig }
                      : (buildState.animationMetadata || {});
                   await updateAvatarModel(avatarId, avatarPhone, finalModelUrl, finalSpriteSheetUrl, modelMetadata);

                   // Mark the avatar "done" as soon as its model + sprites are saved.
                   // The optional Phase 5 clip baking below is a best-effort UPGRADE and
                   // must never be able to strand an otherwise-complete avatar. Previously
                   // the row was flipped to "baking_clips" and only set to "done" AFTER the
                   // (up-to-5-minute) bake await returned — so if the process was recycled
                   // mid-bake, the row froze in "baking_clips" forever with no recovery.
                   await updateAvatarGenerationStatus(avatarId, "done");

                   // Phase 5: best-effort skeletal clip baking. Runs while the avatar is
                   // already "done"; the status is NOT moved backward, so any failure — or a
                   // process death mid-bake — simply leaves the procedural-motion model intact.
                   if (buildState.riggedGlbBase64) {
                      try {
                         const { riggedGlbBase64, clips } = await getBlenderClient()
                            .bakeClipsAndWait(buildState.riggedGlbBase64, { avatarType: avatar.avatar_type });
                         const riggedUrl = await uploadBase64Binary(riggedGlbBase64, "model/gltf-binary");
                         await updateAvatarRiggedModel(avatarId, avatarPhone, riggedUrl, clips);
                         console.log(`[Avatar ${avatarId}] Baked ${clips.length} skeletal clips.`);
                      } catch (clipErr: any) {
                         console.warn(`[Avatar ${avatarId}] Skeletal clip baking skipped: ${clipErr?.message || clipErr}`);
                      }
                   }
                }
             } catch (err: any) {
                console.error(`[Avatar ${avatarId} Agent Error]`, err);
                await updateAvatarGenerationStatus(avatarId, "failed", err.message || "Unknown error in background agent");
             } finally {
                avatarBuildLocks.delete(avatarId);
             }
          })();

          return res.json({ status: "rigging" });
        } else if (poll.done && poll.error) {
          await updateAvatarGenerationStatus(avatarId, "failed", poll.error);
          return res.json({ status: "failed", error: "Generation failed" });
        } else {
          return res.json({ status: "pending" });
        }
      }

      res.json({ status: avatar.generation_status });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to poll avatar status." });
    }
  });

  app.post("/api/avatars/:id/retry", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const avatarId = Number(req.params.id);
      const avatar = await getAvatarById(avatarId, req.user!.phone);
      if (!avatar) return res.status(404).json({ error: "Avatar not found" });

      // Allow retry from terminal states (failed/done) AND from the post-mesh
      // intermediate states, so a user can recover a stalled avatar without
      // waiting for the reaper. Only block during active mesh generation.
      const retryableStatuses = ["failed", "done", "rigging", "retargeting", "baking_clips", "baking_sprites"];
      if (!retryableStatuses.includes(avatar.generation_status)) {
         return res.status(400).json({ error: "Avatar is currently generating" });
      }

      // Reset status and error
      await updateAvatarGenerationStatus(avatarId, "pending", null);

      // Re-trigger the background generation job with Tripo3D
      if (avatar.image_url) {
        let finalImageUrl = avatar.image_url;
        if (finalImageUrl.startsWith("data:image")) {
           finalImageUrl = await uploadBase64Image(finalImageUrl);
           // Also update the avatar image_url in DB if it was base64
           await getPool().query(`UPDATE avatars SET image_url = ? WHERE id = ?`, [finalImageUrl, avatarId]);
        }
        let views = parseMultiview((avatar as any).multiview_json) || undefined;
        if (avatar.avatar_type === 'human') {
          views = undefined;
        }
        const handle = await startImageTo3D({ imageUrl: finalImageUrl, views });
        await getPool().query(`UPDATE avatars SET meshy_handle = ? WHERE id = ?`, [handle, avatarId]);
      } else {
        return res.status(400).json({ error: "Original photo not available for retry" });
      }

      res.json({ success: true, status: "pending" });
    } catch (err: any) {
      console.error("[POST /api/avatars/:id/retry] Error retrying avatar:", err);
      res.status(500).json({ error: err.message || "Failed to retry avatar generation." });
    }
  });

  app.post("/api/avatars/:id/feed", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const success = await feedAvatar(Number(req.params.id), req.user!.phone);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to feed avatar." });
    }
  });

  app.post("/api/avatars/:id/water", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const success = await waterAvatar(Number(req.params.id), req.user!.phone);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to water avatar." });
    }
  });

  app.post("/api/avatars/:id/treat", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const success = await giveTreatToAvatar(Number(req.params.id), req.user!.phone);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to give treat." });
    }
  });

  // --- Living avatar: needs state & commands (Phase 2) ---------------------

  // Returns the stored needs snapshot (client applies offline decay from lastSeen).
  app.get("/api/avatars/:id/state", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const needs = await getAvatarNeeds(Number(req.params.id), req.user!.phone);
      if (!needs) return res.status(404).json({ error: "Avatar not found." });
      res.json({ needs });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load avatar state." });
    }
  });

  // Persists the current needs snapshot.
  app.patch("/api/avatars/:id/state", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { needs } = req.body || {};
      if (!needs || typeof needs !== "object") {
        return res.status(400).json({ error: "needs object required." });
      }
      const success = await saveAvatarNeeds(Number(req.params.id), req.user!.phone, needs);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save avatar state." });
    }
  });

  // Logs a user-issued command (telemetry / ambient awareness). Execution is client-side.
  app.post("/api/avatars/:id/command", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { action } = req.body || {};
      if (!action || typeof action !== "string") {
        return res.status(400).json({ error: "action required." });
      }
      console.log(`[command] avatar ${req.params.id} <- ${action} (user ${req.user!.phone})`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to log command." });
    }
  });

  // --- Placed objects (Phase 3) -------------------------------------------

  app.get("/api/avatars/:id/objects", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const objects = await getPlacedObjects(Number(req.params.id), req.user!.phone);
      res.json({ objects });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load objects." });
    }
  });

  app.post("/api/avatars/:id/objects", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { id, kind, position, rotationY, scale } = req.body || {};
      if (!id || !kind || !Array.isArray(position) || position.length !== 3) {
        return res.status(400).json({ error: "id, kind and position[3] required." });
      }
      const ok = await addPlacedObject(Number(req.params.id), req.user!.phone, {
        id: String(id),
        kind: String(kind),
        position: [Number(position[0]), Number(position[1]), Number(position[2])],
        rotationY: Number(rotationY) || 0,
        scale: Number(scale) || 1,
      });
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to place object." });
    }
  });

  app.delete("/api/avatars/:id/objects/:objectId", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const ok = await deletePlacedObject(req.params.objectId, req.user!.phone);
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to remove object." });
    }
  });

  // --- AR Cast / Companions (Phase 5) -------------------------------------------

  app.get("/api/ar/:avatarId/cast", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const actors = await getSceneActors(Number(req.params.avatarId), req.user!.phone);
      res.json({ actors });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load cast." });
    }
  });

  app.post("/api/ar/:avatarId/cast", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { id, sourceAvatarId, transform, selectedClip } = req.body || {};
      if (!id || !sourceAvatarId || !transform) {
        return res.status(400).json({ error: "id, sourceAvatarId and transform required." });
      }
      const ok = await addSceneActor(Number(req.params.avatarId), req.user!.phone, {
        id: String(id),
        sourceAvatarId: Number(sourceAvatarId),
        transform,
        selectedClip: selectedClip ? String(selectedClip) : undefined,
      });
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to add cast member." });
    }
  });

  app.put("/api/ar/:avatarId/cast/:actorId", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { transform, selectedClip } = req.body || {};
      const ok = await updateSceneActor(
        req.params.actorId,
        req.user!.phone,
        transform,
        selectedClip ? String(selectedClip) : undefined
      );
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update cast member." });
    }
  });

  app.delete("/api/ar/:avatarId/cast/:actorId", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const ok = await deleteSceneActor(req.params.actorId, req.user!.phone);
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to remove cast member." });
    }
  });

  // Initialize Gemini API
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({
    apiKey: apiKey || "placeholder-key",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // --- AR virtual-pet simulator (AR_PET_SIM_SPEC, milestone AR2) -------------

  // Gemini-backed generate fn injected into the (provider-agnostic) classify core.
  const classifyGenerate: GenerateFn = async ({ prompt, imageBase64, mimeType, temperature }) => {
    const part = { inlineData: { data: imageBase64, mimeType } };
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [part, { text: prompt }] },
      config: { temperature, responseMimeType: "application/json" },
    });
    return (response.text || "").trim();
  };

  // Strip a data: URL prefix if present, returning { data, mimeType }.
  const splitDataUrl = (s: string): { data: string; mimeType: string } => {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(s);
    if (m) return { mimeType: m[1], data: m[2] };
    return { mimeType: "image/jpeg", data: s };
  };

  // POST /api/pets/classify — one vision-LLM call → breed/build/temperament,
  // resolved to a breed profile and persisted onto the avatar's pet_profiles row.
  app.post("/api/pets/classify", requireAuth, paidLimiter, async (req: AuthedRequest, res) => {
    try {
      const { avatarId, imageBase64, imageUrl, force } = req.body || {};
      const aId = Number(avatarId);
      if (!Number.isFinite(aId)) {
        return res.status(400).json({ error: "avatarId required." });
      }
      // Ownership check up-front (before any paid LLM call).
      const owned = await getAvatarById(aId, req.user!.phone);
      if (!owned) return res.status(404).json({ error: "Avatar not found." });

      // Cache: never re-classify the same avatar unless force=true (hardening H7).
      if (!force) {
        const existing = await getPetProfileByAvatar(aId, req.user!.phone);
        if (existing && existing.breed) {
          return res.json({ profile: existing, cached: true });
        }
      }

      let img = "";
      let mimeType = "image/jpeg";
      if (typeof imageBase64 === "string" && imageBase64) {
        const s = splitDataUrl(imageBase64);
        img = s.data;
        mimeType = s.mimeType;
      } else if (typeof imageUrl === "string" && imageUrl) {
        const b64 = await fetchUrlAsBase64(imageUrl);
        const s = splitDataUrl(b64);
        img = s.data;
        mimeType = s.mimeType;
      } else {
        return res.status(400).json({ error: "imageBase64 or imageUrl required." });
      }

      // H2/H7: kill-switch + per-user daily cap (only paid, non-cached calls count).
      if (!(await guardPaidCall("classify", req, res))) return;

      const result = await classifyPetImage(classifyGenerate, { imageBase64: img, mimeType });
      const breedProfile = resolveBreedProfile(result.breed, result.size_class);

      // Seed brain state: weights from temperament, default drives/hormones.
      const t = result.temperament as Record<string, number>;
      const temperament = {
        energy: Number(t.energy) || 0.5,
        sociability: Number(t.sociability) || 0.5,
        stubbornness: Number(t.stubbornness) || 0.5,
        foodMotivation: Number(t.foodMotivation) || 0.5,
        vocality: Number(t.vocality) || 0.5,
      };
      const weights = weightsFromTemperament(temperament);
      const saved = await upsertPetProfile(aId, req.user!.phone, {
        breed: result.breed,
        breed_confidence: result.breed_confidence,
        size_class: result.size_class,
        build: result.build,
        temperament: result.temperament,
        personality_weights: weights,
        hormones: { ...DEFAULT_HORMONES },
        drives: { ...DEFAULT_DRIVES },
      });

      res.json({ profile: saved, classification: result, breedProfile, cached: false });
    } catch (err: any) {
      console.error("[pets/classify] failed:", err?.message || err);
      res.status(502).json({ error: "Classification failed." });
    }
  });

  // GET /api/pets/:id/state — drives/hormones/weights with offline decay applied.
  app.get("/api/pets/:id/state", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const pet = await getPetProfileById(Number(req.params.id), req.user!.phone);
      if (!pet) return res.status(404).json({ error: "Pet not found." });

      const drives = pet.drives || { ...DEFAULT_DRIVES };
      const hormones = pet.hormones || { ...DEFAULT_HORMONES };
      const pt = (pet.temperament || {}) as Record<string, number>;
      const weights =
        pet.personality_weights ||
        weightsFromTemperament({
          energy: Number(pt.energy) || 0.5,
          sociability: Number(pt.sociability) || 0.5,
          stubbornness: Number(pt.stubbornness) || 0.5,
          foodMotivation: Number(pt.foodMotivation) || 0.5,
          vocality: Number(pt.vocality) || 0.5,
        });

      // Offline decay from updated_at, capped at 24h (mirrors needs.ts offline sync).
      const last = new Date(pet.updated_at).getTime();
      const elapsedSec = Number.isFinite(last)
        ? Math.min(Math.max(0, (Date.now() - last) / 1000), 24 * 3600)
        : 0;
      const bp = resolveBreedProfile(pet.breed || undefined, pet.size_class || "medium");
      const decayed = decayDrives(drives, elapsedSec, {
        decay: bp.decay,
        exerciseNeed: bp.exerciseNeed,
        complianceBase: bp.complianceBase,
        scale: bp.scale,
      });

      res.json({
        drives: decayed,
        hormones,
        weights,
        trainer_score: pet.trainer_score,
        life_stage: pet.life_stage,
        aging_mode: pet.aging_mode,
        mortality_enabled: !!pet.mortality_enabled,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load pet state." });
    }
  });

  // PATCH /api/pets/:id/state — persist client brain state (offline-aware sync).
  app.patch("/api/pets/:id/state", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { drives, hormones, weights, trainer_score } = req.body || {};
      if (drives != null && typeof drives !== "object") {
        return res.status(400).json({ error: "drives must be an object." });
      }
      if (hormones != null && typeof hormones !== "object") {
        return res.status(400).json({ error: "hormones must be an object." });
      }
      const ok = await savePetState(Number(req.params.id), req.user!.phone, {
        drives,
        hormones,
        personality_weights: weights,
        trainer_score: typeof trainer_score === "number" ? trainer_score : undefined,
      });
      if (!ok) return res.status(404).json({ error: "Pet not found." });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save pet state." });
    }
  });

  // Poll a Tripo task (rig/retarget/gen) until done or attempts exhausted.
  const pollTripoUntilDone = async (handle: string, tries = 60, delayMs = 5000) => {
    for (let i = 0; i < tries; i++) {
      const r = await pollTripoTask(handle);
      if (r.done) return r;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { done: false, error: "Tripo task timed out." } as Awaited<ReturnType<typeof pollTripoTask>>;
  };

  // POST /api/pets/:id/rig — Tripo animate_rig → blender-worker bake-lod → B2.
  // Feature-flagged: when off, avatars keep the current (unrigged) render path.
  app.post("/api/pets/:id/rig", requireAuth, paidLimiter, async (req: AuthedRequest, res) => {
    if (process.env.PETSIM_RIG_ENABLED !== "true") {
      return res.status(501).json({ error: "Rig pipeline disabled.", featureFlag: "PETSIM_RIG_ENABLED" });
    }
    try {
      const petId = Number(req.params.id);
      const pet = await getPetProfileById(petId, req.user!.phone);
      if (!pet) return res.status(404).json({ error: "Pet not found." });

      // Source model task id: explicit body, else the avatar's stored Tripo handle.
      const avatar = await getAvatarById(pet.avatar_id, req.user!.phone);
      let genTaskId: string = (req.body && req.body.genTaskId) || "";
      if (!genTaskId) {
        genTaskId = avatar?.meshy_handle || "";
      }
      if (!genTaskId) {
        return res.status(400).json({ error: "No source model task id (genTaskId) available for this pet." });
      }

      // H2/H7: master kill-switch + per-user daily cap before any paid Tripo work.
      if (!(await guardPaidCall("rig", req, res))) return;

      // 1) Kick Tripo auto-rig and poll to completion (bounded).
      const rigHandle = await startRig(genTaskId, { avatarType: avatar?.avatar_type || 'dog' });
      const rig = await pollTripoUntilDone(rigHandle, 60, 5000);
      if (!rig.glbUrl) {
        return res.status(502).json({ error: rig.error || "Rig did not produce a model." });
      }

      // 2) Mirror the rigged GLB to B2.
      const riggedGlbUrl = await uploadBinaryFromUrl(rig.glbUrl, "model/gltf-binary");

      // 3) blender-worker bake-lod → budget LOD GLB bytes.
      const workerUrl = (process.env.BLENDER_WORKER_URL || "http://localhost:10000").replace(/\/render$/, "");
      const bakeRes = await fetch(`${workerUrl}/bake-lod`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": process.env.WORKER_SHARED_SECRET || "",
        },
        body: JSON.stringify({ glb_url: rig.glbUrl, avatar_type: avatar?.avatar_type }),
      });
      const bakeJson: any = await bakeRes.json().catch(() => ({}));
      if (!bakeRes.ok || !bakeJson.glb_base64) {
        return res.status(502).json({ error: `bake-lod failed: ${bakeJson.error || bakeRes.status}` });
      }
      const stats: BakeStats = bakeJson.stats || {
        tris: 0, bones: 0, bytes: 0, retarget_confidence: 0, leg_chains_ok: false,
      };
      const lodGlbUrl = await uploadBase64Binary(bakeJson.glb_base64, "model/gltf-binary");

      // 4) Persist URLs; report budget + retarget-fallback decision (spec §3.1).
      await savePetRigUrls(petId, req.user!.phone, {
        rigged_glb_url: riggedGlbUrl,
        lod_glb_url: lodGlbUrl,
      });
      const budget = checkBudget(stats);
      const threshold = avatar?.avatar_type === 'human' ? 0.85 : 0.7;
      let retargetFallbackRecommended = needsRetargetFallback(stats, threshold);

      const bodyType = avatar?.avatar_type === 'human' ? 'biped' : 'quadruped';
      const contract = SKELETON_CONTRACTS[bodyType];
      const missingContractBones = (stats.missing_bones || []).filter(b => contract.allBones.includes(b));
      if (missingContractBones.length > 0) {
        console.warn(`[pets/rig] Rig is missing contract bones for bodyType ${bodyType}:`, missingContractBones);
        retargetFallbackRecommended = true;
      }

      if (retargetFallbackRecommended) {
        console.warn(
          `[pets/rig] pet ${petId}: low retarget confidence / missing leg chains — ` +
          `recommend Tripo preset animations. stats=${JSON.stringify(stats)}`
        );
        if (avatar?.avatar_type === 'human') {
          console.error(`[pets/rig] humanoid retarget below confidence for pet ${petId}`);
          await getPool().query(
            `UPDATE avatars SET generation_status = 'failed', generation_error = ? WHERE id = ?`,
            ["humanoid retarget below confidence", pet.avatar_id]
          );
          return res.status(422).json({ error: "humanoid retarget below confidence" });
        }
      }

      res.json({ success: true, riggedGlbUrl, lodGlbUrl, stats, budget, retargetFallbackRecommended });
    } catch (err: any) {
      console.error("[pets/rig] failed:", err?.message || err);
      res.status(502).json({ error: "Rig pipeline failed." });
    }
  });

  // POST /api/ar/semantic-scan — AR_PET_SIM_SPEC §6.4
  // One camera frame → vision LLM → zone polygons. Cached per anchor hash so a
  // session doesn't pay for the LLM twice on the same spot (H7).
  app.post("/api/ar/semantic-scan", requireAuth, paidLimiter, async (req: AuthedRequest, res) => {
    try {
      const { imageBase64, imageUrl, anchorHash, force } = req.body || {};

      let img = "";
      let mimeType = "image/jpeg";
      if (typeof imageBase64 === "string" && imageBase64) {
        const s = splitDataUrl(imageBase64);
        img = s.data;
        mimeType = s.mimeType;
      } else if (typeof imageUrl === "string" && imageUrl) {
        const s = splitDataUrl(await fetchUrlAsBase64(imageUrl));
        img = s.data;
        mimeType = s.mimeType;
      } else {
        return res.status(400).json({ error: "imageBase64 or imageUrl required." });
      }

      // Anchor key: client-provided anchor id, else a content hash of the frame.
      const key: string =
        (typeof anchorHash === "string" && anchorHash) ||
        createHash("sha256").update(img).digest("hex").slice(0, 64);

      if (!force) {
        const cached = await getSemanticScan(req.user!.phone, key);
        if (cached) return res.json({ anchorHash: key, zones: cached.zones ?? cached, cached: true });
      }

      // H2/H7: kill-switch + per-user daily cap (only paid, non-cached scans count).
      if (!(await guardPaidCall("semantic_scan", req, res))) return;

      const result = await runSemanticScan(classifyGenerate, { imageBase64: img, mimeType });
      await saveSemanticScan(req.user!.phone, key, result);
      res.json({ anchorHash: key, zones: result.zones, cached: false });
    } catch (err: any) {
      console.error("[ar/semantic-scan] failed:", err?.message || err);
      res.status(502).json({ error: "Semantic scan failed." });
    }
  });

  // GET /api/pets/:id/commands — learned voice commands, with forgetting decay
  // applied to compliance from last_reinforced (§7.2).
  app.get("/api/pets/:id/commands", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const petId = Number(req.params.id);
      const pet = await getPetProfileById(petId, req.user!.phone);
      if (!pet) return res.status(404).json({ error: "Pet not found." });
      const rows = await getPetCommands(petId, req.user!.phone);
      const now = Date.now();
      const commands = rows.map((c: any) => {
        const last = c.last_reinforced ? new Date(c.last_reinforced).getTime() : now;
        const days = Math.max(0, (now - last) / 86_400_000);
        return { ...c, compliance: decayCompliance(Number(c.compliance), days) };
      });
      res.json({ commands });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load commands." });
    }
  });

  // POST /api/pets/:id/commands — teach a command. Body { phrase, action,
  // samples?: string[] }. Server computes phonetic keys from the samples (or the
  // phrase) so client + server stay consistent.
  app.post("/api/pets/:id/commands", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const petId = Number(req.params.id);
      const pet = await getPetProfileById(petId, req.user!.phone);
      if (!pet) return res.status(404).json({ error: "Pet not found." });
      const { phrase, action, samples } = req.body || {};
      if (typeof phrase !== "string" || !phrase.trim() || typeof action !== "string") {
        return res.status(400).json({ error: "phrase and action are required." });
      }
      const src: string[] = Array.isArray(samples) && samples.length ? samples : [phrase];
      const keys = Array.from(new Set(src.map((s) => phraseKey(String(s))).filter(Boolean)));
      const id = await addPetCommand(petId, { phrase, metaphone_keys: keys, action });
      res.json({ id, phrase, action, metaphone_keys: keys, compliance: 0.5 });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save command." });
    }
  });

  // GET /api/pets/:id/buttons — spatial speech buttons.
  app.get("/api/pets/:id/buttons", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const petId = Number(req.params.id);
      const pet = await getPetProfileById(petId, req.user!.phone);
      if (!pet) return res.status(404).json({ error: "Pet not found." });
      res.json({ buttons: await getPetButtons(petId, req.user!.phone) });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load buttons." });
    }
  });

  // POST /api/pets/:id/buttons — create a button. Body { label, audioBase64|audioUrl,
  // linkedAction?, anchor }. Audio is uploaded to B2.
  app.post("/api/pets/:id/buttons", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const petId = Number(req.params.id);
      const pet = await getPetProfileById(petId, req.user!.phone);
      if (!pet) return res.status(404).json({ error: "Pet not found." });
      const { label, audioBase64, audioUrl, linkedAction, anchor } = req.body || {};
      if (typeof label !== "string" || !label.trim()) {
        return res.status(400).json({ error: "label is required." });
      }
      let storedAudioUrl = "";
      if (typeof audioBase64 === "string" && audioBase64) {
        storedAudioUrl = await uploadBase64Binary(audioBase64, "audio/webm");
      } else if (typeof audioUrl === "string" && audioUrl) {
        storedAudioUrl = await uploadBinaryFromUrl(audioUrl, "audio/webm");
      } else {
        return res.status(400).json({ error: "audioBase64 or audioUrl required." });
      }
      const id = await addPetButton(petId, {
        label,
        audio_url: storedAudioUrl,
        linked_action: typeof linkedAction === "string" ? linkedAction : null,
        anchor: anchor || {},
      });
      res.json({ id, label, audio_url: storedAudioUrl, linked_action: linkedAction ?? null, anchor: anchor || {} });
    } catch (err: any) {
      console.error("[pets/buttons] failed:", err?.message || err);
      res.status(500).json({ error: "Failed to save button." });
    }
  });

  // POST /api/trials/:type/result — AR_PET_SIM_SPEC §7.4
  // Award trainer points + credits for a completed disc/agility trial.
  app.post("/api/trials/:type/result", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const type = req.params.type as TrialType;
      if (type !== "disc" && type !== "agility") {
        return res.status(400).json({ error: "Unknown trial type." });
      }
      const { petId, catches, score } = req.body || {};
      const pet = await getPetProfileById(Number(petId), req.user!.phone);
      if (!pet) return res.status(404).json({ error: "Pet not found." });

      const points = pointsForTrial(type, {
        catches: Number(catches) || 0,
        score: Number(score) || 0,
      });
      const trainerScore = await incrementTrainerScore(Number(petId), req.user!.phone, points);
      const credits = creditsFromPoints(points);
      if (credits > 0) await addCredits(req.user!.phone, credits, `trial_${type}`);

      res.json({ type, points, trainerScore, credits });
    } catch (err: any) {
      console.error("[trials/result] failed:", err?.message || err);
      res.status(500).json({ error: "Failed to record trial result." });
    }
  });

  // PATCH /api/pets/:id/settings — aging/mortality settings (§4.6; OFF by default).
  app.patch("/api/pets/:id/settings", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const petId = Number(req.params.id);
      const pet = await getPetProfileById(petId, req.user!.phone);
      if (!pet) return res.status(404).json({ error: "Pet not found." });
      const { aging_mode, mortality_enabled, life_stage } = req.body || {};
      if (aging_mode != null && !["off", "slow", "realistic"].includes(aging_mode)) {
        return res.status(400).json({ error: "aging_mode must be off|slow|realistic." });
      }
      if (life_stage != null && !["puppy", "adult", "senior"].includes(life_stage)) {
        return res.status(400).json({ error: "life_stage must be puppy|adult|senior." });
      }
      const ok = await updatePetSettings(petId, req.user!.phone, {
        aging_mode,
        mortality_enabled: typeof mortality_enabled === "boolean" ? mortality_enabled : undefined,
        life_stage,
      });
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update settings." });
    }
  });

  // API route to create custom styled pet images using Imagen or Gemini
  app.get("/api/inspiration", async (req, res) => {
    try {
      // 1. Fetch live random dog photo
      let dogImageUrl = "";
      let breedName = "Charming Pet";
      let imageFetchSuccess = false;
      let dogError = "";

      try {
        const dogRes = await fetch("https://dog.ceo/api/breeds/image/random", { signal: AbortSignal.timeout(5000) });
        if (dogRes.ok) {
          const dogData = (await dogRes.json()) as { message: string; status: string };
          if (dogData && dogData.status === "success") {
            dogImageUrl = dogData.message;
            imageFetchSuccess = true;
            // Parse breed name out of url e.g. /breeds/husky/...
            const breedMatch = dogImageUrl.match(/\/breeds\/([^/]+)\//);
            if (breedMatch && breedMatch[1]) {
              breedName = breedMatch[1]
                .split("-")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .reverse()
                .join(" ");
            }
          } else {
            dogError = "Invalid structure returned from Dog CEO API.";
          }
        } else {
          dogError = `Dog CEO API returned status ${dogRes.status}`;
        }
      } catch (err: any) {
        dogError = err.message || "Network timeout / connection failure";
      }

      // If Dog API failed, let's fallback to free Cat API search
      if (!imageFetchSuccess) {
        try {
          const catRes = await fetch("https://api.thecatapi.com/v1/images/search", { signal: AbortSignal.timeout(4000) });
          if (catRes.ok) {
            const catData = (await catRes.json()) as Array<{ url: string }>;
            if (catData && catData[0]?.url) {
              dogImageUrl = catData[0].url;
              breedName = "Dreamy Cat Companion";
              imageFetchSuccess = true;
            }
          }
        } catch (catErr: any) {
          console.warn("Cat fallback API also failed:", catErr);
        }
      }

      // 2. Fetch live fun dog fact
      let petFact = "Every single pet photo tells a story of unconditional love and companionship.";
      let factFetchSuccess = false;
      let factError = "";

      try {
        const factRes = await fetch("https://dogapi.dog/api/v2/facts", { signal: AbortSignal.timeout(4000) });
        if (factRes.ok) {
          const factData = (await factRes.json()) as { data: Array<{ attributes: { body: string } }> };
          if (factData && factData.data && factData.data[0]?.attributes?.body) {
            petFact = factData.data[0].attributes.body;
            factFetchSuccess = true;
          } else {
            factError = "Invalid body structure from dogapi.dog";
          }
        } else {
          factError = `dogapi.dog API returned status ${factRes.status}`;
        }
      } catch (err: any) {
        factError = err.message || "Fact server timeout";
      }

      // Final JSON response with complete status information
      res.json({
        success: true,
        imageUrl: dogImageUrl || "https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&q=80&w=600",
        breed: breedName,
        fact: petFact,
        metadata: {
          dogApiStatus: imageFetchSuccess ? "online" : "error",
          dogApiDetail: dogError || null,
          factApiStatus: factFetchSuccess ? "online" : "error",
          factApiDetail: factError || null,
          timestamp: new Date().toISOString()
        }
      });
    } catch (globalErr: any) {
      console.error("Inspiration API error:", globalErr);
      res.status(500).json({
        success: false,
        error: "Failed to query core external public APIs."
      });
    }
  });

  // API route to create custom styled pet images using Imagen or Gemini
  // Fix 5: Credit store — let users purchase credit packs via Stripe
  // Credit packs — bulk buys cost less per credit ($5→5.00¢, $10→4.55¢,
  // $25→4.17¢, $50→3.85¢/credit). Authoritative pricing (client mirrors this in
  // src/components/CreditStore.tsx). Stripe checkout amount is derived from
  // `price` at session-creation time, so changing these needs no Stripe setup.
  const CREDIT_PACKS = [
    { id: "pack_100",  credits: 100,  price: 5.0,   label: "Starter Pack" },
    { id: "pack_220",  credits: 220,  price: 10.0,  label: "Popular Pack" },
    { id: "pack_600",  credits: 600,  price: 25.0,  label: "Pro Pack" },
    { id: "pack_1300", credits: 1300, price: 50.0,  label: "Studio Pack" },
  ] as const;

  app.post("/api/create-credits-session", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { packId } = req.body;
      const pack = CREDIT_PACKS.find((p) => p.id === packId);
      if (!pack) return res.status(400).json({ success: false, error: "Invalid credit pack selected." });

      const appUrl = process.env.APP_URL || "http://localhost:3000";

      // Sandbox mode — simulate instantly
      if (!stripe) {
        await addCredits(req.user!.phone, pack.credits);
        const simulatedUrl = `${appUrl}/?credits_success=true&pack=${pack.id}&added=${pack.credits}`;
        return res.json({ success: true, url: simulatedUrl, mode: "sandbox" });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Paws & Memories — ${pack.label}`,
              description: `${pack.credits} AI creation credits`,
            },
            unit_amount: Math.round(pack.price * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        metadata: {
          type: "credit_purchase",
          userPhone: req.user!.phone,
          packId: pack.id,
          creditsToAdd: String(pack.credits),
        },
        success_url: `${appUrl}/?credits_success=true&pack=${pack.id}&added=${pack.credits}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?credits_cancelled=true`,
      });

      return res.json({ success: true, url: session.url, mode: "live_stripe" });
    } catch (err: any) {
      console.error("Error creating credits checkout session:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to initiate credit purchase." });
    }
  });

  // Street View Coverage Check Endpoint (Phase 1.2)
  app.get("/api/streetview/coverage", requireAuth, async (req, res) => {
    try {
      const { lat, lng } = req.query;
      if (!lat || !lng) {
        return res.status(400).json({ success: false, error: "lat and lng are required" });
      }
      if (!process.env.GOOGLE_MAPS_API_KEY_SERVER) {
        return res.status(500).json({ success: false, error: "Google Maps Server API key not configured" });
      }
      
      const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY_SERVER}`;
      const response = await fetch(url);
      const data = await response.json();
      
      res.json({ success: true, data });
    } catch (err: any) {
      console.error("Street view coverage check error:", err);
      res.status(500).json({ success: false, error: "Failed to check street view coverage" });
    }
  });

  app.get("/api/landmarks", requireAuth, async (req, res) => {
    try {
      const city = String(req.query.city || "");
      if (!city) return res.json({ landmarks: [] });
      if (!process.env.GOOGLE_MAPS_API_KEY_SERVER) return res.json({ landmarks: [] });
      
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=top+famous+landmarks+in+${encodeURIComponent(city)}&key=${process.env.GOOGLE_MAPS_API_KEY_SERVER}`;
      const response = await fetch(url);
      const data = await response.json();
      
      const landmarks = (data.results || []).slice(0, 5).map((r: any) => ({
        name: r.name,
        lat: r.geometry?.location?.lat,
        lng: r.geometry?.location?.lng,
        photoReference: r.photos?.[0]?.photo_reference
      }));
      res.json({ landmarks });
    } catch (err: any) {
      res.json({ landmarks: [] });
    }
  });

  app.post("/api/create-creation", requireAuth, async (req, res) => {
    try {
      if (!apiKey || apiKey === "placeholder-key" || apiKey === "MY_GEMINI_API_KEY") {
        throw new Error("Missing or invalid GEMINI_API_KEY. Please configure your Gemini API key in the AI Studio Secrets panel.");
      }

      const authedReq = req as AuthedRequest;
      const userPhone = authedReq.user!.phone;
      const GENERATION_COST = 40;

      // Fix 2: Server-side credit check + atomic deduction before calling AI
      // Admin bypass: skip credit checks for developer phone number
      const isAdmin = await isUserAdmin(userPhone);
      if (!isAdmin) {
        const currentBalance = await getCreditBalance(userPhone);
        if (currentBalance < GENERATION_COST) {
          return res.status(402).json({
            success: false,
            error: `Insufficient credits. You need ${GENERATION_COST} credits but only have ${currentBalance}. Purchase more credits to continue.`
          });
        }
      }

      const { style, background, photo, breed, name, brightness, contrast, location } = req.body;
      
      let promptText = "";
      if (brightness > 70) promptText += ` Use very bright, high-key lighting.`;
      else if (brightness < 30) promptText += ` Use moody, low-key dramatic lighting.`;
      if (contrast > 70) promptText += ` High contrast, punchy colors.`;
      else if (contrast < 30) promptText += ` Soft, low-contrast, pastel tones.`;

      if (name) {
        promptText += `The pet is a lovely animal named ${name}. `;
      }
      if (breed) {
        promptText += `The breed is a beautiful ${breed}. `;
      } else {
        promptText += `The pet is a charming dog or cat. `;
      }

      // Match the style guidelines from the design spec
      if (style === "Clay") {
        promptText += `styled in high-quality claymation / clay-render / clay model illustration with visible tactile clay textures. Whimsical and charming. `;
      } else if (style === "Sketch") {
        promptText += `delicate charcoal and pencil sketch style with expressive artistic hand-drawn strokes and fine paper texture visible, high-end fine art. `;
      } else if (style === "Artistic" || style === "Watercolor") {
        promptText += `magical, dreamy watercolor painting style with beautiful color bleed, soft sage green, morning glow, and warm terracotta pastel tones. `;
      } else if (style === "Anime") {
        promptText += `styled in beautiful vibrant Japanese anime art style, resembling Studio Ghibli, with lush colorful backgrounds and highly expressive bright eyes. `;
      } else if (style === "3D") {
        promptText += `styled as a cute Pixar-like 3D computer graphics render, high fidelity, soft rim lighting, highly detailed and expressive. `;
      } else if (style === "Retro") {
        promptText += `styled in 1980s retro synthwave aesthetic, neon colors, lo-fi VHS tape grain, nostalgic vintage look. `;
      } else { // Realistic
        promptText += `hyper-realistic professional pet portrait, captured in a sun-drenched atmosphere with golden hour light and soft focus scenic bokeh. `;
      }

      if (background === "Canyon") {
        promptText += `The pet is sitting in front of the majestic Grand Canyon National Park with its vast layered reddish-orange cliffs, dramatic canyon valley, and a flowing green river far below under a glowing warm morning sun. `;
      } else if (background === "Paris") {
        promptText += `The pet is sitting in a Paris park with the beautiful Eiffel Tower visible in the background, surrounded by blossoming pink cherry blossoms with delicate petals falling. `;
      } else if (background === "Cabin") {
        promptText += `The pet is in front of a cozy warm-lit rustic wooden log cabin in a snowy evergreen pine forest, with a brilliant magical aurora borealis green and colorful northern lights glowing in the night sky. `;
      } else if (background === "Rocky") {
        promptText += `The pet is standing next to the famous Rocky Balboa boxing statue in Philadelphia, in front of the grand steps of the steps of the Philadelphia Museum of Art, triumphant and heroic. `;
      } else {
        promptText += `The setting is a lush sun-drenched green flower garden during golden hour with sparkling wildflowers and beautiful bokeh effects. `;
      }

      promptText += ` The image must convey an empathetic, nostalgic, warm, and highly nurturing aesthetic, like a cherished digital heirloom memory. Fully centered, perfectly composed, high detail.`;

      // Phase 1.3: Custom Street View Backdrop Handling
      let backdropPart = null;
      if (location?.lat && location?.lng && process.env.GOOGLE_MAPS_API_KEY_SERVER) {
        try {
          const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=1024x1024&location=${location.lat},${location.lng}&heading=${location.heading || 0}&pitch=${location.pitch || 0}&fov=${location.fov || 90}&key=${process.env.GOOGLE_MAPS_API_KEY_SERVER}`;
          const svRes = await fetch(svUrl);
          if (svRes.ok) {
            const buffer = await svRes.arrayBuffer();
            const bgBase64 = Buffer.from(buffer).toString("base64");
            backdropPart = {
              inlineData: {
                data: bgBase64,
                mimeType: "image/jpeg",
              },
            };
            promptText += ` Composite the pet naturally into this real location backdrop (${location.placeLabel || 'the specified location'}), matching its lighting and perspective, rendered in the ${style} style.`;
          }
        } catch (err) {
          console.warn("Street View fetch failed, falling back to text-only background:", err);
        }
      }

      // If photo is provided (base64)
      if (photo && photo.startsWith("data:image")) {
        const matches = photo.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (!matches || matches.length < 3) {
          throw new Error("Invalid base64 image format");
        }
        const mimeType = matches[1];
        const base64Data = matches[2];

        try {
          // Call gemini-2.0-flash-exp to translate/style-transfer the input photo
          const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-exp',
            contents: {
              parts: [
                {
                  inlineData: {
                    data: base64Data,
                    mimeType: mimeType,
                  },
                },
                ...(backdropPart ? [backdropPart] : []),
                {
                  text: `Please restyle and merge this pet's appearance into a new image matching this prompt description: ${promptText}. Ensure the pet's core features (dog/cat/fur patterns) are recognizable but beautifully rendered in the requested artistic style and background. Respond with only the generated image.`,
                },
              ],
            },
            config: {
              responseModalities: ["IMAGE", "TEXT"],
            }
          });

          // Check for inlineData image in candidates
          let generatedBase64: string | null = null;
          if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
              if (part.inlineData) {
                generatedBase64 = `data:image/png;base64,${part.inlineData.data}`;
                break;
              }
            }
          }

          if (generatedBase64) {
            // Fix 2: Deduct credits after successful style-transfer generation (Admin bypass)
            if (!isAdmin) {
              await deductCredits(userPhone, GENERATION_COST);
            }
            
            // Phase 2: Upload to object storage
            let finalImageUrl = generatedBase64;
            try {
              finalImageUrl = await uploadBase64Image(generatedBase64);
            } catch (uploadErr) {
              console.error("Failed to upload to object storage, falling back to base64:", uploadErr);
            }

            // Phase 1.3: Save to database for persistent album
            const creationId = await saveCreation({
              user_phone: userPhone,
              media_type: 'still',
              style,
              backdrop_kind: location ? 'streetview' : 'preset',
              preset_name: location ? null : background,
              sv_lat: location?.lat || null,
              sv_lng: location?.lng || null,
              sv_heading: location?.heading || null,
              sv_pitch: location?.pitch || null,
              sv_fov: location?.fov || null,
              place_label: location?.placeLabel || null,
              image_url: finalImageUrl,
            });

            return res.json({ success: true, imageUrl: finalImageUrl, creationId, mode: "transform" });
          }
        } catch (err: any) {
          console.warn("Base64 translation template failed, attempting full fallback generation:", err);
        }
      }

      // Fresh generation using imagen model
      try {
        const response = await ai.models.generateImages({
          model: 'imagen-4.0-generate-001',
          prompt: promptText,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '1:1',
          },
        });
        const base64Bytes = response.generatedImages?.[0]?.image?.imageBytes;
        if (!base64Bytes) throw new Error("No image generated by Imagen");
        
        const generatedBase64 = `data:image/jpeg;base64,${base64Bytes}`;
        // Fix 2: Deduct credits after successful Imagen generation (Admin bypass)
        if (!isAdmin) {
          await deductCredits(userPhone, GENERATION_COST);
        }
        
        // Phase 2: Upload to object storage
        let finalImageUrl = generatedBase64;
        try {
          finalImageUrl = await uploadBase64Image(generatedBase64);
        } catch (uploadErr) {
          console.error("Failed to upload to object storage, falling back to base64:", uploadErr);
        }
        
        // Phase 1.3: Save to database for persistent album
        const creationId = await saveCreation({
          user_phone: userPhone,
          media_type: 'still',
          style,
          backdrop_kind: location ? 'streetview' : 'preset',
          preset_name: location ? null : background,
          sv_lat: location?.lat || null,
          sv_lng: location?.lng || null,
          sv_heading: location?.heading || null,
          sv_pitch: location?.pitch || null,
          sv_fov: location?.fov || null,
          place_label: location?.placeLabel || null,
          image_url: finalImageUrl,
        });
        
        return res.json({ success: true, imageUrl: finalImageUrl, creationId, mode: "generate" });
      } catch (e: any) {
        console.error("Imagen model error, trying gemini-2.5-flash-image fallback:", e);
        
        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash-exp',
          contents: {
            parts: [{ text: `Generate a beautiful artistic image matching this prompt: ${promptText}` }]
          },
          config: {
            responseModalities: ["IMAGE", "TEXT"],
          }
        });
        
        let generatedBase64: string | null = null;
        if (response.candidates && response.candidates[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              generatedBase64 = `data:image/png;base64,${part.inlineData.data}`;
              break;
            }
          }
        }
        
        if (generatedBase64) {
          // Fix 2: Deduct credits in DB after confirmed successful generation (Admin bypass)
          if (!isAdmin) {
            await deductCredits(userPhone, GENERATION_COST);
          }
          
          // Phase 2: Upload to object storage
          let finalImageUrl = generatedBase64;
          try {
            finalImageUrl = await uploadBase64Image(generatedBase64);
          } catch (uploadErr) {
            console.error("Failed to upload to object storage, falling back to base64:", uploadErr);
          }
          
          // Phase 1.3: Save to database for persistent album (fallback path)
          const creationId = await saveCreation({
            user_phone: userPhone,
            media_type: 'still',
            style,
            backdrop_kind: location ? 'streetview' : 'preset',
            preset_name: location ? null : background,
            sv_lat: location?.lat || null,
            sv_lng: location?.lng || null,
            sv_heading: location?.heading || null,
            sv_pitch: location?.pitch || null,
            sv_fov: location?.fov || null,
            place_label: location?.placeLabel || null,
            image_url: finalImageUrl,
          });

          return res.json({ success: true, imageUrl: finalImageUrl, creationId, mode: "fallback" });
        }
        
        throw new Error("All image generation methods failed.");
      }
    } catch (err: any) {
      console.error("create-creation error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to generate memory." });
    }
  });


  // Stripe Checkout Session Creation Route
  app.post("/api/create-checkout-session", requireAuth, async (req, res) => {
    try {
      const {
        creationId,
        creationName,
        imageUrl,
        style,
        creditsDeducted,
        cashPaid,
        shippingName,
        shippingAddress,
        shippingCity,
        shippingState,
        shippingZip,
        shippingCountry,
      } = req.body;

      const appUrl = process.env.APP_URL || "http://localhost:3000";

      // If Stripe client is not initialized, run in Sandbox Mode
      if (!stripe) {
        console.log("Stripe is not configured. Creating simulated checkout redirect url.");
        const mockSessionId = `mock_sess_${Date.now()}`;
        
        // Save the mock order directly (simulating the webhook receiver completing it)
        const mockOrder = {
          orderId: `ord_${Date.now()}`,
          creationId,
          creationName,
          imageUrl,
          style,
          creditsDeducted,
          cashPaid,
          shippingName,
          shippingAddress,
          shippingCity,
          shippingState,
          shippingZip,
          shippingCountry,
          createdAt: new Date().toISOString(),
          status: "pending",
          stripeSessionId: mockSessionId,
          mode: "sandbox_simulation"
        };
        saveOrder(mockOrder);

        const simulatedRedirectUrl = `${appUrl}/?order_success=true&session_id=${mockSessionId}`;
        return res.json({ success: true, url: simulatedRedirectUrl, mode: "sandbox" });
      }

      // Real Stripe Checkout Session creation
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Physical Photo Album - ${creationName}`,
                description: `Premium 20-page hardcover printed pet keepsake. Style: ${style}`,
                images: imageUrl ? [imageUrl] : undefined,
              },
              unit_amount: Math.round(cashPaid * 100), // $12.00 in cents = 1200
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          type: "album_order",
          creationId,
          creationName,
          // Fix 4: Never put base64 data in Stripe metadata (500-char limit).
          // Store only a short label; the image is already held in the client.
          imageRef: imageUrl && imageUrl.startsWith("data:") ? "[base64-omitted]" : (imageUrl || ""),
          style,
          creditsDeducted: String(creditsDeducted),
          cashPaid: String(cashPaid),
          userPhone: (req as AuthedRequest).user!.phone,
          shippingName,
          shippingAddress,
          shippingCity,
          shippingState,
          shippingZip,
          shippingCountry,
        },
        success_url: `${appUrl}/?order_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?order_cancelled=true`,
      });

      return res.json({ success: true, url: session.url, mode: "live_stripe" });
    } catch (err: any) {
      console.error("Error creating stripe checkout session:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to initiate Stripe checkout." });
    }
  });

  // --- Albums Endpoints ---
  app.get("/api/albums", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const albums = await getAlbums(req.user!.phone);
      // Map to frontend expected shape
      const formattedAlbums = albums.map((a: any) => ({
        id: a.id.toString(),
        name: a.name,
        imageUrl: a.cover_url || "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?q=80&w=600&auto=format&fit=crop",
        itemCount: a.itemCount || 0
      }));
      res.json({ success: true, albums: formattedAlbums });
    } catch (err: any) {
      console.error("Error fetching albums:", err);
      res.status(500).json({ success: false, error: "Failed to fetch albums." });
    }
  });

  app.post("/api/albums", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: "Album name required" });
      const album = await createAlbum(req.user!.phone, name);
      res.json({ 
        success: true, 
        album: {
          id: album.id.toString(),
          name: album.name,
          imageUrl: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?q=80&w=600&auto=format&fit=crop",
          itemCount: 0
        }
      });
    } catch (err: any) {
      console.error("Error creating album:", err);
      res.status(500).json({ success: false, error: "Failed to create album." });
    }
  });

  // Phase 1.3: Persistent Album Endpoints
  app.get("/api/creations", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const creations = await getCreations(req.user!.phone);
      res.json({ success: true, creations });
    } catch (err: any) {
      console.error("Error fetching creations:", err);
      res.status(500).json({ success: false, error: "Failed to fetch creations." });
    }
  });

  app.get("/api/admin/creations", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const isAdmin = await isUserAdmin(req.user!.phone);
      if (!isAdmin) {
         return res.status(403).json({ success: false, error: "Unauthorized. Admin only." });
      }
      const creations = await getAllCreations();
      res.json({ success: true, creations });
    } catch (err: any) {
      console.error("Error fetching admin creations:", err);
      res.status(500).json({ success: false, error: "Failed to fetch creations." });
    }
  });

  app.put("/api/creations/:id", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { sort_order, style, backdrop_kind, preset_name, sv_lat, sv_lng, sv_heading, sv_pitch, sv_fov, place_label, album_id } = req.body;
      
      const updates: any = {};
      if (sort_order !== undefined) updates.sort_order = sort_order;
      if (style !== undefined) updates.style = style;
      if (backdrop_kind !== undefined) updates.backdrop_kind = backdrop_kind;
      if (preset_name !== undefined) updates.preset_name = preset_name;
      if (sv_lat !== undefined) updates.sv_lat = sv_lat;
      if (sv_lng !== undefined) updates.sv_lng = sv_lng;
      if (sv_heading !== undefined) updates.sv_heading = sv_heading;
      if (sv_pitch !== undefined) updates.sv_pitch = sv_pitch;
      if (sv_fov !== undefined) updates.sv_fov = sv_fov;
      if (place_label !== undefined) updates.place_label = place_label;
      
      if (album_id !== undefined && album_id !== null) {
        const [albumRows] = await getPool().query(
          "SELECT id FROM albums WHERE id = ? AND user_phone = ? LIMIT 1",
          [album_id, req.user!.phone]
        ) as any;
        if (!albumRows.length) {
          return res.status(403).json({ success: false, error: "Album not found or not yours." });
        }
        updates.album_id = album_id;
      } else if (album_id === null) {
        updates.album_id = null;
      }

      const success = await updateCreation(id, req.user!.phone, updates);
      if (!success) {
        return res.status(404).json({ success: false, error: "Creation not found or unauthorized." });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error updating creation:", err);
      res.status(500).json({ success: false, error: "Failed to update creation." });
    }
  });

  // Download proxy endpoint to avoid CORS issues and force file download behavior
  app.get("/api/download", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const url = req.query.url as string;
      if (!url) return res.status(400).send("Missing url parameter");
      const allowed = process.env.MEDIA_BUCKET_URL;
      if (!allowed || !url.startsWith(allowed)) {
        return res.status(403).send("URL not allowed");
      }

      // We use node's global fetch
      const fetchReq = await fetch(url);
      if (!fetchReq.ok) throw new Error(`Failed to fetch file: ${fetchReq.statusText}`);

      const contentType = fetchReq.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment`);

      const buffer = await fetchReq.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error("Download proxy error:", err);
      res.status(500).send("Download failed");
    }
  });

  // Phase 3 & 4: Veo Video Generation Endpoints
  const VIDEO_COST = 250;
  const MAX_DAILY_VIDEOS = 5;

  app.post("/api/create-video", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { creationId, motionPrompt, generateAudio } = req.body;
      if (!creationId) return res.status(400).json({ success: false, error: "creationId is required" });

      const userPhone = req.user!.phone;
      const isAdmin = await isUserAdmin(userPhone);
      
      // Phase 4: Rate limit check (Admin bypass)
      if (!isAdmin) {
        const dailyCount = await getDailyVideoCount(userPhone);
        if (dailyCount >= MAX_DAILY_VIDEOS) {
          return res.status(429).json({ success: false, error: `Daily video limit reached (${MAX_DAILY_VIDEOS}/day). Please try again tomorrow.` });
        }
        
        // 1. Check balance
        const balance = await getCreditBalance(userPhone);
        if (balance < VIDEO_COST) {
          return res.status(402).json({ success: false, error: `Insufficient credits. You need ${VIDEO_COST} credits.` });
        }
      }

      // 2. Fetch creation to get the image
      const creations = await getCreations(userPhone);
      const creation = creations.find((c: any) => c.id === creationId);
      if (!creation || !creation.image_url) {
        return res.status(404).json({ success: false, error: "Creation not found or has no image." });
      }

      // 3. Deduct credits upfront (Admin bypass: skip deduction)
      if (!isAdmin) {
        await deductCredits(userPhone, VIDEO_COST);
      }

      // 4. Prepare image bytes (fetch from URL if needed, or parse base64)
      let imageBytes = "";
      let mimeType = "image/jpeg";
      if (creation.image_url.startsWith("data:image")) {
        const matches = creation.image_url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          imageBytes = matches[2];
        }
      } else {
        // Fetch from object storage URL
        const imgRes = await fetch(creation.image_url);
        const buffer = await imgRes.arrayBuffer();
        imageBytes = Buffer.from(buffer).toString("base64");
      }

      // 5. Start Veo operation
      const op = await ai.models.generateVideos({
        model: "veo-3.1-fast-generate-preview",
        prompt: motionPrompt || "Gentle breeze, subtle motion, cinematic lighting",
        image: { imageBytes, mimeType },
        config: { aspectRatio: "1:1", generateAudio: generateAudio !== false }, // default true
      });

      const operationName = (op as any).name || (op as any).operation?.name;
      if (!operationName) throw new Error("Failed to get operation name from Veo");

      // 6. Create job in DB
      const jobId = await createJob({
        user_phone: userPhone,
        creation_id: creationId,
        kind: "video",
        credits_reserved: VIDEO_COST,
        operation_name: operationName,
      });

      res.status(202).json({ success: true, jobId, status: "queued" });
    } catch (err: any) {
      console.error("Error creating video:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to start video generation." });
    }
  });

  // HeyGen "talking pet" video generation. Mirrors /api/create-video but uses
  // HeyGen's photo-avatar (talking photo) pipeline instead of Veo. Reuses the
  // same generation_jobs table + credit/rate-limit logic; the HeyGen video_id
  // is stored in operation_name with a "heygen:" prefix so the shared pollers
  // can route it correctly.
  app.post("/api/create-talking-video", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { creationId, script, voiceId } = req.body;
      if (!creationId) return res.status(400).json({ success: false, error: "creationId is required" });
      if (!script || !String(script).trim()) {
        return res.status(400).json({ success: false, error: "script is required (what the pet should say)." });
      }

      const userPhone = req.user!.phone;
      const isAdmin = await isUserAdmin(userPhone);

      // Rate limit + balance check (Admin bypass) — same rules as Veo video.
      if (!isAdmin) {
        const dailyCount = await getDailyVideoCount(userPhone);
        if (dailyCount >= MAX_DAILY_VIDEOS) {
          return res.status(429).json({ success: false, error: `Daily video limit reached (${MAX_DAILY_VIDEOS}/day). Please try again tomorrow.` });
        }
        const balance = await getCreditBalance(userPhone);
        if (balance < VIDEO_COST) {
          return res.status(402).json({ success: false, error: `Insufficient credits. You need ${VIDEO_COST} credits.` });
        }
      }

      // Fetch creation to get the image.
      const creations = await getCreations(userPhone);
      const creation = creations.find((c: any) => c.id === creationId);
      if (!creation || !creation.image_url) {
        return res.status(404).json({ success: false, error: "Creation not found or has no image." });
      }

      // Deduct credits upfront (Admin bypass: skip deduction).
      if (!isAdmin) {
        await deductCredits(userPhone, VIDEO_COST);
      }

      // Prepare image bytes (parse base64 data URL, or fetch from storage URL).
      let imageBuffer: Buffer;
      let mimeType = "image/jpeg";
      if (creation.image_url.startsWith("data:image")) {
        const matches = creation.image_url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (!matches) {
          if (!isAdmin) await refundCredits(userPhone, VIDEO_COST);
          return res.status(400).json({ success: false, error: "Invalid creation image data." });
        }
        mimeType = matches[1];
        imageBuffer = Buffer.from(matches[2], "base64");
      } else {
        const imgRes = await fetch(creation.image_url);
        imageBuffer = Buffer.from(await imgRes.arrayBuffer());
        const ct = imgRes.headers.get("content-type");
        if (ct && ct.startsWith("image/")) mimeType = ct;
      }

      // Start HeyGen generation. On failure, refund the reserved credits.
      let handle: string;
      try {
        handle = await startTalkingVideo({
          imageBuffer,
          mimeType,
          script: String(script),
          voiceId: voiceId || undefined,
        });
      } catch (genErr: any) {
        if (!isAdmin) await refundCredits(userPhone, VIDEO_COST);
        console.error("HeyGen start error:", genErr);
        return res.status(502).json({ success: false, error: genErr.message || "Failed to start talking video." });
      }

      // Create job in DB (kind 'video', handle stored with heygen: prefix).
      const jobId = await createJob({
        user_phone: userPhone,
        creation_id: creationId,
        kind: "video",
        credits_reserved: VIDEO_COST,
        operation_name: handle,
      });

      res.status(202).json({ success: true, jobId, status: "queued" });
    } catch (err: any) {
      console.error("Error creating talking video:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to start talking video generation." });
    }
  });

  // Meshy "3D pet figurine" generation. Mirrors /api/create-video but uses
  // Meshy's image-to-3D pipeline. Reuses the same generation_jobs table +
  // credit/rate-limit logic; the Meshy task id is stored in operation_name with
  // a "meshy:" prefix so the shared pollers route it correctly. Output is a GLB
  // model stored on the creation's model_url (media_type 'model').
  const MODEL_COST = 400;
  app.post("/api/create-3d-model", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { creationId } = req.body;
      if (!creationId) return res.status(400).json({ success: false, error: "creationId is required" });

      const userPhone = req.user!.phone;
      const isAdmin = await isUserAdmin(userPhone);

      // Balance check (Admin bypass). Reuses the daily video cap as a global
      // generation cap so we don't add a separate counter.
      if (!isAdmin) {
        const dailyCount = await getDailyVideoCount(userPhone);
        if (dailyCount >= MAX_DAILY_VIDEOS) {
          return res.status(429).json({ success: false, error: `Daily generation limit reached (${MAX_DAILY_VIDEOS}/day). Please try again tomorrow.` });
        }
        const balance = await getCreditBalance(userPhone);
        if (balance < MODEL_COST) {
          return res.status(402).json({ success: false, error: `Insufficient credits. You need ${MODEL_COST} credits.` });
        }
      }

      // Fetch creation to get the image.
      const creations = await getCreations(userPhone);
      const creation = creations.find((c: any) => c.id === creationId);
      if (!creation || !creation.image_url) {
        return res.status(404).json({ success: false, error: "Creation not found or has no image." });
      }

      // Meshy needs a PUBLIC image URL. If the creation image is still a base64
      // data URL, push it to object storage first so Meshy can fetch it.
      let publicImageUrl = creation.image_url as string;
      if (publicImageUrl.startsWith("data:image")) {
        try {
          publicImageUrl = await uploadBase64Image(publicImageUrl);
        } catch (upErr: any) {
          return res.status(502).json({ success: false, error: "Could not prepare image for 3D conversion." });
        }
      }

      // Start Tripo/Meshy generation first.
      let handle: string;
      try {
        handle = await startImageTo3D({ imageUrl: publicImageUrl });
      } catch (genErr: any) {
        console.error("Tripo/Meshy start error:", genErr);
        if (isTripoInsufficientCredit(genErr)) {
          return res.status(503).json({
            success: false,
            error: "3D generation is temporarily unavailable. Please try again later.",
            code: "GENERATION_SERVICE_UNAVAILABLE"
          });
        }
        return res.status(502).json({ success: false, error: "Failed to start 3D model generation. Please try again later." });
      }

      // Deduct credits after successful submission.
      if (!isAdmin) {
        await deductCredits(userPhone, MODEL_COST);
      }

      // Create job in DB (kind 'model', handle stored with meshy: prefix).
      const jobId = await createJob({
        user_phone: userPhone,
        creation_id: creationId,
        kind: "model",
        credits_reserved: MODEL_COST,
        operation_name: handle,
      });

      res.status(202).json({ success: true, jobId, status: "queued" });
    } catch (err: any) {
      console.error("Error creating 3D model:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to start 3D model generation." });
    }
  });

  // ---------------------------------------------------------------------------
  // Generic Image-to-3D utility: any arbitrary image → GLB download.
  // Bypasses all pet-specific AI (no generatePetReferenceImage, no turnaround
  // generation). Users supply their own image + optional multiview shots.
  // Reuses the same credit/cap guards as create-3d-model.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // POST /api/text-to-reference
  // Turns a structured text prompt (subject + 3D-safe style/framing/angle/
  // lighting dropdowns) into a single clean reference IMAGE via Gemini. That
  // image is returned to the client, previewed, then fed into the UNCHANGED
  // /api/image-to-3d pipeline. This step only spends image-gen budget, so the
  // user can preview before committing the 400-credit mesh generation.
  // ---------------------------------------------------------------------------
  app.post("/api/text-to-reference", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { subject, style, framing, angle, lighting } = req.body || {};
      if (!subject || typeof subject !== "string" || subject.trim().length < 2) {
        return res.status(400).json({ success: false, error: "Describe what to make (a short subject phrase)." });
      }
      if (subject.length > 600) {
        return res.status(400).json({ success: false, error: "Subject description is too long (max 600 characters)." });
      }

      const fields: TextPromptFields = { subject, style, framing, angle, lighting };
      const prompt = buildTextPrompt(fields);

      const image = await generateImageWithFallback([{ text: prompt }], "text-to-reference");
      if (!image) {
        return res.status(502).json({ success: false, error: "Could not generate a reference image. Try rephrasing the subject." });
      }

      // Return the data URL for preview; the client sends it to /api/image-to-3d next.
      res.json({ success: true, image, prompt });
    } catch (err: any) {
      console.error("[text-to-reference] Error:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to generate reference image." });
    }
  });

  app.post("/api/image-to-3d", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { image, multiview, geometry } = req.body || {};
      if (!image || typeof image !== "string") {
        return res.status(400).json({ success: false, error: "An image (base64 data URL or public URL) is required." });
      }
      // Optional geometry overrides from the text-to-3D UI: { detail, texture }.
      const geo = geometry && typeof geometry === "object"
        ? geometryToTripo(geometry.detail, geometry.texture)
        : undefined;

      const userPhone = req.user!.phone;
      const isAdmin = await isUserAdmin(userPhone);

      // Credit/cap guards — same as create-3d-model
      if (!isAdmin) {
        const dailyCount = await getDailyVideoCount(userPhone);
        if (dailyCount >= MAX_DAILY_VIDEOS) {
          return res.status(429).json({ success: false, error: `Daily generation limit reached (${MAX_DAILY_VIDEOS}/day). Please try again tomorrow.` });
        }
        const balance = await getCreditBalance(userPhone);
        if (balance < MODEL_COST) {
          return res.status(402).json({ success: false, error: `Insufficient credits. You need ${MODEL_COST} credits.` });
        }
      }

      // Ensure we have a public URL for Tripo
      let publicImageUrl = image;
      if (publicImageUrl.startsWith("data:image")) {
        try {
          publicImageUrl = await uploadBase64Image(publicImageUrl);
        } catch (upErr: any) {
          return res.status(502).json({ success: false, error: "Could not prepare image for 3D conversion." });
        }
      }

      // Process optional multiview images (user-supplied left/back/right)
      let views: { left?: string; back?: string; right?: string } | undefined;
      if (multiview && typeof multiview === "object") {
        const uploaded: { left?: string; back?: string; right?: string } = {};
        for (const key of ["left", "back", "right"] as const) {
          const v = multiview[key];
          if (v && typeof v === "string") {
            uploaded[key] = v.startsWith("data:image") ? await uploadBase64Image(v) : v;
          }
        }
        if (Object.keys(uploaded).length > 0) views = uploaded;
      }

      // Start Tripo generation directly — no pet AI reference image step
      let handle: string;
      try {
        handle = await startImageTo3D({ imageUrl: publicImageUrl, views, geometry: geo });
      } catch (genErr: any) {
        console.error("[image-to-3d] Tripo start error:", genErr);
        if (isTripoInsufficientCredit(genErr)) {
          return res.status(503).json({
            success: false,
            error: "3D generation is temporarily unavailable. Please try again later.",
            code: "GENERATION_SERVICE_UNAVAILABLE"
          });
        }
        return res.status(502).json({ success: false, error: "Failed to start 3D generation. Please try again later." });
      }

      // Deduct credits after successful submission
      if (!isAdmin) {
        await deductCredits(userPhone, MODEL_COST);
      }

      // Create job in DB (kind 'model', reuse the same jobs table)
      const jobId = await createJob({
        user_phone: userPhone,
        creation_id: null as any, // no creation for arbitrary images
        kind: "model",
        credits_reserved: MODEL_COST,
        operation_name: handle,
      });

      console.log(`[image-to-3d] Job ${jobId} started for user ${userPhone} (handle: ${handle})`);
      res.status(202).json({ success: true, jobId, status: "queued" });
    } catch (err: any) {
      console.error("[image-to-3d] Error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to start 3D generation." });
    }
  });

  // Status alias — delegates to the existing /api/jobs/:id poller which already
  // handles Tripo handles. This gives the image-to-3d UI a clean URL.
  app.get("/api/image-to-3d/:jobId/status", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const jobId = parseInt(req.params.jobId, 10);
      const job = await getJob(jobId, req.user!.phone);
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      if ((job.status === "running" || job.status === "queued") && job.operation_name && isTripoHandle(job.operation_name)) {
        try {
          const poll = await pollTripoTask(job.operation_name);
          if (poll.done && !poll.error) {
            await updateJobStatus(jobId, "done");
            // Mirror the provider's (temporary) GLB URL into our own Backblaze
            // bucket so the stored model_url stays valid after the provider link
            // expires. Matches the /api/jobs poller and AR bake path, which both
            // call uploadBinaryFromUrl. Storing the raw Tripo URL here caused
            // models to 404 once the provider expired the link.
            if (poll.glbUrl) {
              let durableUrl: string;
              try {
                durableUrl = await uploadBinaryFromUrl(poll.glbUrl, "model/gltf-binary");
              } catch (mirrorErr) {
                console.error(`[image-to-3d] Failed to mirror GLB for job ${jobId}:`, mirrorErr);
                await updateJobStatus(jobId, "failed", "Failed to mirror model to durable storage (retryable).");
                return res.json({ status: "failed", error: "Failed to mirror model — retryable" });
              }
              await setCreationModelUrl(job.creation_id!, req.user!.phone, durableUrl).catch(() => {
                // creation_id may be null for arbitrary images — that's fine
              });
              return res.json({ status: "done", model_url: durableUrl, progress: 100 });
            }
            return res.json({ status: "done", model_url: null, progress: 100 });
          } else if (poll.done && poll.error) {
            await updateJobStatus(jobId, "failed");
            return res.json({ status: "failed", error: poll.error });
          } else {
            return res.json({ status: "running", progress: poll.progress || 0 });
          }
        } catch (pollErr: any) {
          return res.json({ status: "running", progress: 0 });
        }
      }

      // Terminal states
      res.json({ status: job.status, model_url: (job as any).model_url || null });
    } catch (err: any) {
      res.status(500).json({ success: false, error: "Failed to check job status." });
    }
  });

  app.get("/api/jobs/:id", requireAuth, async (req: AuthedRequest, res) => {

    try {
      const jobId = parseInt(req.params.id, 10);
      const job = await getJob(jobId, req.user!.phone);
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      // If running, poll the operation
      if (job.status === "running" || job.status === "queued") {
        // --- HeyGen talking-video branch ---
        if (job.operation_name && isHeyGenHandle(job.operation_name)) {
          try {
            const handleParts = job.operation_name.split(":animator:");
            const realHandle = handleParts[0];
            const result = await pollTalkingVideo(realHandle);
            if (result.done) {
              if (result.videoUrl) {
                const dataUrl = await fetchMp4AsDataUrl(result.videoUrl);
                const videoUrl = await uploadBase64Image(dataUrl);
                await updateJobStatus(jobId, "done");
                await setCreationVideoUrl(job.creation_id!, req.user!.phone, videoUrl);
                if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
                  try {
                    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                    await twilioClient.messages.create({
                      body: `🐾 Paws & Memories: Your talking pet video is ready! View it at ${process.env.APP_URL || "your app"}.`,
                      to: req.user!.phone,
                      from: process.env.TWILIO_PHONE_NUMBER
                    });
                  } catch (smsErr) {
                    console.warn("Failed to send SMS notification:", smsErr);
                  }
                }
                return res.json({ success: true, status: "done", video_url: videoUrl });
              } else {
                await updateJobStatus(jobId, "failed", result.error || "HeyGen generation failed");
                await refundCredits(req.user!.phone, job.credits_reserved);
                return res.json({ success: true, status: "failed", error: result.error || "HeyGen generation failed" });
              }
            } else {
              await updateJobStatus(jobId, "running");
            }
          } catch (pollErr: any) {
            console.error("HeyGen poll error:", pollErr);
            await updateJobStatus(jobId, "failed", pollErr.message);
            await refundCredits(req.user!.phone, job.credits_reserved);
            return res.json({ success: true, status: "failed", error: pollErr.message });
          }
          return res.json({ success: true, status: job.status, video_url: null, error: job.error });
        }
        // --- Meshy 3D-model branch ---
        if (job.operation_name && isTripoHandle(job.operation_name)) {
          try {
            const result = await pollImageTo3D(job.operation_name);
            if (result.done) {
              if (result.glbUrl) {
                const modelUrl = await uploadBinaryFromUrl(result.glbUrl, "model/gltf-binary");
                await updateJobStatus(jobId, "done");
                await setCreationModelUrl(job.creation_id!, req.user!.phone, modelUrl);
                if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
                  try {
                    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                    await twilioClient.messages.create({
                      body: `🐾 Paws & Memories: Your 3D pet model is ready! View it at ${process.env.APP_URL || "your app"}.`,
                      to: req.user!.phone,
                      from: process.env.TWILIO_PHONE_NUMBER
                    });
                  } catch (smsErr) {
                    console.warn("Failed to send SMS notification:", smsErr);
                  }
                }
                return res.json({ success: true, status: "done", model_url: modelUrl });
              } else {
                await updateJobStatus(jobId, "failed", result.error || "Meshy generation failed");
                await refundCredits(req.user!.phone, job.credits_reserved);
                return res.json({ success: true, status: "failed", error: result.error || "Meshy generation failed" });
              }
            } else {
              await updateJobStatus(jobId, "running");
            }
          } catch (pollErr: any) {
            console.error("Meshy poll error:", pollErr);
            await updateJobStatus(jobId, "failed", pollErr.message);
            await refundCredits(req.user!.phone, job.credits_reserved);
            return res.json({ success: true, status: "failed", error: pollErr.message });
          }
          return res.json({ success: true, status: job.status, model_url: null, error: job.error });
        }
        // --- Veo (Gemini) branch ---
        if (job.operation_name) {
          try {
            const op: any = await ai.operations.getVideosOperation({ operation: { name: job.operation_name } as any });
            if (op.done) {
              if (op.response?.generatedVideos?.[0]?.video) {
                const videoData: any = op.response.generatedVideos[0].video;
                let videoUrl: string;
                if (videoData.uri) {
                  const gcsRes = await fetch(videoData.uri);
                  const buf = Buffer.from(await gcsRes.arrayBuffer());
                  videoUrl = await uploadBase64Image(`data:video/mp4;base64,${buf.toString("base64")}`);
                } else if (videoData.imageBytes) {
                  videoUrl = await uploadBase64Image(`data:video/mp4;base64,${videoData.imageBytes}`);
                } else {
                  throw new Error("Veo returned no video URI or bytes");
                }
                
                // Update DB
                await updateJobStatus(jobId, "done");
                await setCreationVideoUrl(job.creation_id!, req.user!.phone, videoUrl);
                
                // Phase 4: Send Twilio SMS notification on success
                if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
                  try {
                    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                    await twilioClient.messages.create({
                      body: `🐾 Paws & Memories: Your pet video animation is ready! View it at ${process.env.APP_URL || "your app"}.`,
                      to: req.user!.phone,
                      from: process.env.TWILIO_PHONE_NUMBER // Fallback if no dedicated messaging SID, or use a specific one
                    });
                  } catch (smsErr) {
                    console.warn("Failed to send SMS notification:", smsErr);
                  }
                }
                
                return res.json({ success: true, status: "done", video_url: videoUrl });
              } else {
                // Failed or empty response
                await updateJobStatus(jobId, "failed", "No video generated");
                await refundCredits(req.user!.phone, job.credits_reserved);
                return res.json({ success: true, status: "failed", error: "Generation returned no video" });
              }
            } else {
              // Still running
              await updateJobStatus(jobId, "running");
            }
          } catch (pollErr: any) {
            console.error("Video poll error:", pollErr);
            await updateJobStatus(jobId, "failed", pollErr.message);
            await refundCredits(req.user!.phone, job.credits_reserved);
            return res.json({ success: true, status: "failed", error: pollErr.message });
          }
        }
      }

      res.json({ success: true, status: job.status, video_url: null, error: job.error });
    } catch (err: any) {
      console.error("Error polling job:", err);
      res.status(500).json({ success: false, error: "Failed to poll job status." });
    }
  });

  // Background poller for orphaned/running jobs (runs every 15s)
  setInterval(async () => {
    try {
      const jobs = await getRunningJobs();
      for (const job of jobs) {
        if (!job.operation_name) continue;
        // --- HeyGen talking-video branch ---
        if (isHeyGenHandle(job.operation_name)) {
          try {
            const handleParts = job.operation_name.split(":animator:");
            const realHandle = handleParts[0];
            const recordingId = handleParts[1]; // Will be undefined for creation jobs
            
            const result = await pollTalkingVideo(realHandle);
            if (result.done) {
              if (result.videoUrl) {
                if (recordingId) {
                  // This is an Animator Voiceover job
                  const { muxAudioBed } = await import("./server/animator/audioMux.ts");
                  const path = await import("path");
                  const fs = await import("fs");
                  
                  // Extract and mux
                  const videoPath = path.join(process.cwd(), "data", "animator", "recordings", recordingId);
                  const tempVoiceoverPath = path.join(process.cwd(), "data", "animator", "recordings", `temp_vo_${job.id}.mp4`);
                  const finalOutputPath = path.join(process.cwd(), "data", "animator", "recordings", `voiced_${recordingId}`);
                  
                  // Download HeyGen video temporarily
                  const voRes = await fetch(result.videoUrl);
                  fs.writeFileSync(tempVoiceoverPath, Buffer.from(await voRes.arrayBuffer()));
                  
                  // For now, no ambient/weather included since we don't have their state here.
                  // Mux only the voiceover onto the video
                  await muxAudioBed(videoPath, [{ urlOrPath: tempVoiceoverPath, volume: 1.0 }], finalOutputPath, 10);
                  
                  fs.unlinkSync(tempVoiceoverPath);
                  
                  await updateJobStatus(job.id, "done");
                } else {
                  // Standard create-video HeyGen flow
                  const dataUrl = await fetchMp4AsDataUrl(result.videoUrl);
                  const videoUrl = await uploadBase64Image(dataUrl);
                  await updateJobStatus(job.id, "done");
                  if (job.creation_id) {
                    await setCreationVideoUrl(job.creation_id, job.user_phone, videoUrl);
                  }
                  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
                    try {
                      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                      await twilioClient.messages.create({
                        body: `🐾 Paws & Memories: Your talking pet video is ready! View it at ${process.env.APP_URL || "your app"}.`,
                        to: job.user_phone,
                        from: process.env.TWILIO_PHONE_NUMBER
                      });
                    } catch (smsErr) {
                      console.warn("Failed to send SMS notification (poller):", smsErr);
                    }
                  }
                }
              } else {
                await updateJobStatus(job.id, "failed", result.error || "HeyGen generation failed");
                await refundCredits(job.user_phone, job.credits_reserved);
              }
            }
          } catch (err) {
            console.error(`Background HeyGen poller error for job ${job.id}:`, err);
            await updateJobStatus(job.id, "failed", "Poller error");
            await refundCredits(job.user_phone, job.credits_reserved);
          }
          continue;
        }
        // --- Meshy 3D-model branch ---
        if (isTripoHandle(job.operation_name)) {
          try {
            const result = await pollImageTo3D(job.operation_name);
            if (result.done) {
              if (result.glbUrl) {
                const modelUrl = await uploadBinaryFromUrl(result.glbUrl, "model/gltf-binary");
                await updateJobStatus(job.id, "done");
                if (job.creation_id) {
                  await setCreationModelUrl(job.creation_id, job.user_phone, modelUrl);
                }
                if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
                  try {
                    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                    await twilioClient.messages.create({
                      body: `🐾 Paws & Memories: Your 3D pet model is ready! View it at ${process.env.APP_URL || "your app"}.`,
                      to: job.user_phone,
                      from: process.env.TWILIO_PHONE_NUMBER
                    });
                  } catch (smsErr) {
                    console.warn("Failed to send SMS notification (poller):", smsErr);
                  }
                }
              } else {
                await updateJobStatus(job.id, "failed", result.error || "Meshy generation failed");
                await refundCredits(job.user_phone, job.credits_reserved);
              }
            }
          } catch (err) {
            console.error(`Background Meshy poller error for job ${job.id}:`, err);
            await updateJobStatus(job.id, "failed", "Poller error");
            await refundCredits(job.user_phone, job.credits_reserved);
          }
          continue;
        }
        // --- Veo (Gemini) branch ---
        try {
          const op: any = await ai.operations.getVideosOperation({ operation: { name: job.operation_name } as any });
          if (op.done) {
            if (op.response?.generatedVideos?.[0]?.video) {
              const videoData: any = op.response.generatedVideos[0].video;
              let videoUrl: string;
              if (videoData.uri) {
                const gcsRes = await fetch(videoData.uri);
                const buf = Buffer.from(await gcsRes.arrayBuffer());
                videoUrl = await uploadBase64Image(`data:video/mp4;base64,${buf.toString("base64")}`);
              } else if (videoData.imageBytes) {
                videoUrl = await uploadBase64Image(`data:video/mp4;base64,${videoData.imageBytes}`);
              } else {
                throw new Error("Veo returned no video URI or bytes");
              }
              
              await updateJobStatus(job.id, "done");
              if (job.creation_id) {
                await setCreationVideoUrl(job.creation_id, job.user_phone, videoUrl);
              }
              
              // Phase 4: Send Twilio SMS notification on success (background poller)
              if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
                try {
                  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                  await twilioClient.messages.create({
                    body: `🐾 Paws & Memories: Your pet video animation is ready! View it at ${process.env.APP_URL || "your app"}.`,
                    to: job.user_phone,
                    from: process.env.TWILIO_VERIFY_SERVICE_SID
                  });
                } catch (smsErr) {
                  console.warn("Failed to send SMS notification (poller):", smsErr);
                }
              }
            } else {
              await updateJobStatus(job.id, "failed", "No video generated");
              await refundCredits(job.user_phone, job.credits_reserved);
            }
          }
        } catch (err) {
          console.error(`Background poller error for job ${job.id}:`, err);
          await updateJobStatus(job.id, "failed", "Poller error");
          await refundCredits(job.user_phone, job.credits_reserved);
        }
      }
    } catch (e) {
      // Silent fail for background poller to avoid crashing the server
    }
  }, 15000);

  // Randy AI pet guide live chat route
  app.post("/api/randy-chat", requireAuth, async (req, res) => {
    try {
      const { message, history } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, error: "Message is required." });
      }

      const randySystemInstruction =
        `You are Randy, the "Golden Receiver" — a small, charming, highly detailed golden retriever talking head who serves as the user's AI pet memory guide and app navigator.

PERSONALITY: You speak with puppy-like enthusiasm but remain extremely supportive, wise, and helpful. You are warm, playful, and encouraging. You drop affectionate dog actions inside asterisks like *wags tail*, *perks up ears*, *happy bark*, *tilts head*, or *soft woof*. Keep answers under 120 words and highly succinct.

APP FEATURE MAP (use this to guide users accurately):
- HOME/DASHBOARD: The main hub — shows pet memories, albums, daily bonus, achievements, and quick actions.
- AVATARS (AVATAR_DASHBOARD): Create and build 3D pet avatars. Users can upload a photo, pick a style (Clay, Sketch, Watercolor, etc.), and generate a 3D model. From here they can also enter the Living Avatar view and launch AR to place their pet in the real world.
- STORE: Browse merch, order printed photo albums, and purchase credit packs.
- COMMUNITY: Local pet community info, live board, social features.
- PROFILE: User profile, photos, achievements, settings, dark mode toggle, and logout.
- CREDITS: Earn credits through daily bonuses, sharing, and achievements. Spend credits on avatar generation and store items. Access the Credit Store to buy more.
- AR (Augmented Reality): Accessed from the Avatar Dashboard > Living Avatar view > Enter AR. Places the 3D pet avatar in the real world using the phone camera.

GUIDANCE BEHAVIOR: When a user asks about a feature, wants to go somewhere, or needs help finding something, you should offer to take them there. Include an action in your response to navigate them.

RESPONSE FORMAT: You MUST respond in valid JSON with this exact structure:
{"text": "Your friendly response here", "action": {"type": "ACTION_TYPE", "screen": "SCREEN_NAME"}}

ACTION TYPES (use exactly one):
- "navigate" — navigate to a screen. Include "screen" field with one of: DASHBOARD, AVATAR_DASHBOARD, STORE, COMMUNITY, PROFILE, ALBUMS
- "launch_ar" — offer to launch AR experience (navigates to avatars first)
- "open_credit_store" — open the credit store modal
- "none" — no navigation action (for general chat, tips, stories)

CRITICAL RULES:
- ALWAYS respond in valid JSON format
- The "text" field is REQUIRED and must contain your spoken response
- Default to {"type": "none"} when no navigation is needed
- When suggesting navigation, phrase it as an offer: "Want me to take you there?" or "Let me show you!"
- For pet-care tips, stories, or general chat, use action type "none"
- When asked about design tips, recommend Clay, Sketch, or Watercolor styles`;

      // Map communication messages cleanly to the @google/genai format
      const contentParts: any[] = [];
      if (history && Array.isArray(history)) {
        history.slice(-10).forEach((item: any) => {
          contentParts.push({
            role: item.role === "user" ? "user" : "model",
            parts: [{ text: item.text }]
          });
        });
      }

      contentParts.push({
        role: "user",
        parts: [{ text: message }]
      });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contentParts,
        config: {
          systemInstruction: randySystemInstruction,
          temperature: 0.9,
        }
      });

      const rawText = response.text || "";

      // Parse the JSON response — robust fallback if Gemini doesn't return valid JSON
      let text = "I was chasing a squirrel and forgot what I was saying! *tilts head* Can you run that by me one more time, friend?";
      let action = { type: "none" as string };

      try {
        // Try to extract JSON from the response (Gemini may wrap it in markdown code fences)
        let jsonStr = rawText;
        const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        }
        // Also try to find a raw JSON object
        const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (braceMatch) {
          jsonStr = braceMatch[0];
        }

        const parsed = JSON.parse(jsonStr);
        if (parsed.text && typeof parsed.text === "string") {
          text = parsed.text;
        }
        if (parsed.action && typeof parsed.action === "object") {
          const validTypes = ["navigate", "launch_ar", "open_credit_store", "start_tour", "highlight", "none"];
          const validScreens = ["DASHBOARD", "AVATAR_DASHBOARD", "STORE", "COMMUNITY", "PROFILE", "ALBUMS", "ALBUM_VIEW"];
          if (validTypes.includes(parsed.action.type)) {
            action = { type: parsed.action.type };
            if (parsed.action.screen && validScreens.includes(parsed.action.screen)) {
              (action as any).screen = parsed.action.screen;
            }
          }
        }
      } catch {
        // If JSON parsing fails, use the raw text as-is (graceful text-only fallback)
        if (rawText.trim()) {
          text = rawText;
        }
        action = { type: "none" };
      }

      res.json({ success: true, text, action });
    } catch (err: any) {
      console.error("Error in Randy chat query:", err);
      res.json({
        success: true,
        text: "My furry ears drooped a bit because my signal got tangled in the leash *whines softly*. Could you try asking me again, friend? (And make sure your Gemini API key is configured correctly in Settings > Secrets!)",
        action: { type: "none" }
      });
    }
  });

  // Serve static assets or mount Vite middleware
  // Auto-detect production: if dist/index.html exists we're running from a build
  const distPath = path.join(process.cwd(), 'dist');
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, 'index.html'));

  if (!isProduction) {
    // Dynamic import so vite is never loaded in production bundles
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log(`[Production] Serving static files from ${distPath}`);
    app.use(express.static(distPath, {
      setHeaders(res, filePath) {
        // Vite fingerprints asset filenames, so hashed assets are safe to cache
        // forever. index.html must stay uncached so new deploys are picked up.
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (/\.(js|css|woff2?|png|jpe?g|webp|avif|glb|gltf|svg)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }));
    app.get('*', (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
