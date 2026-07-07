/**
 * src/brain/behaviorTree.ts
 * Tiny hand-rolled Behavior Tree (~150 lines) — NOT a library, so it stays
 * agent-editable and portable (AR_PET_SIM_SPEC §4.4).
 *
 * Node kinds: Sequence, Selector, Parallel, Decorator (Inverter/Succeeder/Repeat),
 * and Leaf actions from a registry.
 */

export type BTStatus = "success" | "failure" | "running";

/** Blackboard passed to leaves — the stage fills in real capabilities (pathfind, playClip). */
export interface BTContext {
  dt: number;
  /** Leaf implementations look these up; keeps the tree data-only + serialisable. */
  now: number;
  /** Arbitrary shared scratch for a running goal (e.g. progress timers). */
  blackboard: Record<string, unknown>;
  /** Emit a side-effect event (vocalize, clip request) up to the host. */
  emit?: (evt: { type: string; [k: string]: unknown }) => void;
}

export type LeafFn = (ctx: BTContext) => BTStatus;

export interface BTNode {
  tick(ctx: BTContext): BTStatus;
}

/** Runs children in order; fails on first failure; succeeds when all succeed. */
export class Sequence implements BTNode {
  constructor(private children: BTNode[]) {}
  tick(ctx: BTContext): BTStatus {
    for (const child of this.children) {
      const s = child.tick(ctx);
      if (s !== "success") return s; // failure or running short-circuits
    }
    return "success";
  }
}

/** Runs children in order; succeeds on first success; fails when all fail. */
export class Selector implements BTNode {
  constructor(private children: BTNode[]) {}
  tick(ctx: BTContext): BTStatus {
    for (const child of this.children) {
      const s = child.tick(ctx);
      if (s !== "failure") return s; // success or running short-circuits
    }
    return "failure";
  }
}

/**
 * Ticks all children. `policy: "all"` succeeds when all succeed;
 * `policy: "any"` succeeds when any succeeds. Running if not yet decided.
 */
export class Parallel implements BTNode {
  constructor(private children: BTNode[], private policy: "all" | "any" = "all") {}
  tick(ctx: BTContext): BTStatus {
    let successes = 0;
    let failures = 0;
    for (const child of this.children) {
      const s = child.tick(ctx);
      if (s === "success") successes++;
      else if (s === "failure") failures++;
    }
    if (this.policy === "any") {
      if (successes > 0) return "success";
      if (failures === this.children.length) return "failure";
    } else {
      if (successes === this.children.length) return "success";
      if (failures > 0) return "failure";
    }
    return "running";
  }
}

/** Inverts success<->failure; passes running through. */
export class Inverter implements BTNode {
  constructor(private child: BTNode) {}
  tick(ctx: BTContext): BTStatus {
    const s = this.child.tick(ctx);
    if (s === "success") return "failure";
    if (s === "failure") return "success";
    return "running";
  }
}

/** Always reports success once the child is done (running passes through). */
export class Succeeder implements BTNode {
  constructor(private child: BTNode) {}
  tick(ctx: BTContext): BTStatus {
    const s = this.child.tick(ctx);
    return s === "running" ? "running" : "success";
  }
}

/** A leaf backed by a function from the registry. */
export class Leaf implements BTNode {
  constructor(public name: string, private fn: LeafFn) {}
  tick(ctx: BTContext): BTStatus {
    return this.fn(ctx);
  }
}

/** Registry of named leaf behaviors so trees can be authored declaratively. */
export class LeafRegistry {
  private map = new Map<string, LeafFn>();
  register(name: string, fn: LeafFn): this {
    this.map.set(name, fn);
    return this;
  }
  leaf(name: string): Leaf {
    const fn = this.map.get(name);
    if (!fn) throw new Error(`BT leaf not registered: ${name}`);
    return new Leaf(name, fn);
  }
  has(name: string): boolean {
    return this.map.has(name);
  }
}

/** Convenience constructors. */
export const seq = (...c: BTNode[]) => new Sequence(c);
export const sel = (...c: BTNode[]) => new Selector(c);
export const par = (policy: "all" | "any", ...c: BTNode[]) => new Parallel(c, policy);
