import type { ModalPolicies, ModalPolicy, ResolvedModalPolicy } from "./types.js";

export type ModalName<Policies extends ModalPolicies> = Extract<keyof Policies, string>;

/** Fields a single modal instance may override on top of its named policy. `undefined` keeps the policy value. */
export type ModalPolicyOverrides = { [K in keyof ModalPolicy]?: ModalPolicy[K] | undefined };

export function resolveModalPolicy(policy: ModalPolicy, overrides?: ModalPolicyOverrides): ResolvedModalPolicy {
  const merged = { ...policy };
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
  }

  if (!Number.isFinite(merged.priority)) {
    throw new TypeError(`Modal priority must be a finite number, got ${String(merged.priority)}`);
  }

  return {
    priority: merged.priority,
    onPreempt: merged.onPreempt ?? "suspend",
    whenBlocked: merged.whenBlocked ?? "wait",
    maxWaitMs: merged.maxWaitMs,
    unique: merged.unique ?? false,
  };
}

/** Identity helper that keeps modal names as a literal union. */
export function defineModalPolicies<const Policies extends ModalPolicies>(policies: Policies): Policies {
  return policies;
}
