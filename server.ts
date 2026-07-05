import express from "express";
import path from "path";
// Vite is imported dynamically below — only in dev mode
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import Stripe from "stripe";
import fs from "fs";
import twilio from "twilio";
import rateLimit from "express-rate-limit";
import { initDb, findUserByPhone, findUserByEmail, createUserByEmail, EmailTakenError, completeUserProfile, toPublicUser, deductCredits, addCredits, getCreditBalance, saveCreation, getCreations, getAllCreations, updateCreation, createJob, updateJobStatus, getJob, getRunningJobs, refundCredits, setCreationVideoUrl, setCreationModelUrl, getDailyVideoCount, isUserAdmin, addPet, getPets, updatePet, deletePet, createAlbum, getAlbums, createAvatar, updateAvatarModel, updateAvatarGenerationStatus, getAvatarById, getAvatars, feedAvatar, waterAvatar, giveTreatToAvatar, getAvatarNeeds, saveAvatarNeeds, getPlacedObjects, addPlacedObject, deletePlacedObject, updateAvatarRiggedModel, getPool, claimDailyStreak, claimAchievement } from "./db";
import { uploadBase64Image, uploadBinaryFromUrl, fetchUrlAsBase64 } from "./storage";
import { runBuildPipeline } from "./agent/graph/orchestrator";
import { analyzePetImage } from "./ollama-agent";
import { getBlenderClient } from "./agent/tools/blender_client";
import { startTalkingVideo, pollTalkingVideo, fetchMp4AsDataUrl, isHeyGenHandle } from "./heygen";
import { startImageTo3D, pollImageTo3D, isTripoHandle } from "./tripo";
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
        await addCredits(metadata.userPhone, creditsToAdd);
        console.log(`✅ Added ${creditsToAdd} credits to ${metadata.userPhone} via Stripe purchase.`);
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

  // ---------------------------------------------------------------------------
  // Authentication: email/password + session tokens (JWT)
  // ---------------------------------------------------------------------------

  // Step 1: create an account with email + password (profile still incomplete).
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
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
      const email = String(req.body?.email || "").trim();
      const password = String(req.body?.password || "");
      if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
      
      const [rows] = await getPool().query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]) as any;
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
  const REFERENCE_IMAGE_PROMPT =
    `You are given one or more reference photos, all of the SAME pet. ` +
    `Generate ONE hyper-realistic, photographic image of this exact pet. ` +
    `Requirements: full body visible with margin on all sides; the pet is standing squarely on all four legs; ` +
    `body and head facing directly forward toward the camera; mouth slightly open in a gentle, relaxed panting ` +
    `expression with the tongue just visible. Faithfully preserve the pet's exact fur colors, markings, patterns, ` +
    `eye color, ear shape, and breed characteristics as seen across ALL reference photos. ` +
    `Extremely high detail and texture: individual fur strands, whiskers, moist nose, natural eye reflections. ` +
    `Sharp focus, even soft studio lighting, plain neutral light-gray seamless background, no shadows cast on walls, ` +
    `no props, no people, no text, no watermark. Respond with only the generated image.`;

  async function generatePetReferenceImage(photos: string[]): Promise<string | null> {
    const imageParts = photos
      .map((p) => {
        const matches = p.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (!matches || matches.length < 3) return null;
        return { inlineData: { data: matches[2], mimeType: matches[1] } };
      })
      .filter((p): p is { inlineData: { data: string; mimeType: string } } => p !== null);

    if (imageParts.length === 0) return null;

    // Try the dedicated image model first, then fall back to the model already used elsewhere in this app.
    for (const model of ["gemini-2.5-flash-image", "gemini-2.0-flash-exp"]) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [...imageParts, { text: REFERENCE_IMAGE_PROMPT }] },
          config: { imageConfig: { aspectRatio: "1:1" } },
        });
        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
        console.warn(`[referenceImage] ${model} returned no image part.`);
      } catch (err) {
        console.warn(`[referenceImage] ${model} failed:`, err);
      }
    }
    return null;
  }

  app.post("/api/avatars", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { name, photo, photos } = req.body;
      // Accept new multi-photo payload; keep backward compat with single `photo`.
      const photoList: string[] = Array.isArray(photos) && photos.length > 0
        ? photos.filter((p: unknown) => typeof p === "string" && p.length > 0)
        : (photo ? [photo] : []);

      if (!name || photoList.length === 0) {
        return res.status(400).json({ error: "Name and at least one photo required." });
      }
      if (photoList.length > 5) {
        return res.status(400).json({ error: "Maximum 5 photos per avatar." });
      }

      // Layer 1: generate a single hyper-realistic reference image from all photos.
      let sourceImage = await generatePetReferenceImage(photoList);
      let usedReferenceImage = true;
      if (!sourceImage) {
        console.warn("[POST /api/avatars] Reference image generation failed; falling back to first uploaded photo.");
        sourceImage = photoList[0];
        usedReferenceImage = false;
      }

      let finalImageUrl = sourceImage;
      if (sourceImage.startsWith("data:image")) {
        finalImageUrl = await uploadBase64Image(sourceImage);
      }

      // Layer 2: start Tripo3D generation from the reference image.
      const handle = await startImageTo3D({ imageUrl: finalImageUrl });
      const avatarId = await createAvatar(req.user!.phone, name, finalImageUrl, handle);

      res.json({ avatarId, status: "pending", referenceImageUrl: finalImageUrl, usedReferenceImage });
    } catch (err: any) {
      console.error("[POST /api/avatars] Error creating avatar:", err);
      res.status(500).json({ error: err.message || "Failed to create avatar." });
    }
  });

  const avatarBuildLocks = new Set<number>();
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
          await updateAvatarGenerationStatus(avatarId, "rigging");
          
          const avatarPhone = req.user!.phone;
          const originalImageUrl = avatar.image_url;
          const glbUrl = poll.glbUrl!;
          
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
                
                const petAnalysis = await analyzePetImage(originalImageBase64);
                
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
                   let finalModelUrl = glbUrl;
                   let finalSpriteSheetUrl = "";
                   if (buildState.riggedGlbBase64) {
                      finalModelUrl = await uploadBase64Image(buildState.riggedGlbBase64);
                   }
                   if (buildState.spriteSheetBase64) {
                      finalSpriteSheetUrl = await uploadBase64Image(buildState.spriteSheetBase64);
                   }
                   
                   await updateAvatarModel(avatarId, avatarPhone, finalModelUrl, finalSpriteSheetUrl, buildState.animationMetadata || {});

                   // Phase 5: bake named skeletal clips onto the rigged model.
                   // Fail-safe: any error here is logged and swallowed so the avatar
                   // still completes with model_url + sprites (procedural motion in the 3D view).
                   if (buildState.riggedGlbBase64) {
                      try {
                         await updateAvatarGenerationStatus(avatarId, "baking_clips");
                         const { riggedGlbBase64, clips } = await getBlenderClient()
                            .bakeClipsAndWait(buildState.riggedGlbBase64);
                         const riggedUrl = await uploadBase64Image(riggedGlbBase64);
                         await updateAvatarRiggedModel(avatarId, avatarPhone, riggedUrl, clips);
                         console.log(`[Avatar ${avatarId}] Baked ${clips.length} skeletal clips.`);
                      } catch (clipErr: any) {
                         console.warn(`[Avatar ${avatarId}] Skeletal clip baking skipped: ${clipErr?.message || clipErr}`);
                      }
                   }

                   await updateAvatarGenerationStatus(avatarId, "done");
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

      if (avatar.generation_status !== "failed" && avatar.generation_status !== "done") {
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
        const handle = await startImageTo3D({ imageUrl: finalImageUrl });
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
  const CREDIT_PACKS = [
    { id: "pack_100",  credits: 100,  price: 1.99,  label: "Starter Pack" },
    { id: "pack_300",  credits: 300,  price: 4.99,  label: "Popular Pack" },
    { id: "pack_700",  credits: 700,  price: 9.99,  label: "Pro Pack" },
    { id: "pack_1500", credits: 1500, price: 17.99, label: "Studio Pack" },
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
        success_url: `${appUrl}/?credits_success=true&pack=${pack.id}&added=${pack.credits}`,
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
              imageConfig: {
                aspectRatio: "1:1",
              }
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
            imageConfig: {
              aspectRatio: "1:1",
            }
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

      // Deduct credits upfront (Admin bypass: skip deduction).
      if (!isAdmin) {
        await deductCredits(userPhone, MODEL_COST);
      }

      // Start Meshy generation. On failure, refund the reserved credits.
      let handle: string;
      try {
        handle = await startImageTo3D({ imageUrl: publicImageUrl });
      } catch (genErr: any) {
        if (!isAdmin) await refundCredits(userPhone, MODEL_COST);
        console.error("Meshy start error:", genErr);
        return res.status(502).json({ success: false, error: genErr.message || "Failed to start 3D model generation." });
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
            const result = await pollTalkingVideo(job.operation_name);
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
            const result = await pollTalkingVideo(job.operation_name);
            if (result.done) {
              if (result.videoUrl) {
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
        "You are Randy, a charming, whimsical, and highly empathetic clay golden retriever puppy who acts as the user's AI pet memory guide. " +
        "You speak with puppy-like enthusiasm but remain extremely supportive, wise, and helpful. " +
        "You can offer pet-care tips, guide users on restyling or capturing photos of their pets using their camera, and share heartwarming pet stories or golden retriever wisdom. " +
        "Do not use generic assistant boilerplate or pretend you cannot help. Keep answers highly succinct (under 120 words) and playful, often dropping affectionate dog actions inside asterisks like *wags tail*, *perks up ears*, *happy bark*, *tilts head*, or *soft woof*. " +
        "When asked about design tips, recommend they try the Clay, Sketch, or Watercolor Watercolor options.";

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

      const text = response.text || "I was chasing a squirrel and forgot what I was saying! *tilts head* Can you run that by me one more time, friend?";
      res.json({ success: true, text });
    } catch (err: any) {
      console.error("Error in Randy chat query:", err);
      res.json({ 
        success: true, 
        text: "My furry ears drooped a bit because my signal got tangled in the leash *whines softly*. Could you try asking me again, friend? (And make sure your Gemini API key is configured correctly in Settings > Secrets!)" 
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
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
