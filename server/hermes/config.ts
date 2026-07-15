const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;

type Env = Record<string, string | undefined>;

export type HermesConfig =
  | {
      enabled: false;
      timeoutMs: number;
    }
  | {
      enabled: true;
      baseUrl: string;
      producerSecret: string;
      timeoutMs: number;
    };

export class HermesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermesConfigError";
  }
}

function enabledFrom(raw: string | undefined): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function timeoutFrom(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new HermesConfigError(
      `HERMES_TIMEOUT_MS must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`,
    );
  }
  return value;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function baseUrlFrom(raw: string | undefined, nodeEnv: string | undefined): string {
  if (!raw || !raw.trim()) {
    throw new HermesConfigError("HERMES_EDGE_BRIDGE_URL is required when Hermes is enabled.");
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HermesConfigError("HERMES_EDGE_BRIDGE_URL must be a valid absolute URL.");
  }

  const testOnlyLoopback = nodeEnv === "test" && url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !testOnlyLoopback) {
    throw new HermesConfigError(
      "HERMES_EDGE_BRIDGE_URL must use HTTPS; HTTP loopback URLs are allowed only in tests.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HermesConfigError(
      "HERMES_EDGE_BRIDGE_URL must not contain credentials, a query string, or a fragment.",
    );
  }

  return url.toString().replace(/\/$/, "");
}

export function loadHermesConfig(env: Env = process.env): HermesConfig {
  const enabled = enabledFrom(env.HERMES_ENABLED);
  const timeoutMs = timeoutFrom(env.HERMES_TIMEOUT_MS);
  if (!enabled) return { enabled: false, timeoutMs };

  const producerSecret = String(env.HERMES_EDGE_PRODUCER_SECRET ?? "").trim();
  if (!producerSecret || producerSecret.length > 4096) {
    throw new HermesConfigError(
      "HERMES_EDGE_PRODUCER_SECRET is required when Hermes is enabled.",
    );
  }

  return {
    enabled: true,
    baseUrl: baseUrlFrom(env.HERMES_EDGE_BRIDGE_URL, env.NODE_ENV),
    producerSecret,
    timeoutMs,
  };
}

