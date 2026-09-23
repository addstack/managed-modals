import { resolveModalPolicy, type ModalName, type ModalPolicyOverrides } from "./policies.js";
import { ModalSchedulerStore } from "./store.js";
import type { ModalPolicies, ResolvedModalPolicy } from "./types.js";

export type ModalManagerConfig<Policies extends ModalPolicies> = {
  policies: Policies;
  /**
   * Wait until a modal that leaves the screen finished its exit animation
   * before showing another one.
   * @default false
   */
  awaitExit?: boolean;
  /** Fallback for exit animations that are never reported. @default 1000 */
  exitTimeoutMs?: number;
};

export type ModalManager<Policies extends ModalPolicies> = {
  readonly policies: Policies;
  resolvePolicy(name: ModalName<Policies>, overrides?: ModalPolicyOverrides): ResolvedModalPolicy;
  createStore(options?: { now?: () => number }): ModalSchedulerStore<ModalName<Policies>>;
};

/** Framework-agnostic manager: typed policies plus a store factory. */
export function createModalManager<const Policies extends ModalPolicies>(
  config: ModalManagerConfig<Policies>,
): ModalManager<Policies> {
  type Name = ModalName<Policies>;

  const resolvePolicy = (name: Name, overrides?: ModalPolicyOverrides): ResolvedModalPolicy => {
    const policy = Object.prototype.hasOwnProperty.call(config.policies, name) ? config.policies[name] : undefined;
    if (!policy) {
      throw new Error(`Unknown modal name "${name}". Add it to the policies passed to createModalManager().`);
    }
    return resolveModalPolicy(policy, overrides);
  };

  return {
    policies: config.policies,
    resolvePolicy,
    createStore(options = {}) {
      return new ModalSchedulerStore<Name>({
        resolvePolicy,
        ...(config.awaitExit !== undefined ? { awaitExit: config.awaitExit } : {}),
        ...(config.exitTimeoutMs !== undefined ? { exitTimeoutMs: config.exitTimeoutMs } : {}),
        ...(options.now ? { now: options.now } : {}),
      });
    },
  };
}
