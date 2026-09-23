import type {
  ModalDismissReason,
  ModalRequest,
  ModalSchedulerAction,
  ModalSchedulerOptions,
  ModalSchedulerState,
} from "./types.js";

export function createModalSchedulerState<Name extends string = string>(
  options: ModalSchedulerOptions = {},
): ModalSchedulerState<Name> {
  return {
    requests: {},
    activeRequestId: null,
    exiting: [],
    entryBlocked: [],
    clock: 0,
    options: { awaitExit: options.awaitExit ?? false },
  };
}

function allRequests<Name extends string>(state: ModalSchedulerState<Name>): ModalRequest<Name>[] {
  return Object.values(state.requests) as ModalRequest<Name>[];
}

function isOnScreen(request: ModalRequest<string>): boolean {
  return request.status === "active" || request.status === "covered";
}

export function getActiveRequest<Name extends string>(
  state: ModalSchedulerState<Name>,
): ModalRequest<Name> | undefined {
  return state.activeRequestId === null ? undefined : state.requests[state.activeRequestId];
}

/**
 * The chain root → request, or `null` when the request is not schedulable:
 * it is dismissed, or one of its ancestors is dismissed or not registered yet
 * (a nested modal may register before its parent, e.g. because React runs
 * child effects first).
 */
export function getFlowPath<Name extends string>(
  state: ModalSchedulerState<Name>,
  requestId: string,
): ModalRequest<Name>[] | null {
  const path: ModalRequest<Name>[] = [];
  const seen = new Set<string>();
  let current = state.requests[requestId];

  while (current) {
    if (current.status === "dismissed" || seen.has(current.requestId)) return null;
    seen.add(current.requestId);
    path.push(current);
    if (current.parentRequestId === undefined) return path.reverse();
    current = state.requests[current.parentRequestId];
  }

  return null;
}

export function isDescendantOf<Name extends string>(
  state: ModalSchedulerState<Name>,
  requestId: string,
  ancestorRequestId: string,
): boolean {
  const seen = new Set<string>();
  let current = state.requests[requestId];

  while (current?.parentRequestId !== undefined) {
    if (current.parentRequestId === ancestorRequestId) return true;
    if (seen.has(current.parentRequestId)) return false;
    seen.add(current.parentRequestId);
    current = state.requests[current.parentRequestId];
  }

  return false;
}

/** Own priority raised to the highest priority of its ancestors. */
export function getEffectivePriority<Name extends string>(
  state: ModalSchedulerState<Name>,
  requestId: string,
): number {
  const request = state.requests[requestId];
  if (!request) return Number.NEGATIVE_INFINITY;

  let priority = request.policy.priority;
  const seen = new Set<string>([requestId]);
  let current = request;

  while (current.parentRequestId !== undefined && !seen.has(current.parentRequestId)) {
    seen.add(current.parentRequestId);
    const parent = state.requests[current.parentRequestId];
    if (!parent) break;
    priority = Math.max(priority, parent.policy.priority);
    current = parent;
  }

  return priority;
}

type Candidate<Name extends string> = {
  request: ModalRequest<Name>;
  path: ModalRequest<Name>[];
  priority: number;
  onScreen: boolean;
  started: boolean;
  suspendedSequence: number;
};

/**
 * Leaves of schedulable flows that are not the active request. Showing a leaf
 * shows its whole path: the leaf is `active`, its ancestors are `covered`.
 */
function getCandidates<Name extends string>(state: ModalSchedulerState<Name>): Candidate<Name>[] {
  const requests = allRequests(state);
  const parentsWithLiveChildren = new Set<string>();
  for (const request of requests) {
    if (request.parentRequestId !== undefined && request.status !== "dismissed") {
      parentsWithLiveChildren.add(request.parentRequestId);
    }
  }

  const candidates: Candidate<Name>[] = [];
  for (const request of requests) {
    if (request.requestId === state.activeRequestId) continue;
    if (parentsWithLiveChildren.has(request.requestId)) continue;

    const path = getFlowPath(state, request.requestId);
    if (!path) continue;

    let priority = Number.NEGATIVE_INFINITY;
    let onScreen = false;
    let started = false;
    let suspendedSequence = Number.NEGATIVE_INFINITY;
    for (const member of path) {
      priority = Math.max(priority, member.policy.priority);
      onScreen ||= isOnScreen(member);
      started ||= member.hasBeenPresented;
      suspendedSequence = Math.max(suspendedSequence, member.suspendedSequence ?? Number.NEGATIVE_INFINITY);
    }

    candidates.push({ request, path, priority, onScreen, started, suspendedSequence });
  }

  return candidates;
}

/**
 * Ordering among candidates (best first):
 * 1. higher effective priority;
 * 2. a flow that is on screen (e.g. the parent revealed when its nested child closes);
 * 3. a flow that was already shown before (resume before starting fresh work);
 * 4. the most recently suspended flow (stack semantics);
 * 5. within a flow, the branch that was already shown;
 * 6. FIFO by the flow's arrival, then by the request's arrival.
 */
function compareCandidates<Name extends string>(a: Candidate<Name>, b: Candidate<Name>): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.onScreen !== b.onScreen) return a.onScreen ? -1 : 1;
  if (a.started !== b.started) return a.started ? -1 : 1;
  if (a.suspendedSequence !== b.suspendedSequence) return a.suspendedSequence > b.suspendedSequence ? -1 : 1;
  if (a.request.hasBeenPresented !== b.request.hasBeenPresented) return a.request.hasBeenPresented ? -1 : 1;
  const aRoot = a.path[0]!.sequence;
  const bRoot = b.path[0]!.sequence;
  if (aRoot !== bRoot) return aRoot - bRoot;
  return a.request.sequence - b.request.sequence;
}

function pickBest<Name extends string>(candidates: Candidate<Name>[]): Candidate<Name> | undefined {
  let best: Candidate<Name> | undefined;
  for (const candidate of candidates) {
    if (!best || compareCandidates(candidate, best) < 0) best = candidate;
  }
  return best;
}

function dismiss<Name extends string>(request: ModalRequest<Name>, reason: ModalDismissReason): ModalRequest<Name> {
  return { ...request, status: "dismissed", dismissReason: reason };
}

/**
 * Moves the screen to the path of `targetId` (or to nothing). Requests that
 * leave the screen are suspended (or dismissed, per `onPreempt`), requests on
 * the new path become `covered`/`active`.
 */
function presentPath<Name extends string>(
  state: ModalSchedulerState<Name>,
  targetId: string | null,
  now: number,
): ModalSchedulerState<Name> {
  const newPath = targetId === null ? [] : (getFlowPath(state, targetId) ?? []);
  const newIds = new Set(newPath.map((request) => request.requestId));
  const requests = { ...state.requests };
  const exiting = [...state.exiting];
  let clock = state.clock;
  let suspendedSequence: number | undefined;

  for (const request of allRequests(state)) {
    if (!isOnScreen(request) || newIds.has(request.requestId)) continue;

    const wasVisible = !state.entryBlocked.includes(request.requestId);
    if (wasVisible && state.options.awaitExit) exiting.push(request.requestId);

    if (!request.hasBeenPresented) {
      requests[request.requestId] = { ...request, status: "pending" };
    } else if (request.policy.onPreempt === "dismiss") {
      requests[request.requestId] = dismiss(request, "preempted");
    } else {
      suspendedSequence ??= ++clock;
      requests[request.requestId] = { ...request, status: "suspended", suspendedSequence };
    }
  }

  const entryBlocked: string[] = [];
  newPath.forEach((request, index) => {
    const wasOnScreen = isOnScreen(request);
    const blocked =
      exiting.length > 0 && (!wasOnScreen || state.entryBlocked.includes(request.requestId));

    const next: ModalRequest<Name> = {
      ...request,
      status: index === newPath.length - 1 ? "active" : "covered",
    };
    delete next.suspendedSequence;

    if (blocked) {
      entryBlocked.push(request.requestId);
    } else if (!next.hasBeenPresented) {
      next.hasBeenPresented = true;
      next.firstPresentedAt = now;
    }

    requests[request.requestId] = next;
  });

  return {
    ...state,
    requests,
    activeRequestId: newPath.length > 0 ? targetId : null,
    exiting,
    entryBlocked,
    clock,
  };
}

function expireWaiting<Name extends string>(
  state: ModalSchedulerState<Name>,
  now: number,
): ModalSchedulerState<Name> {
  let requests: Record<string, ModalRequest<Name>> | undefined;

  for (const request of allRequests(state)) {
    const { maxWaitMs } = request.policy;
    if (request.status !== "pending" || request.hasBeenPresented || maxWaitMs === undefined) continue;
    if (now - request.requestedAt < maxWaitMs) continue;

    requests ??= { ...state.requests };
    requests[request.requestId] = dismiss(request, "expired");
  }

  return requests ? { ...state, requests } : state;
}

/**
 * Reconciles intent (registered requests) into what is on screen.
 *
 * - a nested descendant of the active modal opens on top immediately;
 * - otherwise only a strictly higher effective priority takes the screen;
 * - with nothing active, the best candidate is shown.
 */
export function reconcileModalScheduler<Name extends string>(
  input: ModalSchedulerState<Name>,
  now: number,
): ModalSchedulerState<Name> {
  const state = expireWaiting(input, now);
  const candidates = getCandidates(state);
  const active = getActiveRequest(state);

  if (!active || !getFlowPath(state, active.requestId)) {
    const best = pickBest(candidates);
    if (!best && allRequests(state).every((request) => !isOnScreen(request))) {
      return state.activeRequestId === null ? state : { ...state, activeRequestId: null };
    }
    return presentPath(state, best?.request.requestId ?? null, now);
  }

  const nested = pickBest(
    candidates.filter((candidate) => isDescendantOf(state, candidate.request.requestId, active.requestId)),
  );
  if (nested) return presentPath(state, nested.request.requestId, now);

  const best = pickBest(candidates);
  if (best && best.priority > getEffectivePriority(state, active.requestId)) {
    return presentPath(state, best.request.requestId, now);
  }

  return state;
}

function collectDescendantIds<Name extends string>(
  state: ModalSchedulerState<Name>,
  requestId: string,
): Set<string> {
  const ids = new Set<string>([requestId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const request of allRequests(state)) {
      if (request.parentRequestId !== undefined && ids.has(request.parentRequestId) && !ids.has(request.requestId)) {
        ids.add(request.requestId);
        changed = true;
      }
    }
  }

  return ids;
}

function finishExit<Name extends string>(
  state: ModalSchedulerState<Name>,
  requestId: string,
  now: number,
): ModalSchedulerState<Name> {
  const exiting = state.exiting.filter((id) => id !== requestId);
  if (exiting.length > 0 || state.entryBlocked.length === 0) return { ...state, exiting };

  const requests = { ...state.requests };
  for (const id of state.entryBlocked) {
    const request = requests[id];
    if (request && !request.hasBeenPresented) {
      requests[id] = { ...request, hasBeenPresented: true, firstPresentedAt: now };
    }
  }

  return { ...state, requests, exiting, entryBlocked: [] };
}

export function modalSchedulerReducer<Name extends string>(
  state: ModalSchedulerState<Name>,
  action: ModalSchedulerAction<Name>,
): ModalSchedulerState<Name> {
  switch (action.type) {
    case "request": {
      const input = action.request;
      if (state.requests[input.requestId]) return state;

      // Re-requesting an id that is still exiting (e.g. React Strict Mode
      // re-running effects) means the modal never actually left the screen.
      let base: ModalSchedulerState<Name> = state.exiting.includes(input.requestId)
        ? finishExit(state, input.requestId, action.now)
        : state;

      const sequence = base.clock + 1;
      const request: ModalRequest<Name> = {
        requestId: input.requestId,
        instanceId: input.instanceId,
        name: input.name,
        kind: input.kind,
        policy: input.policy,
        ...(input.parentRequestId !== undefined ? { parentRequestId: input.parentRequestId } : {}),
        status: "pending",
        requestedAt: action.now,
        sequence,
        hasBeenPresented: false,
      };

      const duplicate =
        input.policy.unique &&
        allRequests(base).some((other) => other.name === input.name && other.status !== "dismissed");

      base = {
        ...base,
        clock: sequence,
        requests: {
          ...base.requests,
          [request.requestId]: duplicate ? dismiss(request, "duplicate") : request,
        },
      };
      if (duplicate) return base;

      const next = reconcileModalScheduler(base, action.now);
      const registered = next.requests[request.requestId];
      if (
        registered?.status === "pending" &&
        registered.policy.whenBlocked === "dismiss" &&
        getFlowPath(next, request.requestId)
      ) {
        return {
          ...next,
          requests: { ...next.requests, [request.requestId]: dismiss(registered, "blocked") },
        };
      }

      return next;
    }

    case "cancel": {
      if (!state.requests[action.requestId]) return state;

      // Closing a parent closes its nested subtree as one flow.
      const removedIds = collectDescendantIds(state, action.requestId);
      const requests = { ...state.requests };
      const exiting = [...state.exiting];

      for (const id of removedIds) {
        const request = requests[id];
        if (!request) continue;
        if (state.options.awaitExit && isOnScreen(request) && !state.entryBlocked.includes(id)) {
          exiting.push(id);
        }
        delete requests[id];
      }

      return reconcileModalScheduler(
        {
          ...state,
          requests,
          exiting,
          entryBlocked: state.entryBlocked.filter((id) => !removedIds.has(id)),
          activeRequestId:
            state.activeRequestId !== null && removedIds.has(state.activeRequestId) ? null : state.activeRequestId,
        },
        action.now,
      );
    }

    case "update-priority": {
      const request = state.requests[action.requestId];
      if (!request || request.policy.priority === action.priority) return state;

      return reconcileModalScheduler(
        {
          ...state,
          requests: {
            ...state.requests,
            [request.requestId]: { ...request, policy: { ...request.policy, priority: action.priority } },
          },
        },
        action.now,
      );
    }

    case "exit-complete": {
      if (!state.exiting.includes(action.requestId)) return state;
      return reconcileModalScheduler(finishExit(state, action.requestId, action.now), action.now);
    }
  }
}

export type ModalDebugEntry = {
  requestId: string;
  name: string;
  status: ModalRequest["status"];
  priority: number;
  effectivePriority: number;
  sequence: number;
  parentRequestId: string | undefined;
  waitingForParent: boolean;
  entryBlocked: boolean;
  dismissReason: ModalDismissReason | undefined;
};

/** Human-friendly view of the scheduler, most important first. */
export function getDebugSnapshot<Name extends string>(state: ModalSchedulerState<Name>): ModalDebugEntry[] {
  return allRequests(state)
    .map((request) => ({
      requestId: request.requestId,
      name: request.name,
      status: request.status,
      priority: request.policy.priority,
      effectivePriority: getEffectivePriority(state, request.requestId),
      sequence: request.sequence,
      parentRequestId: request.parentRequestId,
      waitingForParent: request.status !== "dismissed" && getFlowPath(state, request.requestId) === null,
      entryBlocked: state.entryBlocked.includes(request.requestId),
      dismissReason: request.dismissReason,
    }))
    .sort((a, b) => b.effectivePriority - a.effectivePriority || a.sequence - b.sequence);
}
