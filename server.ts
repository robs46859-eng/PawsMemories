import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import Stripe from "stripe";
import fs from "fs";
import { initDb, findOrCreateUser, findUserByPhone, completeUserProfile, toPublicUser } from "./db";
import {
  authConfigured,
  normalizePhone,
  sendVerificationCode,
  checkVerificationCode,
  signToken,
  requireAuth,
  type AuthedRequest,
} from "./auth";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

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

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`Payment successful for checkout session: ${session.id}`);

      const metadata = session.metadata;
      if (metadata) {
        const order = {
          orderId: `ord_${Date.now()}`,
          creationId: metadata.creationId,
          creationName: metadata.creationName,
          imageUrl: metadata.imageUrl,
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
      }
    }

    res.json({ received: true });
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ---------------------------------------------------------------------------
  // Authentication: phone verification (Twilio Verify) + session tokens (JWT)
  // ---------------------------------------------------------------------------

  // Step 1: send an SMS verification code to the supplied phone number.
  app.post("/api/auth/send-code", async (req, res) => {
    try {
      if (!authConfigured()) {
        return res.status(503).json({ error: "Phone verification is not configured on the server yet." });
      }
      const phone = normalizePhone(req.body?.phone || "");
      if (!phone) {
        return res.status(400).json({ error: "Please enter a valid phone number including your country code (e.g. +1...)." });
      }
      await sendVerificationCode(phone);
      res.json({ success: true });
    } catch (err: any) {
      console.error("send-code error:", err?.message || err);
      res.status(500).json({ error: "Could not send the verification code. Please check the number and try again." });
    }
  });

  // Step 2: verify the code. Creates the user if new, returns a session token.
  app.post("/api/auth/verify-code", async (req, res) => {
    try {
      if (!authConfigured()) {
        return res.status(503).json({ error: "Phone verification is not configured on the server yet." });
      }
      const phone = normalizePhone(req.body?.phone || "");
      const code = String(req.body?.code || "").trim();
      if (!phone || !code) {
        return res.status(400).json({ error: "Phone number and verification code are required." });
      }
      // Step 2a: verify the code with Twilio. A failure here means a bad/expired code.
      let approved = false;
      try {
        approved = await checkVerificationCode(phone, code);
      } catch (err: any) {
        console.error("verify-code Twilio error:", err?.message || err);
        return res.status(502).json({ error: "We couldn't reach the verification service. Please try again in a moment." });
      }
      if (!approved) {
        return res.status(401).json({ error: "That code is incorrect or has expired. Please try again." });
      }

      // Step 2b: the code is valid. Persist the user. A failure here is a SERVER/DB
      // problem, not a bad code — surface it distinctly so it isn't mistaken for one.
      let user;
      try {
        user = await findOrCreateUser(phone);
      } catch (err: any) {
        console.error("verify-code DB error:", err?.message || err);
        return res.status(503).json({ error: "Your code was verified, but we couldn't finish creating your account. Please try again shortly." });
      }

      const token = signToken({ phone: user.phone, uid: user.id });
      res.json({ success: true, token, user: toPublicUser(user) });
    } catch (err: any) {
      console.error("verify-code error:", err?.message || err);
      res.status(500).json({ error: "Verification failed. Please try again." });
    }
  });

  // Step 3: required profile setup (name + email). Grants the 50 free credits.
  app.post("/api/auth/complete-profile", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const fullName = String(req.body?.fullName || "").trim();
      const email = String(req.body?.email || "").trim();
      if (!fullName || !email) {
        return res.status(400).json({ error: "Full name and email are both required." });
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: "Please enter a valid email address." });
      }
      const user = await completeUserProfile(req.user!.phone, fullName, email);
      res.json({ success: true, user: toPublicUser(user) });
    } catch (err: any) {
      console.error("complete-profile error:", err?.message || err);
      res.status(500).json({ error: "Could not save your profile. Please try again." });
    }
  });

  // Session restore: returns the current user for a valid token.
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
  app.post("/api/create-creation", requireAuth, async (req, res) => {
    try {
      if (!apiKey || apiKey === "placeholder-key" || apiKey === "MY_GEMINI_API_KEY") {
        throw new Error("Missing or invalid GEMINI_API_KEY. Please configure your Gemini API key in the AI Studio Secrets panel.");
      }

      const { style, background, photo, breed, name, brightness, contrast } = req.body;
      
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

      // If photo is provided (base64)
      if (photo && photo.startsWith("data:image")) {
        const matches = photo.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (!matches || matches.length < 3) {
          throw new Error("Invalid base64 image format");
        }
        const mimeType = matches[1];
        const base64Data = matches[2];

        try {
          // Call gemini-2.5-flash-image to translate/style-transfer the input photo
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
            return res.json({ success: true, imageUrl: generatedBase64, mode: "transform" });
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
        const base64Bytes = response.generatedImages[0].image.imageBytes;
        return res.json({ success: true, imageUrl: `data:image/jpeg;base64,${base64Bytes}`, mode: "generate" });
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
          return res.json({ success: true, imageUrl: generatedBase64, mode: "fallback-generation" });
        }
        
        throw new Error("Failed to generate styled image with available GenAI models. Please try again.");
      }
    } catch (error: any) {
      console.error("Error creating AI memory:", error);
      res.status(500).json({
        success: false,
        error: error.message || "An error occurred while creating your pet memory."
      });
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
          creationId,
          creationName,
          imageUrl,
          style,
          creditsDeducted: String(creditsDeducted),
          cashPaid: String(cashPaid),
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
        model: "gemini-3.5-flash",
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
