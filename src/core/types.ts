/** What kind of primitive renders the modal. Informational; scheduling ignores it. */
export type ModalKind = "dialog" | "alert-dialog" | "drawer" | "sheet" | (string & {});

/**
 * - `pending`   — wants to be open, not on screen yet.
 * - `active`    — on screen and on top.
 * - `covered`   — on screen, underneath its own nested modal (the flow is on screen).
 * - `suspended` — was on screen, hidden because another flow took over. Resumes later.
 * - `dismissed` — the scheduler gave up on it (see {@link ModalDismissReason}); it will
 *                 never be shown for this request. The owner should close it.
 */
export type ModalRequestStatus = "pending" | "active" | "covered" | "suspended" | "dismissed";

export type ModalDismissReason =
  /** Preempted while `onPreempt: "dismiss"`. */
  | "preempted"
  /** Could not be shown immediately while `whenBlocked: "dismiss"`. */
  | "blocked"
  /** Waited longer than `maxWaitMs`. */
  | "expired"
  /** Another request with the same name was already open while `unique: true`. */
  | "duplicate";

export type ModalPolicy = {
  /** Higher wins. Only a strictly higher priority preempts the flow on screen. */
  priority: number;
  /**
   * What happens when a higher-priority modal takes over.
   * - `"suspend"` (default): hide it and show it again afterwards.
   * - `"dismiss"`: close it for good.
   */
  onPreempt?: "suspend" | "dismiss";
  /**
   * What happens when the modal cannot be shown right away.
   * - `"wait"` (default): queue it.
   * - `"dismiss"`: drop it (useful for user-triggered UI such as a command palette).
   */
  whenBlocked?: "wait" | "dismiss";
  /** Drop a queued modal that has not been shown within this many milliseconds. */
  maxWaitMs?: number;
  /** Drop a new request if a request with the same name is already open or queued. */
  unique?: boolean;
};

export type ModalPolicies = Record<string, ModalPolicy>;

export type ResolvedModalPolicy = {
  priority: number;
  onPreempt: "suspend" | "dismiss";
  whenBlocked: "wait" | "dismiss";
  maxWaitMs: number | undefined;
  unique: boolean;
};

export type ModalRequest<Name extends string = string> = {
  /** One modal instance (component). Stable across open/close cycles. */
  instanceId: string;
  /** One false -> true open cycle of an instance. */
  requestId: string;
  /** Application-level modal name used for policy lookup. */
  name: Name;
  kind: ModalKind;
  policy: ResolvedModalPolicy;
  /** Parent modal for nested flows. Undefined means a root flow. */
  parentRequestId?: string;

  status: ModalRequestStatus;
  dismissReason?: ModalDismissReason;

  /** Wall clock. Used for `maxWaitMs` and debugging, never for ordering. */
  requestedAt: number;
  /** Logical clock value at request time. Orders equal-priority requests (FIFO). */
  sequence: number;
  /** Logical clock value of the last suspension. Most recently suspended resumes first. */
  suspendedSequence?: number;

  hasBeenPresented: boolean;
  firstPresentedAt?: number;
};

export type ModalSchedulerOptions = {
  /**
   * Wait for the exit animation of a modal that leaves the screen before
   * showing a different one. The UI layer reports completion with an
   * `exit-complete` action (the store adds a timeout fallback).
   * @default false
   */
  awaitExit?: boolean;
};

export type ModalSchedulerState<Name extends string = string> = {
  requests: Readonly<Record<string, ModalRequest<Name>>>;
  /** Leaf of the flow on screen. Its ancestors are `covered`. */
  activeRequestId: string | null;
  /** Requests that left the screen and whose exit animation has not completed. */
  exiting: readonly string[];
  /** Requests on the active path that wait for `exiting` to drain before opening. */
  entryBlocked: readonly string[];
  /** Logical clock. */
  clock: number;
  options: Required<ModalSchedulerOptions>;
};

export type RequestModalInput<Name extends string = string> = {
  requestId: string;
  instanceId: string;
  name: Name;
  kind: ModalKind;
  policy: ResolvedModalPolicy;
  parentRequestId?: string | undefined;
};

export type ModalSchedulerAction<Name extends string = string> =
  | { type: "request"; request: RequestModalInput<Name>; now: number }
  | { type: "cancel"; requestId: string; now: number }
  | { type: "update-priority"; requestId: string; priority: number; now: number }
  | { type: "exit-complete"; requestId: string; now: number };
