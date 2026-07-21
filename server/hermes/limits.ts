import { createHash } from "node:crypto";

export type HermesLimitScope = "create" | "status";

export const HERMES_MINUTE_LIMITS = {
  create: { user: 5, ip: 30 },
  status: { user: 60, ip: 60 },
} as const;

export interface HermesLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface HermesMinuteLimits {
  consume(scope: HermesLimitScope, owner: string, ip: string): HermesLimitDecision;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

function keyHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class InMemoryHermesMinuteLimits implements HermesMinuteLimits {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = 60_000,
  ) {}

  consume(scope: HermesLimitScope, owner: string, ip: string): HermesLimitDecision {
    const now = this.now();
    const limits = HERMES_MINUTE_LIMITS[scope];
    const userKey = `${scope}:user:${keyHash(owner)}`;
    const ipKey = `${scope}:ip:${keyHash(ip)}`;
    const userEntry = this.current(userKey, now);
    const ipEntry = this.current(ipKey, now);

    const userLimited = userEntry != null && userEntry.count >= limits.user;
    const ipLimited = ipEntry != null && ipEntry.count >= limits.ip;
    if (userLimited || ipLimited) {
      const resetAt = Math.max(
        userLimited ? userEntry!.resetAt : now,
        ipLimited ? ipEntry!.resetAt : now,
      );
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    }

    this.increment(userKey, userEntry, now);
    this.increment(ipKey, ipEntry, now);
    return { allowed: true };
  }

  private current(key: string, now: number): WindowEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now >= entry.resetAt) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  private increment(key: string, current: WindowEntry | null, now: number): void {
    this.entries.set(key, current
      ? { ...current, count: current.count + 1 }
      : { count: 1, resetAt: now + this.windowMs });
  }
}
