import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createModalManager,
  createModalSchedulerState,
  getActiveRequest,
  getDebugSnapshot,
  getEffectivePriority,
  getModalPresentation,
  modalSchedulerReducer,
  resolveModalPolicy,
  type ModalPolicy,
  type ModalSchedulerOptions,
  type ModalSchedulerState,
} from "../src/core/index.js";

type State = ModalSchedulerState<string>;

function init(options?: ModalSchedulerOptions): State {
  return createModalSchedulerState(options);
}

function request(
  state: State,
  input: { id: string; priority: number; at: number; parent?: string; name?: string } & Omit<
    Partial<ModalPolicy>,
    "priority"
  >,
): State {
  const { id, priority, at, parent, name = id, ...policy } = input;
  return modalSchedulerReducer(state, {
    type: "request",
    now: at,
    request: {
      requestId: id,
      instanceId: `instance:${id}`,
      name,
      kind: "dialog",
      policy: resolveModalPolicy({ priority, ...policy }),
      ...(parent ? { parentRequestId: parent } : {}),
    },
  });
}

const cancel = (state: State, id: string, at: number) =>
  modalSchedulerReducer(state, { type: "cancel", requestId: id, now: at });
const updatePriority = (state: State, id: string, priority: number, at: number) =>
  modalSchedulerReducer(state, { type: "update-priority", requestId: id, priority, now: at });
const exitComplete = (state: State, id: string, at: number) =>
  modalSchedulerReducer(state, { type: "exit-complete", requestId: id, now: at });
const activeId = (state: State) => getActiveRequest(state)?.requestId ?? null;
const status = (state: State, id: string) => state.requests[id]?.status;
const open = (state: State, id: string) => getModalPresentation(state, id).open;

describe("priority and queueing", () => {
  test("first request becomes active", () => {
    const state = request(init(), { id: "onboarding", priority: 10, at: 100 });
    expect(activeId(state)).toBe("onboarding");
    expect(state.requests.onboarding?.firstPresentedAt).toBe(100);
  });

  test("strictly higher priority preempts and suspends the current modal", () => {
    let state = init();
    state = request(state, { id: "onboarding", priority: 10, at: 100 });
    state = request(state, { id: "billing", priority: 80, at: 200 });

    expect(activeId(state)).toBe("billing");
    expect(status(state, "onboarding")).toBe("suspended");
  });

  test("equal priority never preempts; equal fresh requests are FIFO", () => {
    let state = init();
    state = request(state, { id: "a", priority: 50, at: 100 });
    state = request(state, { id: "b", priority: 50, at: 101 });
    state = request(state, { id: "c", priority: 50, at: 102 });

    expect(activeId(state)).toBe("a");
    expect(status(state, "b")).toBe("pending");

    state = cancel(state, "a", 200);
    expect(activeId(state)).toBe("b");
    state = cancel(state, "b", 300);
    expect(activeId(state)).toBe("c");
  });

  test("FIFO uses the logical clock, not timestamps", () => {
    let state = init();
    state = request(state, { id: "blocker", priority: 100, at: 1 });
    state = request(state, { id: "first", priority: 10, at: 1000 });
    state = request(state, { id: "second", priority: 10, at: 999 }); // clock went backwards

    state = cancel(state, "blocker", 2000);
    expect(activeId(state)).toBe("first");
  });

  test("a suspended request resumes before an equal-priority fresh request", () => {
    let state = init();
    state = request(state, { id: "flow", priority: 50, at: 100 });
    state = request(state, { id: "critical", priority: 100, at: 200 });
    state = request(state, { id: "fresh", priority: 50, at: 300 });

    state = cancel(state, "critical", 400);
    expect(activeId(state)).toBe("flow");
    expect(status(state, "fresh")).toBe("pending");
  });

  test("a higher-priority pending request beats a lower-priority suspended one", () => {
    let state = init();
    state = request(state, { id: "onboarding", priority: 10, at: 100 });
    state = request(state, { id: "billing", priority: 50, at: 200 });
    state = request(state, { id: "critical", priority: 100, at: 300 });
    state = request(state, { id: "new-version", priority: 70, at: 400 });

    state = cancel(state, "critical", 500);
    expect(activeId(state)).toBe("new-version");
  });

  test("multi-level preemption resumes in priority order", () => {
    let state = init();
    state = request(state, { id: "onboarding", priority: 10, at: 100 });
    state = request(state, { id: "billing", priority: 50, at: 200 });
    state = request(state, { id: "session", priority: 100, at: 300 });

    state = cancel(state, "session", 400);
    expect(activeId(state)).toBe("billing");
    state = cancel(state, "billing", 500);
    expect(activeId(state)).toBe("onboarding");
  });

  test("equally important suspended requests resume LIFO even within one millisecond", () => {
    let state = init();
    state = request(state, { id: "A", priority: 50, at: 100 });
    state = request(state, { id: "B", priority: 60, at: 100 });
    state = updatePriority(state, "B", 50, 100);
    state = request(state, { id: "C", priority: 100, at: 100 });

    expect(status(state, "A")).toBe("suspended");
    expect(status(state, "B")).toBe("suspended");

    state = cancel(state, "C", 100);
    expect(activeId(state)).toBe("B");
  });

  test("cancelling a pending request means it is never presented", () => {
    let state = init();
    state = request(state, { id: "critical", priority: 100, at: 100 });
    state = request(state, { id: "onboarding", priority: 10, at: 200 });
    state = cancel(state, "onboarding", 250);
    state = cancel(state, "critical", 300);

    expect(activeId(state)).toBeNull();
    expect(state.requests.onboarding).toBeUndefined();
  });

  test("raising a pending priority preempts without creating a new request", () => {
    let state = init();
    state = request(state, { id: "a", priority: 50, at: 100 });
    state = request(state, { id: "b", priority: 10, at: 200 });
    const sequence = state.requests.b?.sequence;

    state = updatePriority(state, "b", 80, 300);
    expect(activeId(state)).toBe("b");
    expect(state.requests.b?.sequence).toBe(sequence);
    expect(status(state, "a")).toBe("suspended");
  });

  test("lowering the active priority lets a waiting request take over", () => {
    let state = init();
    state = request(state, { id: "active", priority: 100, at: 100 });
    state = request(state, { id: "pending", priority: 80, at: 200 });

    state = updatePriority(state, "active", 50, 300);
    expect(activeId(state)).toBe("pending");
    expect(status(state, "active")).toBe("suspended");
  });

  test("request is idempotent for the same requestId", () => {
    let state = init();
    state = request(state, { id: "same", priority: 10, at: 100 });
    const before = state;
    state = request(state, { id: "same", priority: 999, at: 200 });
    expect(state).toBe(before);
  });
});

describe("nested flows", () => {
  test("a nested modal opens on top even at equal effective priority; the parent stays on screen", () => {
    let state = init();
    state = request(state, { id: "edit-user", priority: 40, at: 100 });
    state = request(state, { id: "delete-confirm", priority: 10, at: 200, parent: "edit-user" });

    expect(getEffectivePriority(state, "delete-confirm")).toBe(40);
    expect(activeId(state)).toBe("delete-confirm");
    expect(status(state, "edit-user")).toBe("covered");
    expect(open(state, "edit-user")).toBe(true);
    expect(open(state, "delete-confirm")).toBe(true);
  });

  test("closing a nested child reveals its parent before an equal-priority global request", () => {
    let state = init();
    state = request(state, { id: "parent", priority: 50, at: 100 });
    state = request(state, { id: "child", priority: 50, at: 200, parent: "parent" });
    state = request(state, { id: "global", priority: 50, at: 300 });

    state = cancel(state, "child", 400);
    expect(activeId(state)).toBe("parent");
    expect(status(state, "global")).toBe("pending");
  });

  test("a queued sibling nested modal continues the flow before a global request", () => {
    let state = init();
    state = request(state, { id: "P", priority: 50, at: 100 });
    state = request(state, { id: "child1", priority: 50, at: 200, parent: "P" });
    state = request(state, { id: "G", priority: 50, at: 300 });
    state = request(state, { id: "child2", priority: 50, at: 400, parent: "P" });

    expect(status(state, "child2")).toBe("pending");
    state = cancel(state, "child1", 500);
    expect(activeId(state)).toBe("child2");
    expect(status(state, "P")).toBe("covered");
    expect(status(state, "G")).toBe("pending");
  });

  test("preempting a nested flow hides the whole flow and restores the leaf", () => {
    let state = init();
    state = request(state, { id: "parent", priority: 50, at: 100 });
    state = request(state, { id: "child", priority: 50, at: 200, parent: "parent" });
    state = request(state, { id: "critical", priority: 100, at: 300 });

    expect(activeId(state)).toBe("critical");
    expect(status(state, "parent")).toBe("suspended");
    expect(status(state, "child")).toBe("suspended");
    expect(getModalPresentation(state, "parent")).toMatchObject({ open: false, keepMounted: true });

    state = cancel(state, "critical", 400);
    expect(activeId(state)).toBe("child");
    expect(status(state, "parent")).toBe("covered");
  });

  test("closing a parent cancels its whole nested subtree", () => {
    let state = init();
    state = request(state, { id: "parent", priority: 50, at: 100 });
    state = request(state, { id: "child", priority: 50, at: 200, parent: "parent" });
    state = request(state, { id: "grandchild", priority: 50, at: 300, parent: "child" });

    state = cancel(state, "parent", 400);
    expect(Object.keys(state.requests)).toHaveLength(0);
    expect(activeId(state)).toBeNull();
  });

  test("a child registered before its parent waits and joins the flow when the parent arrives", () => {
    let state = init();
    state = request(state, { id: "child", priority: 10, at: 100, parent: "parent" });
    expect(activeId(state)).toBeNull();
    expect(getDebugSnapshot(state)[0]?.waitingForParent).toBe(true);

    state = request(state, { id: "parent", priority: 50, at: 100 });
    expect(activeId(state)).toBe("child");
    expect(status(state, "parent")).toBe("covered");
  });

  test("cancelling a parent also removes children still waiting for it", () => {
    let state = init();
    state = request(state, { id: "child", priority: 10, at: 100, parent: "parent" });
    state = request(state, { id: "parent", priority: 50, at: 100 });
    state = cancel(state, "parent", 200);
    expect(Object.keys(state.requests)).toHaveLength(0);
  });

  test("a child of a queued parent is shown together with it, never alone", () => {
    let state = init();
    state = request(state, { id: "critical", priority: 100, at: 100 });
    state = request(state, { id: "P", priority: 50, at: 200 });
    state = request(state, { id: "Ch", priority: 50, at: 300, parent: "P" });

    state = cancel(state, "critical", 400);
    expect(activeId(state)).toBe("Ch");
    expect(status(state, "P")).toBe("covered");
    expect(open(state, "P")).toBe(true);
  });

  test("a higher-priority sibling branch takes over within the flow", () => {
    let state = init();
    state = request(state, { id: "P", priority: 50, at: 100 });
    state = request(state, { id: "c1", priority: 50, at: 200, parent: "P" });
    state = request(state, { id: "c2", priority: 90, at: 300, parent: "P" });

    expect(activeId(state)).toBe("c2");
    expect(status(state, "P")).toBe("covered");
    expect(status(state, "c1")).toBe("suspended");

    state = cancel(state, "c2", 400);
    expect(activeId(state)).toBe("c1");
  });
});

describe("policies", () => {
  test('onPreempt: "dismiss" closes the modal instead of suspending it', () => {
    let state = init();
    state = request(state, { id: "promo", priority: 10, at: 100, onPreempt: "dismiss" });
    state = request(state, { id: "critical", priority: 100, at: 200 });

    expect(getModalPresentation(state, "promo")).toMatchObject({
      status: "dismissed",
      dismissReason: "preempted",
      suppressFinalFocus: true,
    });

    state = cancel(state, "critical", 300);
    expect(activeId(state)).toBeNull();
  });

  test('whenBlocked: "dismiss" drops a request that cannot be shown right away', () => {
    let state = init();
    state = request(state, { id: "billing", priority: 80, at: 100 });
    state = request(state, { id: "command-palette", priority: 20, at: 200, whenBlocked: "dismiss" });

    expect(getModalPresentation(state, "command-palette")).toMatchObject({
      status: "dismissed",
      dismissReason: "blocked",
    });

    state = cancel(state, "billing", 300);
    expect(activeId(state)).toBeNull();
  });

  test('whenBlocked: "dismiss" does not drop a request that is shown', () => {
    let state = init();
    state = request(state, { id: "command-palette", priority: 20, at: 200, whenBlocked: "dismiss" });
    expect(activeId(state)).toBe("command-palette");
  });

  test("maxWaitMs drops a request that waited too long", () => {
    let state = init();
    state = request(state, { id: "billing", priority: 80, at: 0 });
    state = request(state, { id: "new-version", priority: 50, at: 1000, maxWaitMs: 5000 });
    state = request(state, { id: "tips", priority: 10, at: 1000, maxWaitMs: 60_000 });

    state = cancel(state, "billing", 10_000);
    expect(status(state, "new-version")).toBe("dismissed");
    expect(state.requests["new-version"]?.dismissReason).toBe("expired");
    expect(activeId(state)).toBe("tips");
  });

  test("unique drops a second request with the same name", () => {
    let state = init();
    state = request(state, { id: "a", name: "billing", priority: 80, at: 100, unique: true });
    state = request(state, { id: "b", name: "billing", priority: 80, at: 200, unique: true });

    expect(activeId(state)).toBe("a");
    expect(state.requests.b?.dismissReason).toBe("duplicate");
  });
});

describe("awaitExit", () => {
  test("the next modal opens only after the previous one finished its exit", () => {
    let state = init({ awaitExit: true });
    state = request(state, { id: "a", priority: 50, at: 100 });
    state = request(state, { id: "b", priority: 50, at: 200 });

    state = cancel(state, "a", 300);
    expect(state.exiting).toEqual(["a"]);
    expect(activeId(state)).toBe("b");
    expect(getModalPresentation(state, "b")).toMatchObject({ status: "pending", open: false });

    state = exitComplete(state, "a", 350);
    expect(getModalPresentation(state, "b")).toMatchObject({ status: "active", open: true });
    expect(state.requests.b?.firstPresentedAt).toBe(350);
  });

  test("a preempted modal must finish its exit before the preemptor opens", () => {
    let state = init({ awaitExit: true });
    state = request(state, { id: "form", priority: 10, at: 100 });
    state = request(state, { id: "critical", priority: 100, at: 200 });

    expect(open(state, "form")).toBe(false);
    expect(open(state, "critical")).toBe(false);

    state = exitComplete(state, "form", 250);
    expect(open(state, "critical")).toBe(true);
  });

  test("nested open and close do not wait", () => {
    let state = init({ awaitExit: true });
    state = request(state, { id: "parent", priority: 50, at: 100 });
    state = request(state, { id: "child", priority: 50, at: 200, parent: "parent" });
    expect(open(state, "child")).toBe(true);

    state = cancel(state, "child", 300);
    expect(state.exiting).toEqual(["child"]);
    expect(getModalPresentation(state, "parent")).toMatchObject({ status: "active", open: true });
  });

  test("a modal that never became visible does not wait for its own exit", () => {
    let state = init({ awaitExit: true });
    state = request(state, { id: "a", priority: 50, at: 100 });
    state = request(state, { id: "b", priority: 50, at: 200 });
    state = cancel(state, "a", 300); // b chosen, blocked by a's exit
    state = cancel(state, "b", 310); // b never shown

    expect(state.exiting).toEqual(["a"]);
    expect(state.entryBlocked).toEqual([]);
  });

  test("re-requesting an exiting id (Strict Mode effects) keeps it on screen", () => {
    let state = init({ awaitExit: true });
    state = request(state, { id: "a", priority: 50, at: 100 });
    state = cancel(state, "a", 100);
    state = request(state, { id: "a", priority: 50, at: 100 });

    expect(state.exiting).toEqual([]);
    expect(open(state, "a")).toBe(true);
  });
});

describe("store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const manager = createModalManager({
    policies: {
      "session-expired": { priority: 100 },
      onboarding: { priority: 10 },
    },
  });

  test("resolves priority from policies and supports per-instance overrides", () => {
    expect(manager.resolvePolicy("onboarding").priority).toBe(10);
    expect(manager.resolvePolicy("onboarding", { priority: 70 }).priority).toBe(70);
    expect(manager.resolvePolicy("onboarding", { priority: undefined }).priority).toBe(10);
    // @ts-expect-error unknown names are rejected at compile time
    expect(() => manager.resolvePolicy("typo")).toThrow(/Unknown modal name/);
  });

  test("works with useSyncExternalStore-style subscribe/getSnapshot, including detached methods", () => {
    const { subscribe, getSnapshot, request: open, cancel: close } = manager.createStore();
    let notifications = 0;
    const unsubscribe = subscribe(() => notifications++);

    open({ requestId: "r1", instanceId: "i1", name: "onboarding" });
    expect(getSnapshot().activeRequestId).toBe("r1");
    expect(notifications).toBe(1);

    unsubscribe();
    close("r1");
    expect(notifications).toBe(1);
  });

  test("getPresentation is referentially stable while nothing relevant changes", () => {
    const store = manager.createStore();
    store.request({ requestId: "a", instanceId: "a", name: "onboarding" });
    const first = store.getPresentation("a");

    store.request({ requestId: "b", instanceId: "b", name: "onboarding" }); // queued, "a" unchanged
    expect(store.getPresentation("a")).toBe(first);

    store.request({ requestId: "c", instanceId: "c", name: "session-expired" });
    expect(store.getPresentation("a")).not.toBe(first);
    expect(store.getPresentation("a").status).toBe("suspended");
  });

  test("updatePriority(undefined) returns to the configured priority", () => {
    const store = manager.createStore();
    store.request({ requestId: "a", instanceId: "a", name: "onboarding", overrides: { priority: 90 } });
    store.updatePriority("a", undefined);
    expect(store.getSnapshot().requests.a?.policy.priority).toBe(10);
  });

  test("an exit that is never reported completes after exitTimeoutMs", () => {
    vi.useFakeTimers();
    const store = createModalManager({
      policies: { a: { priority: 1 }, b: { priority: 1 } },
      awaitExit: true,
      exitTimeoutMs: 300,
    }).createStore();

    store.request({ requestId: "a", instanceId: "a", name: "a" });
    store.request({ requestId: "b", instanceId: "b", name: "b" });
    store.cancel("a");
    expect(store.getPresentation("b").open).toBe(false);

    vi.advanceTimersByTime(299);
    expect(store.getPresentation("b").open).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.getPresentation("b").open).toBe(true);
  });
});
