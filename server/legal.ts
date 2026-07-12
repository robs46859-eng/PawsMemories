/**
 * Static legal pages served server-side (Pawsome3D).
 *
 * These render as standalone HTML — independent of the SPA — so they always
 * load for crawlers, carriers (10DLC/toll-free reviewers), and users even if
 * the app bundle fails. Routes are mounted in server.ts BEFORE the SPA
 * catch-all: GET /legal/privacy, /legal/terms, /legal/sms.
 *
 * NOTE: standard boilerplate — have counsel review before relying on it.
 */

const BRAND = "Pawsome3D";
const DOMAIN = "pawsome3d.com";
const SUPPORT_EMAIL = "rob@stelar.host";
const EFFECTIVE = "July 12, 2026";

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${BRAND}</title>
<meta name="robots" content="index,follow">
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         line-height: 1.6; max-width: 780px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; color: #1f2937; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #0b0b0c; } a { color: #93c5fd; } }
  h1 { font-size: 1.9rem; margin-bottom: .25rem; }
  h2 { font-size: 1.25rem; margin-top: 2rem; }
  .eff { color: #6b7280; font-size: .9rem; margin-bottom: 2rem; }
  a { color: #2563eb; }
  nav { margin-bottom: 2rem; font-size: .9rem; }
  nav a { margin-right: 1rem; }
  footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb33; color: #6b7280; font-size: .85rem; }
  ul { padding-left: 1.25rem; }
</style>
</head>
<body>
<nav><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="/legal/sms">SMS Terms</a><a href="/">← ${BRAND}</a></nav>
${body}
<footer>© ${new Date().getFullYear()} ${BRAND} (${DOMAIN}). Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</footer>
</body>
</html>`;
}

export function privacyHtml(): string {
  return layout("Privacy Policy", `
<h1>Privacy Policy</h1>
<p class="eff">Effective ${EFFECTIVE}</p>

<p>${BRAND} ("we", "us") operates ${DOMAIN}, an AI platform for creating 3D pet models, animations, and related digital keepsakes. This policy explains what we collect, why, and your choices.</p>

<h2>Information we collect</h2>
<ul>
  <li><strong>Account data:</strong> email address, mobile phone number, and ZIP code you provide at signup and in your profile.</li>
  <li><strong>Content you upload:</strong> photos and reference material used to generate models, videos, voice, and stationery.</li>
  <li><strong>Generated outputs:</strong> the 3D models, videos, voice clips, and images produced for you.</li>
  <li><strong>Usage and device data:</strong> log data, actions in the app, and basic device/browser information.</li>
  <li><strong>Payment data:</strong> processed by our payment provider (Stripe); we do not store full card numbers.</li>
</ul>

<h2>How we use it</h2>
<ul>
  <li>To provide the service — generate and store your models, videos, and other outputs.</li>
  <li>To send <strong>account and transactional notifications</strong> (for example, an SMS or email letting you know a requested model or video is ready). See our <a href="/legal/sms">SMS Terms</a>.</li>
  <li>To operate credits, referrals, storage, and support.</li>
  <li>To maintain safety, prevent abuse and fraud, and comply with law.</li>
</ul>

<h2>SMS / text messages</h2>
<p>If you provide your mobile number and consent, we send you SMS account notifications. Message frequency varies. Message and data rates may apply. Reply <strong>STOP</strong> to unsubscribe at any time and <strong>HELP</strong> for help. <strong>We do not sell or share your mobile number or SMS consent with third parties or affiliates for their marketing.</strong> Mobile opt-in data is never shared with anyone for promotional purposes. Full details are in our <a href="/legal/sms">SMS Terms</a>.</p>

<h2>Third parties we use</h2>
<p>We share limited data only with vendors that help us run the service: payment processing (Stripe), cloud storage (Backblaze and affiliated storage), AI generation providers (for models, images, and voice), SMS delivery (Telnyx), and mapping (Google) where you use location features. These vendors process data on our behalf under their own terms. We do not sell your personal information.</p>

<h2>Data retention</h2>
<p>We keep your account data and generated content while your account is active. You can request deletion or export of your data at any time (see below).</p>

<h2>Your rights &amp; choices</h2>
<ul>
  <li>Access, correct, export, or delete your data — email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</li>
  <li>Opt out of SMS with STOP; manage email preferences in your profile.</li>
  <li>Close your account at any time.</li>
</ul>

<h2>Children</h2>
<p>${BRAND} is not directed to children under 13, and we do not knowingly collect their data.</p>

<h2>Changes</h2>
<p>We may update this policy; the effective date above will change. Material changes will be notified in-app or by email.</p>

<h2>Contact</h2>
<p>Questions: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
`);
}

export function smsTermsHtml(): string {
  return layout("SMS Terms", `
<h1>SMS Terms &amp; Conditions</h1>
<p class="eff">Effective ${EFFECTIVE}</p>

<h2>Program description</h2>
<p>${BRAND} sends transactional <strong>account notifications</strong> by SMS — for example, alerts that a 3D model, animation, or video you requested has finished processing and is ready to view. This is not a marketing program.</p>

<h2>How you opt in</h2>
<p>You opt in by providing your mobile number during signup or in your profile settings and agreeing to receive SMS account notifications. Consent is not a condition of purchase. We only message numbers that users themselves provide; we do not use purchased or third-party lists.</p>

<h2>Message frequency &amp; cost</h2>
<p>Message frequency varies based on your activity (for example, when your generations complete). <strong>Message and data rates may apply.</strong> ${BRAND} does not charge for the messages themselves; your mobile carrier's standard rates apply.</p>

<h2>Opt out &amp; help</h2>
<p>Reply <strong>STOP</strong> (or STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT) to any message to stop receiving texts. You will receive one confirmation and no further messages. Reply <strong>START</strong> to resubscribe. Reply <strong>HELP</strong> (or INFO) for help, or email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>

<h2>Privacy</h2>
<p><strong>We do not sell or share your mobile number or SMS opt-in consent with any third party or affiliate for their own marketing purposes.</strong> See our <a href="/legal/privacy">Privacy Policy</a>.</p>

<h2>Carriers</h2>
<p>Carriers are not liable for delayed or undelivered messages.</p>

<h2>Contact</h2>
<p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
`);
}

export function termsHtml(): string {
  return layout("Terms of Service", `
<h1>Terms of Service</h1>
<p class="eff">Effective ${EFFECTIVE}</p>

<p>By using ${BRAND} (${DOMAIN}) you agree to these Terms. If you do not agree, do not use the service.</p>

<h2>Accounts</h2>
<p>You must provide accurate information and keep your credentials secure. You are responsible for activity on your account. You must be old enough to form a binding contract in your jurisdiction.</p>

<h2>Acceptable use</h2>
<p>Do not use ${BRAND} to upload content you lack rights to, to infringe others' intellectual property, to create unlawful, harmful, or deceptive content, or to abuse the platform (including fraud, scraping, or attempts to game credits, referrals, or refunds).</p>

<h2>Credits &amp; pawprints</h2>
<p>Credits and pawprint tokens are prepaid, non-cash, in-app units used to access features. They have no cash value, are non-transferable, and are non-refundable except where required by law or as provided by our in-app refund process. Signup, profile, referral, and share bonuses are promotional and may change or be withdrawn.</p>

<h2>Your content &amp; generated outputs</h2>
<p>You retain ownership of content you upload. You grant ${BRAND} a limited license to store, process, and display that content solely to provide the service. Subject to these Terms and your account in good standing, you receive a license to use the models, videos, voice, and images generated for you, including for personal and commercial purposes.</p>

<h2>Voice cloning consent</h2>
<p>You may only create voice clones of a voice you own or have documented permission to use. You represent that you have the necessary rights and consent for any voice you submit.</p>

<h2>Platform intellectual property</h2>
<p>${BRAND}, and its templates, rigs, motion and voice libraries, software, and brand marks (including ${BRAND}, Furball3D, Pawprints, Pawlisher, and Fur Bin) are our property. You may not resell, redistribute, or reverse-engineer platform templates or libraries, use other users' shared models without permission, or train third-party models on platform outputs without our consent.</p>

<h2>SMS notifications</h2>
<p>If you opt in, we send account notifications by SMS under our <a href="/legal/sms">SMS Terms</a>. Message and data rates may apply; reply STOP to opt out.</p>

<h2>Payments</h2>
<p>Purchases are processed by Stripe. Prices are shown at checkout. Applicable taxes may apply.</p>

<h2>Disclaimers &amp; liability</h2>
<p>The service is provided "as is" without warranties. To the maximum extent permitted by law, ${BRAND} is not liable for indirect or consequential damages, and our total liability is limited to the amount you paid us in the prior 12 months.</p>

<h2>Termination</h2>
<p>We may suspend or terminate accounts that violate these Terms. You may close your account at any time.</p>

<h2>Changes</h2>
<p>We may update these Terms; continued use after changes constitutes acceptance.</p>

<h2>Contact</h2>
<p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
`);
}
