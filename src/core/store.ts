import { createModalSchedulerState, modalSchedulerReducer } from "./scheduler.js";
import { getModalPresentation, IDLE_PRESENTATION, isSamePresentation, type ModalPresentation } from "./selectors.js";
import type { ModalPolicyOverrides } from "./policies.js";
import type {
  ModalKind,
  ModalSchedulerAction,
  ModalSchedulerOptions,
  ModalSchedulerState,
  ResolvedModalPolicy,
} from "./types.js";

export type ModalSchedulerListener = () => void;

export type ModalStoreRequest<Name extends string> = {
  requestId: string;
  instanceId: string;
  name: Name;
  kind?: ModalKind | undefined;
  parentRequestId?: string | undefined;
  overrides?: ModalPolicyOverrides | undefined;
};

export type ModalSchedulerStoreOptions<Name extends string> = ModalSchedulerOptions & {
  resolvePolicy: (name: Name, overrides?: ModalPolicyOverrides) => ResolvedModalPolicy;
  /**
   * With `awaitExit`, how long to wait for an exit animation that is never
   * reported before moving on anyway.
   * @default 1000
   */
  exitTimeoutMs?: number;
  /** Clock used to stamp actions. @default Date.now */
  now?: () => number;
};

/**
 * External store for the scheduler. `subscribe`/`getSnapshot` match React's
 * `useSyncExternalStore`. Knows nothing about React, portals or focus.
 */
export class ModalSchedulerStore<Name extends string = string> {
  #state: ModalSchedulerState<Name>;
  #listeners = new Set<ModalSchedulerListener>();
  #presentations = new Map<string, ModalPresentation>();
  #exitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #resolvePolicy: ModalSchedulerStoreOptions<Name>["resolvePolicy"];
  #exitTimeoutMs: number;
  #now: () => number;

  constructor(options: ModalSchedulerStoreOptions<Name>) {
    this.#state = createModalSchedulerState<Name>(options);
    this.#resolvePolicy = options.resolvePolicy;
    this.#exitTimeoutMs = options.exitTimeoutMs ?? 1000;
    this.#now = options.now ?? Date.now;
  }

  getSnapshot = (): ModalSchedulerState<Name> => this.#state;

  subscribe = (listener: ModalSchedulerListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  dispatch = (action: ModalSchedulerAction<Name>): void => {
    const next = modalSchedulerReducer(this.#state, action);
    if (next === this.#state) return;

    this.#state = next;
    for (const requestId of this.#presentations.keys()) {
      if (!next.requests[requestId]) this.#presentations.delete(requestId);
    }
    this.#syncExitTimers();
    for (const listener of [...this.#listeners]) listener();
  };

  /** Presentation for one request. Referentially stable while it does not change. */
  getPresentation = (requestId: string | null | undefined): ModalPresentation => {
    if (!requestId || !this.#state.requests[requestId]) return IDLE_PRESENTATION;

    const next = getModalPresentation(this.#state, requestId);
    const previous = this.#presentations.get(requestId);
    if (previous && isSamePresentation(previous, next)) return previous;

    this.#presentations.set(requestId, next);
    return next;
  };

  request = (input: ModalStoreRequest<Name>): void => {
    this.dispatch({
      type: "request",
      now: this.#now(),
      request: {
        requestId: input.requestId,
        instanceId: input.instanceId,
        name: input.name,
        kind: input.kind ?? "dialog",
        parentRequestId: input.parentRequestId,
        policy: this.#resolvePolicy(input.name, input.overrides),
      },
    });
  };

  cancel = (requestId: string): void => {
    this.dispatch({ type: "cancel", requestId, now: this.#now() });
  };

  /** Pass `undefined` to go back to the priority configured for the modal's name. */
  updatePriority = (requestId: string, priority: number | undefined): void => {
    const request = this.#state.requests[requestId];
    if (!request) return;
    this.dispatch({
      type: "update-priority",
      requestId,
      priority: this.#resolvePolicy(request.name, { priority }).priority,
      now: this.#now(),
    });
  };

  exitComplete = (requestId: string): void => {
    this.dispatch({ type: "exit-complete", requestId, now: this.#now() });
  };

  /** Clears pending timers. The store stays usable and re-arms them on the next change. */
  dispose = (): void => {
    for (const timer of this.#exitTimers.values()) clearTimeout(timer);
    this.#exitTimers.clear();
  };

  #syncExitTimers(): void {
    const exiting = new Set(this.#state.exiting);

    for (const [requestId, timer] of this.#exitTimers) {
      if (!exiting.has(requestId)) {
        clearTimeout(timer);
        this.#exitTimers.delete(requestId);
      }
    }

    for (const requestId of exiting) {
      if (this.#exitTimers.has(requestId)) continue;
      this.#exitTimers.set(
        requestId,
        setTimeout(() => {
          this.#exitTimers.delete(requestId);
          this.exitComplete(requestId);
        }, this.#exitTimeoutMs),
      );
    }
  }
}
