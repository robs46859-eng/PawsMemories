import type { HermesConfig } from "./config";
import {
  HermesBridgeCreateResponseSchema,
  HermesBridgeStatusResponseSchemas,
  type HermesJobType,
  type HermesJsonValue,
} from "./schemas";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export type HermesClientErrorKind =
  | "timeout"
  | "unavailable"
  | "upstream"
  | "invalid_response";

export class HermesClientError extends Error {
  constructor(
    public readonly kind: HermesClientErrorKind,
    message = "Hermes client request failed.",
  ) {
    super(message);
    this.name = "HermesClientError";
  }
}

export interface HermesClient {
  createJob(
    type: HermesJobType,
    payload: Record<string, HermesJsonValue>,
    idempotencyKey: string,
  ): Promise<unknown>;
  getJob(bridgeJobId: string, type: HermesJobType): Promise<unknown>;
}

export type HermesFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type EnabledHermesConfig = Extract<HermesConfig, { enabled: true }>;

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new HermesClientError("invalid_response");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new HermesClientError("invalid_response");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new HermesClientError("invalid_response");

  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HermesClientError("invalid_response");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text);
  } catch {
    throw new HermesClientError("invalid_response");
  }
}

export class EdgeHermesClient implements HermesClient {
  private readonly fetchFn: HermesFetch;

  constructor(
    private readonly config: EnabledHermesConfig,
    fetchFn: HermesFetch = globalThis.fetch.bind(globalThis),
  ) {
    this.fetchFn = fetchFn;
  }

  async createJob(
    type: HermesJobType,
    payload: Record<string, HermesJsonValue>,
    idempotencyKey: string,
  ): Promise<unknown> {
    const value = await this.request("/v1/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ type, payload }),
    });
    const parsed = HermesBridgeCreateResponseSchema.safeParse(value);
    if (!parsed.success) throw new HermesClientError("invalid_response");
    return parsed.data;
  }

  async getJob(bridgeJobId: string, type: HermesJobType): Promise<unknown> {
    const value = await this.request(`/v1/jobs/${encodeURIComponent(bridgeJobId)}`, {
      method: "GET",
    });
    const parsed = HermesBridgeStatusResponseSchemas[type].safeParse(value);
    if (!parsed.success) throw new HermesClientError("invalid_response");
    return parsed.data;
  }

  private async request(pathname: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    try {
      const response = await this.fetchFn(`${this.config.baseUrl}${pathname}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.producerSecret}`,
          ...(init.headers ?? {}),
        },
        redirect: "error",
        signal: controller.signal,
      });

      if (response.redirected) throw new HermesClientError("upstream");
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new HermesClientError("upstream");
      }
      return await readBoundedJson(response);
    } catch (error) {
      if (error instanceof HermesClientError) throw error;
      if (controller.signal.aborted) throw new HermesClientError("timeout");
      throw new HermesClientError("unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}
