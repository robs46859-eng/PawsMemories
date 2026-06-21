import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import Stripe from "stripe";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { execSync } from "child_process";
import twilio from "twilio";
import { initDb, findUserByPhone, findUserByEmail, createUserByEmail, EmailTakenError, completeUserProfile, toPublicUser, deductCredits, addCredits, getCreditBalance, saveCreation, getCreations, getAllCreations, updateCreation, createJob, updateJobStatus, getJob, getRunningJobs, refundCredits, setCreationVideoUrl, getDailyVideoCount, isUserAdmin, addPet, getPets, updatePet, deletePet, createAlbum, getAlbums, getPool, createPhotoRequest, getPhotoRequests, getAllPhotoRequests, getPhotoRequest, markPhotoRequestPaid, fulfillPhotoRequest, rejectPhotoRequest, getPhotoRequestByStripeSession } from "./db";
import { uploadBase64Image } from "./storage";
import { createAvatar, getAvatars, feedAvatar, waterAvatar, giveTreatToAvatar, updateAvatarModel, updateAvatarGenerationStatus, getAvatarById } from "./db";
import { generateMeshFromImage } from "./huggingface-3d";
import { analyzePetImage, generateRiggingScript, generateSpriteAnimationScript } from "./ollama-agent";
import type { PetAnalysis } from "./ollama-agent";
import { BACKGROUND_PROMPTS } from "./src/backgrounds";
import {
  normalizeEmail,
  signToken,
  requireAuth,
  hashPassword,
  verifyPassword,
  type AuthedRequest,
} from "./auth";

dotenv.config();

// Global safety net: prevent unhandled promise rejections from crashing the
// server process. On Hostinger, a crashed process causes the reverse proxy
// to return 502 for all requests until the process restarts.
process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ Unhandled Promise Rejection (server kept alive):", reason);
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

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

    // Handle photo_request_payment: mark request as paid and send Twilio SMS
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata || {};

      if (metadata.type === "photo_request_payment" && session.payment_status === "paid") {
        const amountPaid = (session.amount_total || 0) / 100;
        const request = await markPhotoRequestPaid(session.id, amountPaid);
        if (request) {
          console.log(`✅ Photo request #${request.id} marked paid ($${amountPaid}).`);
          // Notify user via SMS
          try {
            const twilioClient = (global as any).__twilioClient;
            if (twilioClient && process.env.TWILIO_PHONE_NUMBER && metadata.userPhone) {
              const user = await findUserByPhone(metadata.userPhone);
              await twilioClient.messages.create({
                body: `🐾 Paws & Memories: Your ${metadata.request_label || 'memory'} request has been received and paid! We'll craft it personally and notify you when it's ready.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: metadata.userPhone,
              });
            }
          } catch (smsErr) {
            console.warn('Photo request paid SMS failed (non-fatal):', smsErr);
          }
        }
      }
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
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.google.com https://*.googleapis.com",
        "script-src-elem 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.google.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://maps.googleapis.com",
        "worker-src 'self' blob:",
        "img-src 'self' blob: data: https: http://localhost:*",
        "connect-src 'self' https://maps.googleapis.com https://*.googleapis.com https://maps.google.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "frame-src 'self' https://*.google.com https://js.stripe.com",
      ].join("; ")
    );
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ---------------------------------------------------------------------------
  // Authentication: email + password + session tokens (JWT)
  // ---------------------------------------------------------------------------

  // Step 1: create an account with email + password. Returns a session token.
  // The new user has an INCOMPLETE profile — the client must then send them
  // through /api/auth/complete-profile before they can use the app.
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email || "");
      const password = String(req.body?.password || "");
      const confirmPassword = String(req.body?.confirmPassword || "");

      if (!email) {
        return res.status(400).json({ error: "Please enter a valid email address." });
      }
      if (!password || !confirmPassword) {
        return res.status(400).json({ error: "Password and confirmation are required." });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match." });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
      }

      let user;
      try {
        const passwordHash = hashPassword(password);
        user = await createUserByEmail(email, passwordHash);
      } catch (err: any) {
        if (err instanceof EmailTakenError) {
          return res.status(409).json({ error: err.message });
        }
        console.error("signup DB error:", err?.message || err);
        return res.status(503).json({ error: "We couldn't finish creating your account. Please try again shortly." });
      }

      const token = signToken({ phone: user.phone, uid: user.id });
      res.json({ success: true, token, user: toPublicUser(user) });
    } catch (err: any) {
      console.error("signup error:", err?.message || err);
      res.status(500).json({ error: "Sign up failed. Please try again." });
    }
  });

  // Step 2: required profile setup. Saved to the DB for EVERY new user.
  // Grants the 50 free credits the first time the profile is completed.
  app.post("/api/auth/complete-profile", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const fullName = String(req.body?.fullName || "").trim();
      const birthdate = String(req.body?.birthdate || "");
      const city = String(req.body?.city || "").trim();

      if (!fullName || !birthdate || !city) {
        return res.status(400).json({ error: "All profile fields are required." });
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
      const email = normalizeEmail(req.body?.email || "");
      const password = String(req.body?.password || "");
      if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

      const user = await findUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password." });
      }
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
      const { claimDailyStreak } = require("./db");
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
      const { claimAchievement } = require("./db");
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

  // --- Avatars Endpoints ---
  app.get("/api/avatars", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const avatars = await getAvatars(req.user!.phone);
      res.json({ avatars });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch avatars." });
    }
  });

  // Get generation status for a specific avatar
  app.get("/api/avatars/:id/status", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const avatar = await getAvatarById(Number(req.params.id), req.user!.phone);
      if (!avatar) return res.status(404).json({ error: "Avatar not found." });
      res.json({
        status: avatar.generation_status,
        error: avatar.generation_error,
        model_url: avatar.model_url,
        sprite_sheet_url: avatar.sprite_sheet_url,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get avatar status." });
    }
  });

  // Create a new 3D avatar from a pet photo
  app.post("/api/avatars", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { name, photo } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required." });
      if (!photo) return res.status(400).json({ error: "A pet photo is required for 3D avatar generation." });

      const GENERATION_COST = 40;
      const isAdmin = await isUserAdmin(req.user!.phone);
      if (!isAdmin) {
        const currentBalance = await getCreditBalance(req.user!.phone);
        if (currentBalance < GENERATION_COST) {
          return res.status(402).json({ error: `Insufficient credits. You need ${GENERATION_COST} credits to generate an avatar.` });
        }
      }

      // Use the uploaded photo as the avatar thumbnail
      let thumbnailUrl = photo;
      try {
        thumbnailUrl = await uploadBase64Image(photo);
      } catch (uploadErr) {
        console.warn("Failed to upload avatar thumbnail (using inline):", uploadErr);
      }

      // Create avatar record with 'pending' status
      const avatarId = await createAvatar(req.user!.phone, name, thumbnailUrl, {
        generation_status: 'pending',
      });

      // Deduct credits upfront
      if (!isAdmin) {
        await deductCredits(req.user!.phone, GENERATION_COST);
      }

      // Return immediately with HTTP 202 — generation happens async
      res.status(202).json({ success: true, avatarId, status: 'pending' });

      // ================================================================
      // Async 3D Generation Pipeline (runs in background)
      // ================================================================
      const userPhone = req.user!.phone;
      (async () => {
        try {
          console.log(`[3D Avatar #${avatarId}] Starting async generation pipeline...`);

          // --- Step 1: Analyze pet image with Ollama ---
          await updateAvatarGenerationStatus(avatarId, 'generating_mesh');
          console.log(`[3D Avatar #${avatarId}] Step 1: Analyzing pet image with Ollama...`);
          let analysis: PetAnalysis;
          try {
            analysis = await analyzePetImage(photo);
          } catch (ollamaErr: any) {
            console.warn(`[3D Avatar #${avatarId}] Ollama analysis failed, using defaults:`, ollamaErr.message);
            analysis = {
              species: 'dog', breed: 'Mixed Breed', bodyType: 'quadruped',
              estimatedPose: 'standing', legCount: 4, hasTail: true, hasWings: false,
              bodyProportions: { headSize: 'medium', legLength: 'medium', bodyLength: 'medium', neckLength: 'medium' }
            };
          }

          // Update avatar with detected animal info
          try {
            await getPool().query(
              `UPDATE avatars SET animal_type = ?, breed = ? WHERE id = ?`,
              [analysis.species, analysis.breed, avatarId]
            );
          } catch (e) { /* non-fatal */ }

          // --- Step 2: Generate 3D mesh via HuggingFace ---
          console.log(`[3D Avatar #${avatarId}] Step 2: Generating 3D mesh via HuggingFace...`);
          let glbBuffer: Buffer;
          try {
            glbBuffer = await generateMeshFromImage(photo);
          } catch (hfErr: any) {
            console.error(`[3D Avatar #${avatarId}] HuggingFace mesh generation failed:`, hfErr.message);
            await updateAvatarGenerationStatus(avatarId, 'failed', `Mesh generation failed: ${hfErr.message}`);
            return;
          }

          // --- Step 3: Generate rigging script with Ollama ---
          await updateAvatarGenerationStatus(avatarId, 'rigging');
          console.log(`[3D Avatar #${avatarId}] Step 3: Generating rigging script with Ollama...`);
          let riggingScript: string;
          try {
            riggingScript = await generateRiggingScript(analysis);
          } catch (rigErr: any) {
            console.error(`[3D Avatar #${avatarId}] Rigging script generation failed:`, rigErr.message);
            await updateAvatarGenerationStatus(avatarId, 'failed', `Rigging script generation failed: ${rigErr.message}`);
            return;
          }

          // Worker base URL for Blender calls
          const workerBaseUrl = (process.env.BLENDER_WORKER_URL || 'http://localhost:10000/render').replace('/render', '');

          // --- Helper: submit job to worker and poll for result ---
          const pollWorkerJob = async (endpoint: string, payload: any, label: string, maxWaitMs = 300000): Promise<any> => {
            // Submit job
            const submitRes = await fetch(`${workerBaseUrl}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!submitRes.ok) {
              const errData = await submitRes.json().catch(() => ({}));
              throw new Error(errData.error || `Worker returned ${submitRes.status}`);
            }
            const submitData = await submitRes.json() as { jobId?: string; success?: boolean; [key: string]: any };

            // If the worker returned a jobId (async mode), poll for completion
            if (submitData.jobId) {
              const jobId = submitData.jobId;
              console.log(`[3D Avatar #${avatarId}] ${label}: Got jobId=${jobId}, polling...`);
              const pollInterval = 5000; // 5 seconds
              const deadline = Date.now() + maxWaitMs;

              while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, pollInterval));
                const pollRes = await fetch(`${workerBaseUrl}/jobs/${jobId}`);
                if (!pollRes.ok) {
                  throw new Error(`Polling failed with status ${pollRes.status}`);
                }
                const pollData = await pollRes.json() as { status: string; result?: any; error?: string };

                if (pollData.status === 'complete') {
                  console.log(`[3D Avatar #${avatarId}] ${label}: Job complete!`);
                  return pollData.result;
                } else if (pollData.status === 'failed') {
                  throw new Error(pollData.error || `${label} job failed`);
                }
                // still processing, continue polling
                console.log(`[3D Avatar #${avatarId}] ${label}: Still processing...`);
              }
              throw new Error(`${label} timed out after ${maxWaitMs / 1000}s`);
            }

            // Synchronous response (backwards compatibility)
            return submitData;
          };

          // --- Step 4: Send to Blender worker for rigging ---
          console.log(`[3D Avatar #${avatarId}] Step 4: Sending to Blender worker for rigging...`);
          let riggedGlbBase64: string;
          try {
            const rigData = await pollWorkerJob('/rig-model', {
              glb_base64: glbBuffer.toString('base64'),
              rigging_script: riggingScript,
            }, 'Rigging');
            if (!rigData.success || !rigData.rigged_glb_base64) {
              throw new Error('Worker returned invalid rigging result');
            }
            riggedGlbBase64 = rigData.rigged_glb_base64;
          } catch (workerErr: any) {
            console.error(`[3D Avatar #${avatarId}] Blender rigging failed:`, workerErr.message);
            await updateAvatarGenerationStatus(avatarId, 'failed', `Rigging failed: ${workerErr.message}`);
            return;
          }

          // --- Step 5: Generate sprite animation script with Ollama ---
          await updateAvatarGenerationStatus(avatarId, 'baking_sprites');
          console.log(`[3D Avatar #${avatarId}] Step 5: Generating sprite animation script...`);
          let spriteScript: string;
          try {
            spriteScript = await generateSpriteAnimationScript(analysis);
          } catch (spriteErr: any) {
            console.error(`[3D Avatar #${avatarId}] Sprite script generation failed:`, spriteErr.message);
            await updateAvatarGenerationStatus(avatarId, 'failed', `Animation script failed: ${spriteErr.message}`);
            return;
          }

          // --- Step 6: Send to Blender worker for sprite baking ---
          console.log(`[3D Avatar #${avatarId}] Step 6: Baking sprite sheet...`);
          let spriteSheetBase64: string;
          let animationMetadata: any;
          try {
            const spriteData = await pollWorkerJob('/bake-sprites', {
              rigged_glb_base64: riggedGlbBase64,
              animation_script: spriteScript,
            }, 'Sprite baking');
            if (!spriteData.success) {
              throw new Error('Worker returned invalid sprite result');
            }
            spriteSheetBase64 = spriteData.sprite_sheet_base64;
            animationMetadata = spriteData.animation_metadata;
          } catch (bakeErr: any) {
            console.error(`[3D Avatar #${avatarId}] Sprite baking failed:`, bakeErr.message);
            await updateAvatarGenerationStatus(avatarId, 'failed', `Sprite baking failed: ${bakeErr.message}`);
            return;
          }

          // --- Step 7: Upload assets to storage ---
          console.log(`[3D Avatar #${avatarId}] Step 7: Uploading assets to storage...`);
          let modelUrl = `data:model/gltf-binary;base64,${riggedGlbBase64}`;
          let spriteSheetUrl = spriteSheetBase64;
          try {
            modelUrl = await uploadBase64Image(`data:model/gltf-binary;base64,${riggedGlbBase64}`);
          } catch (e) {
            console.warn(`[3D Avatar #${avatarId}] Model upload failed, keeping inline`);
          }
          try {
            spriteSheetUrl = await uploadBase64Image(spriteSheetBase64);
          } catch (e) {
            console.warn(`[3D Avatar #${avatarId}] Sprite sheet upload failed, keeping inline`);
          }

          // --- Step 8: Update avatar record ---
          await updateAvatarModel(avatarId, userPhone, modelUrl, spriteSheetUrl, animationMetadata);
          console.log(`[3D Avatar #${avatarId}] ✅ 3D avatar generation complete!`);

        } catch (pipelineErr: any) {
          console.error(`[3D Avatar #${avatarId}] Pipeline error:`, pipelineErr);
          try {
            await updateAvatarGenerationStatus(avatarId, 'failed', pipelineErr.message || 'Unknown pipeline error');
          } catch (dbErr) {
            console.error(`[3D Avatar #${avatarId}] Failed to update avatar status after pipeline error:`, dbErr);
          }
        }
      })().catch((fatalErr) => {
        // Safety net: catch any unhandled rejection from the background IIFE
        // to prevent crashing the entire server process (which causes 502).
        console.error(`[3D Avatar #${avatarId}] FATAL unhandled error in background pipeline:`, fatalErr);
      });
    } catch (err: any) {
      console.error("Failed to create avatar:", err);
      res.status(500).json({ error: "Failed to create avatar." });
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
      if (success) {
        const user = await findUserByPhone(req.user!.phone);
        res.json({ success: true, user: user ? toPublicUser(user) : null });
      } else {
        res.status(400).json({ error: "Not enough treats available." });
      }
    } catch (err: any) {
      res.status(500).json({ error: "Failed to give treat." });
    }
  });


  // Initialize Twilio client for SMS notifications
  let twilioClient: ReturnType<typeof twilio> | null = null;
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  ) {
    try {
      twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      (global as any).__twilioClient = twilioClient;
      console.log('✅ Twilio SMS client initialized.');
    } catch (err) {
      console.warn('⚠️ Twilio client failed to initialize (non-fatal):', err);
    }
  } else {
    console.warn('⚠️ TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER not set. SMS notifications disabled.');
  }

  // Helper: send SMS notification (fire-and-forget, non-fatal)
  async function sendSms(to: string, body: string): Promise<void> {
    if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) return;
    try {
      await twilioClient.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER!, to });
    } catch (err) {
      console.warn('SMS send failed (non-fatal):', err);
    }
  }

  // Flat-rate pricing for photo/video requests (USD)
  const REQUEST_PRICES: Record<string, number> = {
    photo_standard: 2.99,
    photo_premium:  4.99,
    video_standard: 7.99,
    video_premium:  12.99,
  };

  const REQUEST_LABELS: Record<string, string> = {
    photo_standard: 'Standard Photo',
    photo_premium:  'Premium Photo',
    video_standard: 'Standard Video',
    video_premium:  'Premium Video',
  };

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
      // Admin-only: direct AI generation is restricted to admin accounts.
      // Regular users submit requests via POST /api/photo-requests instead.
      const authedReq = req as AuthedRequest;
      const userPhone = authedReq.user!.phone;
      const isAdmin = await isUserAdmin(userPhone);
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          error: "Direct AI generation is admin-only. Please submit a request through the Request a Memory form."
        });
      }

      if (!apiKey || apiKey === "placeholder-key" || apiKey === "MY_GEMINI_API_KEY") {
        throw new Error("Missing or invalid GEMINI_API_KEY. Please configure your Gemini API key in the AI Studio Secrets panel.");
      }

      const GENERATION_COST = 40;

      const { style, background, photo, breed, name, brightness, contrast, location } = req.body;
      
      let promptText = "";
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

      if (BACKGROUND_PROMPTS[background]) {
        promptText += BACKGROUND_PROMPTS[background];
      } else if (background === "Canyon") {
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

      if (brightness > 70) {
        promptText += ` Use very bright, high-key lighting.`;
      } else if (brightness < 30) {
        promptText += ` Use moody, low-key dramatic lighting.`;
      }
      if (contrast > 70) {
        promptText += ` High contrast, punchy vibrant colors.`;
      } else if (contrast < 30) {
        promptText += ` Soft, low-contrast, gentle pastel tones.`;
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
          // Style-transfer the input photo using the image generation model
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
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
              pet_name: name || null,
              pet_breed: breed || null,
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
          pet_name: name || null,
          pet_breed: breed || null,
        });
        
        return res.json({ success: true, imageUrl: finalImageUrl, creationId, mode: "generate" });
      } catch (e: any) {
        console.error("Imagen model error, trying gemini-2.5-flash-image fallback:", e);
        
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
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
            pet_name: name || null,
            pet_breed: breed || null,
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
      if (album_id !== undefined) {
        if (album_id !== null) {
          const [albumRows] = await getPool().query(
            "SELECT id FROM albums WHERE id = ? AND user_phone = ? LIMIT 1",
            [album_id, req.user!.phone]
          ) as any;
          if (!albumRows.length) {
            return res.status(403).json({ success: false, error: "Album not found or not yours." });
          }
        }
        updates.album_id = album_id;
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

      // Whitelist: only allow fetching from our configured media bucket host
      const bucketEndpoint = process.env.MEDIA_BUCKET_URL;
      const bucketName = process.env.MEDIA_BUCKET_NAME;
      if (!bucketEndpoint || !bucketName) return res.status(503).send("Media storage not configured");
      const allowedHost = `${bucketName}.${new URL(bucketEndpoint).host}`;
      let parsedUrl: URL;
      try { parsedUrl = new URL(url); } catch { return res.status(400).send("Invalid URL"); }
      if (parsedUrl.hostname !== allowedHost) return res.status(403).send("Download not permitted for this URL");

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

  function getEnhancedMotionPrompt(basePrompt: string, creation: any, userPets: any[] = []): string {
    let enhanced = basePrompt;
    const preset = (creation.preset_name || "").toLowerCase();
    const label = (creation.place_label || "").toLowerCase();

    // 1. Resolve pet species (dog, cat, or other)
    let petKind = "dog"; // Default fallback
    const petBreed = (creation.pet_breed || "").toLowerCase();
    const petName = (creation.pet_name || "").toLowerCase();

    const dogKeywords = ["dog", "canine", "puppy", "golden", "retriever", "labrador", "poodle", "pug", "shepherd", "terrier", "husky", "corgi", "spaniel", "beagle", "chihuahua", "bulldog", "boxer", "dachshund", "shih tzu", "maltese", "rottweiler"];
    const catKeywords = ["cat", "feline", "kitten", "siamese", "persian", "maine coon", "tabby", "shorthair", "sphynx", "ragdoll", "bengal", "calico"];

    if (catKeywords.some(keyword => petBreed.includes(keyword) || petName.includes(keyword))) {
      petKind = "cat";
    } else if (dogKeywords.some(keyword => petBreed.includes(keyword) || petName.includes(keyword))) {
      petKind = "dog";
    } else if (petBreed || petName) {
      // Look up in the user's pet list if available
      const matchedPet = userPets.find(
        (p: any) => p.name.toLowerCase() === petName || p.kind.toLowerCase() === petBreed
      );
      if (matchedPet) {
        petKind = matchedPet.kind; // 'dog' | 'cat' | 'other'
      }
    } else if (userPets && userPets.length > 0) {
      // Fallback to first pet's kind if user has pets
      petKind = userPets[0].kind;
    }

    // 2. Identify the setting category
    const isUnderwater = preset === "underwater" || label.includes("underwater") || label.includes("ocean") || label.includes("reef") || label.includes("sea") || label.includes("coral") || label.includes("aquarium");
    const isSpace = preset === "space" || label.includes("space") || label.includes("orbit") || label.includes("galaxy") || label.includes("moon") || label.includes("stars");
    const isPark = preset === "dogpark" || preset === "meadow" || preset === "springgarden" || preset === "playground" || preset === "lavender" || preset === "cherryblossom" || label.includes("park") || label.includes("meadow") || label.includes("garden") || label.includes("lawn") || label.includes("field") || label.includes("playground") || label.includes("lavender") || label.includes("blossom");
    const isLandmark = preset === "canyon" || preset === "paris" || preset === "london" || preset === "newyork" || preset === "rome" || preset === "tokyo" || preset === "egypt" || preset === "goldengate" || preset === "rocky" || preset === "tajmahal" || label.includes("canyon") || label.includes("tower") || label.includes("bridge") || label.includes("statue") || label.includes("museum") || label.includes("monument") || label.includes("pyramid") || label.includes("ruins") || label.includes("castle") || label.includes("city") || label.includes("skyline");
    const isCozy = preset === "cabin" || preset === "bookshop" || preset === "library" || label.includes("cabin") || label.includes("bookshop") || label.includes("library") || label.includes("indoor") || label.includes("cozy") || label.includes("room") || label.includes("house") || label.includes("bedroom") || label.includes("living room");
    const isFestive = preset === "christmas" || preset === "birthday" || preset === "carnival" || label.includes("christmas") || label.includes("birthday") || label.includes("party") || label.includes("festive") || label.includes("holiday") || label.includes("carnival") || label.includes("circus");
    const isHeroic = preset === "superhero" || preset === "castle" || preset === "enchanted" || preset === "rainbow" || label.includes("hero") || label.includes("cape") || label.includes("magic") || label.includes("enchanted") || label.includes("rainbow") || label.includes("fairytale");
    const isHighEnergy = preset === "skatepark" || preset === "trampolinepark" || preset === "concertstage" || preset === "stadium" || label.includes("skate") || label.includes("trampoline") || label.includes("concert") || label.includes("stage") || label.includes("stadium") || label.includes("arena") || label.includes("sports") || label.includes("play");
    const isPampered = preset === "grooming" || preset === "vetclinic" || preset === "petstore" || preset === "dogdaycare" || label.includes("groom") || label.includes("spa") || label.includes("clinic") || label.includes("vet") || label.includes("pamper") || label.includes("store") || label.includes("daycare");
    const isBeach = preset === "beach" || label.includes("beach") || label.includes("sand") || label.includes("shore") || label.includes("coast");
    const isSnow = preset === "mountains" || preset === "cabin" || label.includes("snow") || label.includes("winter") || label.includes("glacier") || label.includes("ice") || label.includes("frost");

    // 3. Construct the motion prompt with species-specific behaviors
    if (isUnderwater) {
      if (petKind === "dog") {
        enhanced = `The dog is wearing a round glass diving helmet on its head. ${basePrompt} It is doggie paddling and floating weightlessly through the water, blinking curiously, looking around with wonder as tiny bubbles drift by.`;
      } else if (petKind === "cat") {
        enhanced = `The cat is wearing a round glass diving helmet on its head. ${basePrompt} It is swimming gracefully and floating weightlessly through the water, blinking curiously, looking around with wonder as tiny bubbles drift by.`;
      } else {
        enhanced = `The animal is wearing a round glass diving helmet on its head. ${basePrompt} It is paddling and floating weightlessly through the water, looking around curiously as tiny bubbles drift by.`;
      }
    } else if (isSpace) {
      if (petKind === "dog") {
        enhanced = `The dog is wearing a shiny glass astronaut helmet. ${basePrompt} It is weightless, floating and slowly paddling its paws in the zero-gravity environment of space, looking amazed with its ears floating slightly.`;
      } else if (petKind === "cat") {
        enhanced = `The cat is wearing a shiny glass astronaut helmet. ${basePrompt} It is weightless, floating and waving its paws gracefully in the zero-gravity environment of space, looking curious with its whiskers twitching.`;
      } else {
        enhanced = `The animal is wearing a shiny glass astronaut helmet. ${basePrompt} It is weightless, floating and slowly paddling its paws in the zero-gravity environment of space.`;
      }
    } else if (isPark) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog is panting happily with its tongue slightly out, tail wagging excitedly, looking joyful, energetic, and fully alive in the sunny park setting.`;
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat is looking around curiously with its tail twitching happily, looking alert, energetic, and fully alive in the sunny park setting.`;
      } else {
        enhanced = `${basePrompt} The animal is looking around happily and looking energetic, joyful, and fully alive in the sunny park setting.`;
      }
    } else if (isLandmark) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog looks proud and triumphant, sitting or standing tall, head held high, ears perked up, looking majestically into the distance with a happy expression.`;
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat looks proud and regal, sitting majestically, head held high, looking confidently into the distance with a calm and noble expression.`;
      } else {
        enhanced = `${basePrompt} The animal looks proud and majestic, sitting or standing tall, head held high, looking confidently into the distance.`;
      }
    } else if (isCozy) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog is calm, relaxed, and content, blinking sleepily and gently wagging its tail on the warm floor.`;
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat is calm, relaxed, and content, blinking sleepily, curling up or purring gently on the warm floor.`;
      } else {
        enhanced = `${basePrompt} The animal is calm, relaxed, and content, blinking sleepily on the warm floor.`;
      }
    } else if (isFestive) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog is wagging its tail enthusiastically with a festive, playful, and cheerful expression, looking around with bright, happy eyes.`
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat is playing playfully with a festive, cheerful expression, batting at decorations, looking around with bright, happy eyes.`;
      } else {
        enhanced = `${basePrompt} The animal is playing happily with a festive, cheerful expression, looking around with bright, happy eyes.`;
      }
    } else if (isHeroic) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog is posing heroically with its chest puffed out, ears and cape blowing dramatically in the wind, looking brave, determined, and magical.`;
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat is posing heroically with its head held high, fur and cape blowing dramatically in the wind, looking brave, regal, and magical.`;
      } else {
        enhanced = `${basePrompt} The animal is posing heroically, fur blowing dramatically in the wind, looking brave, determined, and magical.`;
      }
    } else if (isHighEnergy) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog looks thrilled and high-energy, tongue out, ears flapping happily as if mid-run or mid-bounce, basking under the spotlights.`;
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat looks energized and playful, eyes wide, pouncing and leaping with high energy, basking under the spotlights.`;
      } else {
        enhanced = `${basePrompt} The animal looks thrilled and high-energy, bounding or leaping with excitement, basking under the spotlights.`;
      }
    } else if (isPampered) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog looks extremely relaxed and pampered, closing its eyes blissfully under a warm, gentle blow-dry breeze.`;
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat looks extremely relaxed and clean, closing its eyes blissfully, purring under a gentle warm breeze.`;
      } else {
        enhanced = `${basePrompt} The animal looks extremely relaxed and content under a gentle warm breeze.`;
      }
    } else if (isBeach) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog is playing on the sandy beach, shaking water off its fur, and splashing in the gentle turquoise waves.`;
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat is walking carefully on the warm sandy beach, watching the gentle turquoise waves with curiosity.`;
      } else {
        enhanced = `${basePrompt} The animal is playing on the sandy beach, enjoying the sea breeze and splashing in the gentle waves.`;
      }
    } else if (isSnow) {
      if (petKind === "dog") {
        enhanced = `${basePrompt} The dog's breath is visible as a soft white mist in the crisp cold air, happily bounding and digging in the fluffy white snow.`;
      } else if (petKind === "cat") {
        enhanced = `${basePrompt} The cat's breath is visible as a soft white mist in the crisp cold air, stepping carefully and sniffing the fluffy white snow.`;
      } else {
        enhanced = `${basePrompt} The animal's breath is visible as a soft white mist in the crisp cold air, stepping and playing in the fluffy white snow.`;
      }
    }

    return enhanced;
  }

  app.post("/api/create-video", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { creationId, motionPrompt, aspectRatio } = req.body;
      if (!creationId) return res.status(400).json({ success: false, error: "creationId is required" });

      const userPhone = req.user!.phone;
      const isAdmin = await isUserAdmin(userPhone);

      // Admin-only: direct video generation is restricted to admin accounts.
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          error: "Direct video generation is admin-only. Please submit a request through the Request a Memory form."
        });
      }

      // 2. Fetch creation to get the image
      const creations = await getCreations(userPhone);
      const creation = creations.find((c: any) => c.id === creationId);
      if (!creation || !creation.image_url) {
        return res.status(404).json({ success: false, error: "Creation not found or has no image." });
      }

      // 3. Prepare image bytes (fetch from URL if needed, or parse base64)
      let imageBytes = "";
      let mimeType = "image/jpeg";
      if (creation.image_url.startsWith("data:image")) {
        const commaIdx = creation.image_url.indexOf(",");
        if (commaIdx !== -1) {
          const meta = creation.image_url.substring(0, commaIdx);
          imageBytes = creation.image_url.substring(commaIdx + 1).replace(/[\r\n\s]+/g, "");
          const mimeMatch = meta.match(/data:([^;]+);base64/);
          if (mimeMatch) {
            mimeType = mimeMatch[1];
          }
        }
      } else {
        // Fetch from object storage URL
        const imgRes = await fetch(creation.image_url);
        if (!imgRes.ok) throw new Error(`Failed to fetch image from storage: ${imgRes.statusText}`);
        mimeType = imgRes.headers.get("content-type") || "image/jpeg";
        const buffer = await imgRes.arrayBuffer();
        imageBytes = Buffer.from(buffer).toString("base64");
      }

      const userPets = await getPets(userPhone);
      const finalPrompt = getEnhancedMotionPrompt(
        motionPrompt || "Gentle breeze, subtle motion, cinematic lighting",
        creation,
        userPets
      );
      console.log(`Enhanced Veo video motion prompt: "${finalPrompt}"`);

      // 5. Start Veo operation with a resilient model fallback chain
      let op: any;
      const veoModels = ["veo-3.1-fast-generate-preview", "veo-3.1-generate-preview", "veo-2.0-generate-001"];
      let lastVeoError: any = null;

      for (const modelName of veoModels) {
        try {
          console.log(`Attempting video generation with model: ${modelName}`);
          op = await ai.models.generateVideos({
            model: modelName,
            prompt: finalPrompt,
            image: { imageBytes, mimeType },
            config: { aspectRatio: (aspectRatio === "9:16" ? "9:16" : "16:9") }, // Veo supports "16:9" or "9:16"
          });
          console.log(`Successfully queued Veo video generation with model: ${modelName}`);
          lastVeoError = null;
          break; // Success! Exit loop
        } catch (err: any) {
          console.warn(`Model ${modelName} failed to start:`, err.message || err);
          lastVeoError = err;
        }
      }

      if (lastVeoError) {
        throw new Error(`All video generation models failed to start. Last error: ${lastVeoError.message || lastVeoError}`);
      }

      // Log full op shape so we can see what the SDK actually returns
      console.log("Veo generateVideos raw response:", JSON.stringify(op, null, 2));
      const operationName =
        op.name ||
        op.operation?.name ||
        op.metadata?.name ||
        op.operationName;
      if (!operationName) throw new Error(`Failed to get operation name from Veo. Raw op: ${JSON.stringify(op)}`);

      // Deduct credits now that Veo confirmed the job is queued (Admin bypass)
      if (!isAdmin) {
        await deductCredits(userPhone, VIDEO_COST);
      }

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

  app.get("/api/jobs/:id", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const jobId = parseInt(req.params.id, 10);
      const job = await getJob(jobId, req.user!.phone);
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      // If running, poll the operation
      if (job.status === "running" || job.status === "queued") {
        if (job.operation_name) {
          try {
            // Poll via REST — SDK operations.get() requires a full Operation class instance,
            // but we only store the name string in the DB, so we use the raw API directly.
            const pollRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/${job.operation_name}`,
              { headers: { 'x-goog-api-key': apiKey || '' } }
            );
            if (!pollRes.ok) throw new Error(`Operation poll failed: ${pollRes.status} ${pollRes.statusText}`);
            const op: any = await pollRes.json();
            // Always log the full response so we can diagnose issues
            console.log("Veo poll response (done=%s):", op.done, JSON.stringify(op, null, 2));
            if (op.done) {
              // Check for API-level error first (e.g. safety filter, quota, etc.)
              if (op.error) {
                const errMsg = op.error.message || JSON.stringify(op.error);
                console.error("Veo operation finished with API error:", op.error);
                await updateJobStatus(jobId, "failed", errMsg);
                if (!await isUserAdmin(req.user!.phone) && job.credits_reserved > 0) {
                  await refundCredits(req.user!.phone, job.credits_reserved);
                }
                return res.json({ success: true, status: "failed", error: `Veo API error: ${errMsg}` });
              }

              // Actual REST response shape:
              // op.response.generateVideoResponse.generatedSamples[0].video.uri
              const videoData: any =
                op.response?.generateVideoResponse?.generatedSamples?.[0]?.video ||
                op.response?.generatedVideos?.[0]?.video; // fallback for SDK shape

              if (videoData) {
                let videoUrl: string;
                if (videoData.uri) {
                  // Google Files API URI — needs API key to download
                  const dlUrl = videoData.uri.includes('?')
                    ? `${videoData.uri}&key=${apiKey}`
                    : `${videoData.uri}?key=${apiKey}`;
                  const gcsRes = await fetch(dlUrl);
                  if (!gcsRes.ok) throw new Error(`Failed to download video from Veo: ${gcsRes.status} ${gcsRes.statusText}`);
                  const buf = Buffer.from(await gcsRes.arrayBuffer());
                  videoUrl = await uploadBase64Image(`data:video/mp4;base64,${buf.toString("base64")}`);
                } else if (videoData.videoBytes || videoData.imageBytes) {
                  const bytes = videoData.videoBytes || videoData.imageBytes;
                  videoUrl = await uploadBase64Image(`data:video/mp4;base64,${bytes}`);
                } else {
                  throw new Error(`Veo returned video object but no URI or bytes. videoData: ${JSON.stringify(videoData)}`);
                }

                // Update DB
                await updateJobStatus(jobId, "done");
                await setCreationVideoUrl(job.creation_id!, req.user!.phone, videoUrl);
                return res.json({ success: true, status: "done", video_url: videoUrl });
              } else {
                const detail = JSON.stringify(op.response || op);
                console.error("Veo done=true but no video found. Full response:", detail);
                await updateJobStatus(jobId, "failed", `No video in response: ${detail}`);
                if (!await isUserAdmin(req.user!.phone) && job.credits_reserved > 0) {
                  await refundCredits(req.user!.phone, job.credits_reserved);
                }
                return res.json({ success: true, status: "failed", error: `No video generated. Veo response: ${detail}` });
              }
            } else {
              // Still running
              await updateJobStatus(jobId, "running");
            }
          } catch (pollErr: any) {
            console.error("Video poll error:", pollErr);
            await updateJobStatus(jobId, "failed", pollErr.message);
            if (!await isUserAdmin(req.user!.phone) && job.credits_reserved > 0) {
              await refundCredits(req.user!.phone, job.credits_reserved);
            }
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
        try {
          // Poll via REST — same reason as above
          const pollRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${job.operation_name}`,
            { headers: { 'x-goog-api-key': apiKey || '' } }
          );
          if (!pollRes.ok) throw new Error(`Operation poll failed: ${pollRes.status} ${pollRes.statusText}`);
          const op: any = await pollRes.json();
          if (op.done) {
            const videoData: any =
              op.response?.generateVideoResponse?.generatedSamples?.[0]?.video ||
              op.response?.generatedVideos?.[0]?.video;

            if (videoData) {
              let videoUrl: string;
              if (videoData.uri) {
                const dlUrl = videoData.uri.includes('?')
                  ? `${videoData.uri}&key=${apiKey}`
                  : `${videoData.uri}?key=${apiKey}`;
                const gcsRes = await fetch(dlUrl);
                if (!gcsRes.ok) throw new Error(`Failed to download video: ${gcsRes.status}`);
                const buf = Buffer.from(await gcsRes.arrayBuffer());
                videoUrl = await uploadBase64Image(`data:video/mp4;base64,${buf.toString("base64")}`);
              } else if (videoData.videoBytes || videoData.imageBytes) {
                const bytes = videoData.videoBytes || videoData.imageBytes;
                videoUrl = await uploadBase64Image(`data:video/mp4;base64,${bytes}`);
              } else {
                throw new Error(`Veo returned video object but no URI or bytes: ${JSON.stringify(videoData)}`);
              }

              await updateJobStatus(job.id, "done");
              if (job.creation_id) {
                await setCreationVideoUrl(job.creation_id, job.user_phone, videoUrl);
              }
            } else {
              const detail = JSON.stringify(op.response || op);
              console.error(`Background poller: Veo done=true but no video for job ${job.id}:`, detail);
              await updateJobStatus(job.id, "failed", `No video in response: ${detail}`);
              if (!await isUserAdmin(job.user_phone) && job.credits_reserved > 0) {
                await refundCredits(job.user_phone, job.credits_reserved);
              }
            }
          }
        } catch (err) {
          console.error(`Background poller error for job ${job.id}:`, err);
          await updateJobStatus(job.id, "failed", "Poller error");
          if (!await isUserAdmin(job.user_phone) && job.credits_reserved > 0) {
            await refundCredits(job.user_phone, job.credits_reserved);
          }
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

  // --- Photo Requests Endpoints ---

  // POST /api/photo-requests — user submits a memory request with upfront Stripe payment
  app.post("/api/photo-requests", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { request_type, comment, photo } = req.body;

      if (!request_type || !REQUEST_PRICES[request_type]) {
        return res.status(400).json({ success: false, error: "Invalid request_type. Must be photo_standard, photo_premium, video_standard, or video_premium." });
      }
      if (!comment || comment.trim().length < 10) {
        return res.status(400).json({ success: false, error: "Please describe what you'd like (at least 10 characters)." });
      }

      const userPhone = req.user!.phone;
      const price = REQUEST_PRICES[request_type];
      const label = REQUEST_LABELS[request_type];
      const appUrl = process.env.APP_URL || "http://localhost:3000";

      // Upload photo to object storage if provided
      let photoUrl: string | null = null;
      if (photo && photo.startsWith("data:image")) {
        try {
          photoUrl = await uploadBase64Image(photo);
        } catch (uploadErr) {
          console.warn("Failed to upload request photo to storage (non-fatal):", uploadErr);
          photoUrl = photo; // fall back to base64 in DB
        }
      }

      // Sandbox mode — no Stripe
      if (!stripe) {
        const requestId = await createPhotoRequest({
          user_phone: userPhone,
          request_type: request_type as any,
          comment: comment.trim(),
          photo_url: photoUrl,
          stripe_session_id: null,
          amount_paid: price,
        });
        // Auto-mark as paid in sandbox
        await (async () => {
          const { getPool: gp } = await import("./db");
          await gp().query(`UPDATE photo_requests SET paid = 1 WHERE id = ?`, [requestId]);
        })();
        const simulatedUrl = `${appUrl}/?request_success=true&request_id=${requestId}`;
        return res.json({ success: true, requestId, checkoutUrl: simulatedUrl, mode: "sandbox" });
      }

      // Create Stripe Checkout session first (session id needed for DB row)
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Paws & Memories — ${label}`,
              description: `Custom AI pet ${request_type.startsWith('video') ? 'video' : 'photo'} created personally for you`,
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        metadata: {
          type: "photo_request_payment",
          userPhone,
          request_label: label,
        },
        success_url: `${appUrl}/?request_success=true`,
        cancel_url: `${appUrl}/?request_cancelled=true`,
      });

      // Create request row now with the session id
      const requestId = await createPhotoRequest({
        user_phone: userPhone,
        request_type: request_type as any,
        comment: comment.trim(),
        photo_url: photoUrl,
        stripe_session_id: session.id,
        amount_paid: price,
      });

      // Update session metadata with the new requestId
      await stripe.checkout.sessions.update(session.id, {
        metadata: {
          type: "photo_request_payment",
          userPhone,
          request_label: label,
          requestId: String(requestId),
        }
      });

      return res.json({ success: true, requestId, checkoutUrl: session.url, mode: "live_stripe" });
    } catch (err: any) {
      console.error("Error creating photo request:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to submit request." });
    }
  });

  // GET /api/photo-requests — user's own requests
  app.get("/api/photo-requests", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const requests = await getPhotoRequests(req.user!.phone);
      res.json({ success: true, requests });
    } catch (err: any) {
      console.error("Error fetching photo requests:", err);
      res.status(500).json({ success: false, error: "Failed to fetch your requests." });
    }
  });

  // GET /api/admin/photo-requests — admin view of all requests
  app.get("/api/admin/photo-requests", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const isAdmin = await isUserAdmin(req.user!.phone);
      if (!isAdmin) return res.status(403).json({ success: false, error: "Admin only." });
      const requests = await getAllPhotoRequests();
      res.json({ success: true, requests });
    } catch (err: any) {
      console.error("Error fetching all photo requests:", err);
      res.status(500).json({ success: false, error: "Failed to fetch requests." });
    }
  });

  // PUT /api/admin/photo-requests/:id/fulfill — admin fulfills a request
  // Body: { creationId } — the ID of the creation generated for this user
  app.put("/api/admin/photo-requests/:id/fulfill", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const isAdmin = await isUserAdmin(req.user!.phone);
      if (!isAdmin) return res.status(403).json({ success: false, error: "Admin only." });

      const requestId = parseInt(req.params.id, 10);
      const { creationId } = req.body;
      if (!creationId) return res.status(400).json({ success: false, error: "creationId is required." });

      const request = await getPhotoRequest(requestId);
      if (!request) return res.status(404).json({ success: false, error: "Request not found." });
      if (request.status !== 'pending') return res.status(400).json({ success: false, error: `Request is already ${request.status}.` });

      // Fetch the creation to get the result URL and reassign to user
      const adminCreations = await getCreations(req.user!.phone);
      const creation = adminCreations.find((c: any) => c.id === creationId);
      if (!creation) return res.status(404).json({ success: false, error: "Creation not found." });

      // Clone the creation to the requesting user's account
      const userCreationId = await saveCreation({
        user_phone: request.user_phone,
        media_type: creation.media_type,
        style: creation.style,
        backdrop_kind: creation.backdrop_kind,
        preset_name: creation.preset_name,
        sv_lat: creation.sv_lat,
        sv_lng: creation.sv_lng,
        sv_heading: creation.sv_heading,
        sv_pitch: creation.sv_pitch,
        sv_fov: creation.sv_fov,
        place_label: creation.place_label,
        image_url: creation.image_url,
        video_url: creation.video_url,
        pet_name: creation.pet_name,
        pet_breed: creation.pet_breed,
      });

      const resultUrl = creation.video_url || creation.image_url || "";
      await fulfillPhotoRequest(requestId, userCreationId, resultUrl);

      // Send SMS notification to user
      const user = await findUserByPhone(request.user_phone);
      if (user) {
        const userName = user.full_name ? user.full_name.split(' ')[0] : 'there';
        const mediaType = creation.video_url ? 'video' : 'photo';
        await sendSms(
          request.user_phone,
          `🐾 Paws & Memories: Great news, ${userName}! Your custom ${mediaType} is ready! Open the app and check your gallery to see your creation. 🌟`
        );
      }

      res.json({ success: true, userCreationId });
    } catch (err: any) {
      console.error("Error fulfilling photo request:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fulfill request." });
    }
  });

  // PUT /api/admin/photo-requests/:id/reject — admin rejects a request and refunds via Stripe
  app.put("/api/admin/photo-requests/:id/reject", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const isAdmin = await isUserAdmin(req.user!.phone);
      if (!isAdmin) return res.status(403).json({ success: false, error: "Admin only." });

      const requestId = parseInt(req.params.id, 10);
      const { adminNotes } = req.body;

      const request = await getPhotoRequest(requestId);
      if (!request) return res.status(404).json({ success: false, error: "Request not found." });
      if (request.status !== 'pending') return res.status(400).json({ success: false, error: `Request is already ${request.status}.` });

      // Issue Stripe refund if there's a session and Stripe is configured
      if (stripe && request.stripe_session_id && request.paid) {
        try {
          const session = await stripe.checkout.sessions.retrieve(request.stripe_session_id);
          if (session.payment_intent) {
            await stripe.refunds.create({ payment_intent: session.payment_intent as string });
            console.log(`✅ Stripe refund issued for request #${requestId}`);
          }
        } catch (refundErr) {
          console.warn(`⚠️ Stripe refund failed for request #${requestId} (non-fatal):`, refundErr);
        }
      }

      await rejectPhotoRequest(requestId, adminNotes || null);

      // Notify user of rejection via SMS
      const user = await findUserByPhone(request.user_phone);
      if (user) {
        const userName = user.full_name ? user.full_name.split(' ')[0] : 'there';
        await sendSms(
          request.user_phone,
          `🐾 Paws & Memories: Hi ${userName}, unfortunately we were unable to fulfill your recent memory request${adminNotes ? ': ' + adminNotes : '. Please reach out if you have questions'}. A full refund has been issued.`
        );
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error rejecting photo request:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to reject request." });
    }
  });

  // Serve static assets or mount Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
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
