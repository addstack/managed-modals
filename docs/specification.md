# managed-modals — specification

Status: describes version 0.1.0. This is the normative description of behaviour; the tests in [`test/`](../test) (jsdom) and [`e2e/`](../e2e) (Playwright) are its executable form. When code and this document disagree, one of them is a bug.

- [1. Scope](#1-scope)
- [2. Terminology](#2-terminology)
- [3. Scheduler state](#3-scheduler-state)
- [4. Actions](#4-actions)
- [5. Reconciliation](#5-reconciliation)
- [6. Policies](#6-policies)
- [7. Exit animations (`awaitExit`)](#7-exit-animations-awaitexit)
- [8. Presentation](#8-presentation)
- [9. Store](#9-store)
- [10. React binding](#10-react-binding)
- [11. Adapters and content integration](#11-adapters-and-content-integration)
- [12. Invariants](#12-invariants)
- [13. Known limitations and open questions](#13-known-limitations-and-open-questions)

## 1. Scope

The package decides **which modal flow is on screen** when several dialogs, drawers, sheets or alert dialogs want to be open at the same time.

It is split into two layers:

| Layer | Entry point | Depends on | Responsibility |
| --- | --- | --- | --- |
| Core | `@addstack/managed-modals` | nothing | Pure reducer, store, policies, presentation selector. |
| React binding | `@addstack/managed-modals/react` | `react` (peer, ≥ 18) | Registers modals from components, wraps primitive roots, provides context. |

Neither layer imports Radix, Base UI, vaul or shadcn. Primitive-specific behaviour lives in *adapters* (plain objects) and in small changes to the application's own content components ([§11](#11-adapters-and-content-integration)).

Non-goals: rendering, styling, animation, focus trapping, scroll locking. These remain the primitive's job; the scheduler only drives the primitive's `open` prop and a few hints.

## 2. Terminology

- **Instance**: one mounted modal component. Identified by `instanceId`, which is stable across open/close cycles.
- **Request**: one open cycle of an instance, starting when its intent goes `false → true` and ending when it goes back to `false` or the instance unmounts. Identified by `requestId`.
- **Intent**: the application's `open` value, meaning "this modal wants to be open".
- **Name**: the application-level modal name, used as the policy key. The React binding types it as a union of the policy keys.
- **Parent**: a request may have a `parentRequestId`. A request with a parent is **nested**.
- **Flow**: a tree of requests connected by parent links. The root has no parent.
- **Path**: the chain *root → … → request*. A request is **schedulable** when its path exists: every ancestor is registered and none of the path is dismissed.
- **Waiting for parent**: the request is registered, but an ancestor is not (yet) registered. Such a request is not schedulable.
- **Leaf**: a request with no *live* (non-dismissed) children.
- **Effective priority**: the maximum `policy.priority` over the request's path, i.e. its own priority raised to its highest ancestor's.
- **On screen**: status `active` or `covered`.
- **Active**: the leaf of the flow on screen. There is at most one.
- **Covered**: an ancestor of the active request. It is on screen, underneath its nested child.
- **Entry-blocked**: chosen to be on screen, but waiting for exit animations to finish ([§7](#7-exit-animations-awaitexit)).
- **Exiting**: left the screen, and its exit animation has not been reported as finished yet ([§7](#7-exit-animations-awaitexit)).

## 3. Scheduler state

```ts
type ModalSchedulerState = {
  requests: Record<requestId, ModalRequest>;
  activeRequestId: string | null;
  exiting: string[];        // request ids, in order of leaving
  entryBlocked: string[];   // request ids on the active path that wait for `exiting` to drain
  clock: number;            // logical clock
  options: { awaitExit: boolean };
};
```

### 3.1 Request

| Field | Meaning |
| --- | --- |
| `requestId`, `instanceId`, `name`, `kind` | Identity. `kind` (`"dialog" \| "alert-dialog" \| "drawer" \| "sheet" \| string`) is informational and never affects scheduling. |
| `policy` | Resolved policy ([§6](#6-policies)), copied into the request when it registers. Only `priority` can change afterwards. |
| `parentRequestId?` | Parent link for nested flows. |
| `status` | `pending \| active \| covered \| suspended \| dismissed` ([§3.2](#32-status)). |
| `dismissReason?` | Set when `status === "dismissed"`. |
| `requestedAt` | Wall-clock time of the request. Used **only** for `maxWaitMs` and debugging. |
| `sequence` | Logical clock value at request time. Orders equal-priority work (FIFO). |
| `suspendedSequence?` | Logical clock value of the last suspension. Orders resumption (LIFO). Cleared when the request is back on screen. |
| `hasBeenPresented` | The request was actually visible at least once. |
| `firstPresentedAt?` | Wall-clock time it first became visible. |

The logical clock increases by one for every request and for every suspension step. Timestamps never decide order, because several dispatches in the same millisecond are normal in React.

### 3.2 Status

| Status | On screen | Meaning |
| --- | --- | --- |
| `pending` | no | Wants to be open and has not been shown yet. Queued, or waiting for its parent. |
| `active` | yes | Top of the flow on screen. |
| `covered` | yes | On screen under its own nested child. |
| `suspended` | no | Was shown, then hidden because another flow or branch took over. Will come back. |
| `dismissed` | no | The scheduler gave up on this request for good. It stays registered until its owner cancels it, so the owner can observe the dismissal. |

Transitions (all happen inside a single action):

```
            request
               │
               ▼
┌──────── pending ────────┐
│ duplicate / blocked /   │ chosen
│ expired                 ▼
│               active ⇄ covered      (a nested child opens / closes on top)
│                 │  ▲
│  preempted with │  │ chosen again
│  onPreempt:     ▼  │
│  "suspend"    suspended
▼
dismissed ◄── preempted with onPreempt: "dismiss"

cancel (any status) → removed from `requests`
```

A request that was chosen but is still entry-blocked and loses the screen before it was ever visible goes back to `pending`, not `suspended`.

## 4. Actions

The reducer is `modalSchedulerReducer(state, action) → state`. It is pure: every action carries `now` (wall clock) and the reducer reads no other clock. If an action changes nothing, the reducer returns the same state object.

### 4.1 `request`

`{ type: "request", request: { requestId, instanceId, name, kind, policy, parentRequestId? }, now }`

1. If `requestId` is already registered, return the same state. The action is idempotent.
2. If `requestId` is in `exiting`, finish that exit first (see [§7](#7-exit-animations-awaitexit)). Re-requesting an id that has not finished exiting means the modal never really left the screen, e.g. React Strict Mode re-running effects.
3. Register the request as `pending` with `sequence = clock + 1`.
4. **Unique**: if `policy.unique` is true and another non-dismissed request has the same `name`, the new request is registered directly as `dismissed("duplicate")`. No reconciliation happens.
5. Otherwise reconcile ([§5](#5-reconciliation)).
6. **Blocked**: if the new request is still `pending`, is schedulable, and `policy.whenBlocked === "dismiss"`, mark it `dismissed("blocked")`. A request that is waiting for its parent is not considered blocked.

An unknown `parentRequestId` is allowed. The request waits for its parent ([§5.2](#52-candidates)). This is required because React runs a child's effects before its parent's.

### 4.2 `cancel`

`{ type: "cancel", requestId, now }`: the owner no longer wants the modal (user closed it, app state changed, or the component unmounted).

1. Collect the request and all its descendants, following parent links. This includes descendants that are still waiting for a parent.
2. With `awaitExit`, each removed request that was visible goes into `exiting`. Visible means on screen and not entry-blocked.
3. Remove them from `requests` and from `entryBlocked`. If the active request was removed, set `activeRequestId = null`.
4. Reconcile.

Closing a parent therefore closes its whole nested subtree.

### 4.3 `update-priority`

`{ type: "update-priority", requestId, priority, now }` replaces `policy.priority` and reconciles. `sequence` and `requestedAt` are kept, so the request keeps its place in line. This can reorder the queue or cause a preemption in either direction:

- raising a waiting request's priority above the active one lets it take over;
- lowering the active request's priority lets a waiting request take over.

### 4.4 `exit-complete`

`{ type: "exit-complete", requestId, now }` removes `requestId` from `exiting`, and does nothing if it is not there. When `exiting` becomes empty, every entry-blocked request becomes visible: `hasBeenPresented = true`, `firstPresentedAt = now`, and `entryBlocked` is emptied. Then the reducer reconciles.

## 5. Reconciliation

`reconcileModalScheduler(state, now)` runs after every mutating action. It applies at most one screen transition, which is sufficient because the chosen target is always the best candidate under the rules below.

### 5.1 Expiry

First, every request with status `pending`, `hasBeenPresented === false`, a `maxWaitMs`, and `now - requestedAt >= maxWaitMs` becomes `dismissed("expired")`.

Expiry is evaluated lazily, on the next action. This is deliberate: the moment that matters is when the blocking modal closes, and that is an action. A waiting modal therefore never appears after its deadline, although its `dismissed` status may be reported later than the deadline.

### 5.2 Candidates

A candidate is a request that:

- is not the active request;
- is schedulable (its path exists and contains no dismissed request);
- is a leaf (it has no live children).

Showing a candidate shows its whole path: the candidate becomes `active` and its ancestors become `covered`. Parents with live children are never candidates themselves; their flow is represented by its leaves.

### 5.3 Ranking

Candidates are compared on the following keys, in order. The first difference decides.

1. **Effective priority**: higher first.
2. **On screen**: a candidate whose path contains an on-screen request first. This is the parent revealed when its nested child closes, or a queued sibling continuing the flow on screen.
3. **Started**: a candidate whose path contains a request with `hasBeenPresented` first. Interrupted work resumes before fresh work.
4. **Most recently suspended flow**: the maximum `suspendedSequence` on the path, higher first (stack semantics).
5. **Branch already shown**: the candidate's own `hasBeenPresented`, true first.
6. **Flow arrival**: the `sequence` of the path's root, lower first (FIFO between flows).
7. **Request arrival**: the candidate's own `sequence`, lower first.

### 5.4 Choosing the target

Let *A* be the active request.

- **No active request**, or *A* is not schedulable: the target is the best candidate, or nothing if there are no candidates.
- **A nested descendant of *A* is a candidate**: the target is the best such descendant, **regardless of priority**. A modal opened from inside the active modal always opens on top of it.
- **Otherwise**: the target is the best candidate only if its effective priority is **strictly greater** than *A*'s effective priority. Otherwise nothing changes. Equal priorities never preempt, so they cannot thrash.

A higher-priority candidate from a *sibling branch* of the same flow switches branches. The shared ancestors stay `covered`, and the previous branch is suspended.

### 5.5 Transition (`presentPath`)

Given the target's path *P* (empty for "nothing"):

1. Each on-screen request that is not in *P* leaves the screen:
   - With `awaitExit`, if it was visible (not entry-blocked), it is appended to `exiting`.
   - If it was never visible (`hasBeenPresented === false`), it goes back to `pending`.
   - Otherwise, if `onPreempt === "dismiss"`, it becomes `dismissed("preempted")`.
   - Otherwise it becomes `suspended`. All requests suspended in one transition share one new `suspendedSequence`.
2. Each request in *P* becomes `covered`, and the last one becomes `active`. `suspendedSequence` is cleared.
   - If `exiting` is non-empty and the request was not already visible, it is **entry-blocked**. It was not visible if it was not on screen before, or was entry-blocked before.
   - Otherwise, if it had never been presented, it is now presented (`hasBeenPresented = true`, `firstPresentedAt = now`).
3. `activeRequestId` becomes the target, or `null`.

A dismissed ancestor makes its descendants non-schedulable. They remain registered, invisible, until their owners cancel them.

## 6. Policies

Policies are declared per name. An instance may override fields for itself.

| Field | Type | Default | Semantics |
| --- | --- | --- | --- |
| `priority` | finite number | required | Base priority. Non-finite values throw `TypeError`. |
| `onPreempt` | `"suspend" \| "dismiss"` | `"suspend"` | Applied when a previously shown request leaves the screen because something else was chosen. |
| `whenBlocked` | `"wait" \| "dismiss"` | `"wait"` | Applied once, right after the request action ([§4.1](#41-request)). |
| `maxWaitMs` | number | none | Applies only while the request has never been shown ([§5.1](#51-expiry)). |
| `unique` | boolean | `false` | Applies at request time. The existing request wins ([§4.1](#41-request)). |

Resolution is `resolveModalPolicy(policy, overrides)`: an override replaces a field unless its value is `undefined`. An unknown name throws at runtime (`createModalManager().resolvePolicy`) and is a compile error in the typed APIs.

In the React binding:

- `priority` is reactive. Changes dispatch `update-priority`, and `undefined` returns to the configured priority.
- The other overrides (`policy` prop) are read when the request registers.

## 7. Exit animations (`awaitExit`)

`awaitExit` is off by default. When it is on, the screen is serialized:

1. A request that leaves the screen while visible enters `exiting`. This happens on cancel, suspension or dismissal.
2. While `exiting` is non-empty, requests that *newly* come on screen are entry-blocked. They are chosen (their status is `active`/`covered`), but their presentation says `open: false` ([§8](#8-presentation)).
3. Requests that were already visible stay visible. A parent revealed by its closing child becomes active immediately, and a nested child opening over a visible parent is not delayed unless an unrelated exit is still running.
4. `exit-complete` removes an id from `exiting`. When the list drains, entry-blocked requests become visible.

A request that is cancelled while entry-blocked never becomes visible, so it never enters `exiting`.

The store completes any exit that is not reported within `exitTimeoutMs` (default 1000 ms), so a missing report can delay the queue but can never stall it ([§9](#9-store)). The React binding reports completion from the primitive ([§11](#11-adapters-and-content-integration)), and immediately when a component unmounts ([§10.3](#103-registration)).

## 8. Presentation

`getModalPresentation(state, requestId)` maps one request to what a primitive needs:

| Situation | `status` | `open` | `keepMounted` | `suppressFinalFocus` |
| --- | --- | --- | --- | --- |
| no request id / not registered | `idle` | false | false | false |
| `pending` | `pending` | false | false | false |
| `active` / `covered`, visible | same | **true** | true | false |
| `active` / `covered`, entry-blocked, never shown | `pending` | false | false | false |
| `active` / `covered`, entry-blocked, shown before | `suspended` | false | true | true |
| `suspended` | `suspended` | false | true | true |
| `dismissed` | `dismissed` | false | false | `dismissReason === "preempted"` |

`dismissReason` is included for `dismissed`.

The React binding adds one transient presentation. When the application closes a modal while it is `suspended` (its intent goes `false`), the content reads `{ status: "suspended", open: false, keepMounted: false, suppressFinalFocus: true }` for the commit in which the primitive takes the content down, then `idle`. Content that hides itself while suspended (the `keepMounted` integration) stays hidden instead of playing its exit animation over the active modal.

- `open` is the value for the primitive's `open` prop.
- `keepMounted` stays `true` for the whole life of a shown request (on screen or suspended), not only while it is suspended. Some primitives (Base UI) derive their mounted state from `open` with a delay of one render. Dropping `keepMounted` in the same render that sets `open` again would remount the content and lose its state.
- `suppressFinalFocus` means the modal is closing because of a scheduler switch, not because the user closed it. The primitive must not move focus back to its trigger.

`IDLE_PRESENTATION` is a frozen singleton.

## 9. Store

`ModalSchedulerStore` (created by `createModalManager(config).createStore()`) wraps the reducer:

- `getSnapshot()` and `subscribe(listener)` follow the `useSyncExternalStore` contract. Listeners are notified once per state change and not at all for no-op actions.
- `dispatch(action)` is the raw reducer entry point.
- `request(input)`, `cancel(id)`, `updatePriority(id, priority | undefined)` and `exitComplete(id)` are convenience methods. They stamp `now` (default `Date.now`, configurable) and resolve policies by name.
- `getPresentation(id)` is cached per request. It returns the **same object** while the presentation is unchanged, even when unrelated parts of the state change, so it can be used directly as a `useSyncExternalStore` snapshot. Cache entries are dropped when requests are removed.
- Exit timers: after every change, the store starts a timer for each id in `exiting` that has no timer, and clears timers for ids no longer exiting. A timer fires `exitComplete(id)` after `exitTimeoutMs`.
- `dispose()` clears timers. The store stays usable and re-arms timers on the next change.
- All methods are bound, so destructuring them is safe.

## 10. React binding

### 10.1 Factory

`createManagedModals({ policies, awaitExit?, exitTimeoutMs? })` returns:

| Member | Purpose |
| --- | --- |
| `ModalProvider` | Creates one store (or uses `store` prop) and provides it. Render once near the root. |
| `managed(Root, { kind, adapter?, displayName? })` | Wraps any root component with `open`/`onOpenChange` ([§10.4](#104-managed-roots)). Meant for the root in the application's own `components/ui` files, so that call sites keep their imports. |
| `useManagedModal(options)` | Low-level hook ([§10.3](#103-registration)). |
| `useModalSchedulerState()` | Current state for debugging UIs. |
| `manager` | The core manager (policies, `resolvePolicy`, `createStore`). |

The factory is meant to be called once, at module level. Contexts are module-level, so content components can import `useModalPresentation` from the package without importing the application's factory.

### 10.2 Request id lifecycle

Each instance has `instanceId = useId()` and a cycle counter. The counter increments during render when intent goes `false → true`, following the "adjust state while rendering" pattern. The request id is `` `${instanceId}#${cycle}` `` while intent is true, and `null` otherwise.

The id is known **during render**, so nested modals rendered in the same pass can read their parent's id from context before any effect has run.

### 10.3 Registration

`useManagedModal` registers the request in a layout effect (an effect on the server). This avoids a painted frame in which the primitive shows a stale open state. In order:

1. The latest options are stored in a ref, so registration reads the current name, priority and policy.
2. Registration: `request(...)` when the id becomes non-null; the cleanup calls `cancel(id)`. The effect depends on the store, the request id, the instance id, `kind` and the parent id. Changing `name` while open is not supported; the first name is kept.
3. Priority: `updatePriority(id, priority)` whenever the `priority` option changes.
4. Unmount: the cleanup calls `exitComplete(lastRequestId)`. It is declared after the registration effect, so on unmount it runs after `cancel`: an unmounted component has no exit animation to wait for.

Strict Mode runs these steps twice: cancel → exit-complete → request with the same id. Because of [§4.1](#41-request) step 2, the net effect is that the modal stays registered and visible.

**Parent discovery**: the parent is the nearest `ManagedModalContext` request id. Passing `parentRequestId: null` forces a root flow. A child that registers before its parent waits for it ([§4.1](#41-request)).

**Dismissal**: when the presentation status becomes `dismissed`, `onDismiss(reason)` is called once per request id, from a passive effect.

### 10.4 Managed roots

`managed(Root, options)` returns a component that accepts the root's own props plus the following:

| Prop | Meaning |
| --- | --- |
| `name` | Policy name (typed). Optional, see below. |
| `open` / `defaultOpen` | Intent, controlled or uncontrolled. |
| `onOpenChange(open, ...rest)` | The primitive's own extra arguments are passed through and typed as optional (e.g. Base UI `eventDetails`). |
| `priority` | Reactive priority override. |
| `policy` | Other policy overrides. |
| `onDismiss(reason)` | Scheduler dismissal. |

Which roots are scheduled:

- A root with a `name`, inside a `ModalProvider`, is scheduled.
- A root without a `name`, rendered inside a managed modal, is scheduled under the nearest managed modal's name. It is nested in that modal, so it joins its flow ([§5.4](#54-choosing-the-target)). It gets the policy of that name with `unique: false`, because it is not a second modal of that name.
- Any other root renders the primitive as if it were not wrapped: without a provider, or without a `name` outside any managed modal. `name`, `priority`, `policy` and `onDismiss` are not passed to the primitive, and no `ManagedModalContext` is provided. A named root outside a provider logs one `console.warn` per page.

Switching a root between scheduled and not scheduled remounts the primitive.

A scheduled root receives `open = rootOpen` and a guarded `onOpenChange`. `rootOpen` is `presentation.open`, except that it stays `true` while the modal is `suspended` and a `<ModalActivity>` is registered in its content ([§11.2](#112-content-integration)).

- `next === intent` is ignored. For example, a trigger pressed while the modal is queued.
- `next === false` while the modal is not visible (`presentation.open === false`) is ignored. This is the primitive echoing a close that the scheduler caused, or a primitive whose root stays open behind a `<ModalActivity>` reacting to Escape or an outside press meant for the modal on top (Base UI listens for both at the root).
- Otherwise the user's `onOpenChange` is called first. If a Base UI handler cancelled the change (`eventDetails.isCanceled`), uncontrolled intent is not updated.

Contract towards the application:

- Queued and suspended modals keep intent `true`. `onOpenChange(false)` is **not** called when the scheduler hides a modal.
- On dismissal, `onDismiss(reason)` is called, then `onOpenChange(false)` (uncontrolled intent is also set to false).
- Every scheduled root provides `ManagedModalContext` (`{ requestId, name, kind, presentation, onExitComplete, registerActivity }`) to its subtree. It passes through portals.

### 10.5 SSR and RSC

Every React module starts with `"use client"`. On the server, `useSyncExternalStore` returns `IDLE_PRESENTATION`, so managed modals render closed and open after hydration.

## 11. Adapters and content integration

### 11.1 Adapter contract

```ts
type ModalAdapter = {
  getRootProps?: (modal: ManagedModalContextValue, props: Record<string, unknown>) => Record<string, unknown>;
};
```

The returned props are merged over the user's props, before `open` and `onOpenChange`. An adapter must call the user's own handler it overrides.

| Adapter | Root prop | Reports exit when |
| --- | --- | --- |
| `adapters.baseUi` | `onOpenChangeComplete` | called with `false` |
| `adapters.vaul` | `onAnimationEnd` | called with `false` |
| `adapters.radix` | none | never; `exitTimeoutMs` applies |

### 11.2 Content integration

Keeping a suspended modal's content alive has to happen at the content level: wrapping the whole root would also hide its trigger, which lives on the page.

#### `<ModalActivity>` (React 19.2+)

`<ModalActivity>` wraps the content's portal and renders React's `<Activity>` around it:

1. **Registration.** In a layout effect it registers with the nearest managed modal (`registerActivity(id)`, unregistered on cleanup). While at least one boundary is registered, the root keeps the primitive open while the modal is `suspended` ([§10.4](#104-managed-roots)).
2. **Hiding.** Its mode is `hidden` while the modal is `suspended` or `pending` (queued, including entry-blocked before it was ever shown). Hiding queued content matters for content that renders while its root is closed (`forceMount`, Base UI `keepMounted`, animation libraries driven by the application's `open`). React then hides the content, portals included, with `display: none`, and cleans up its effects: the primitive's focus trap, scroll lock, dismissable layer and `aria-hidden` on the page go away, while state and DOM are kept. When the modal is on screen again, the mode is `visible` and the effects come back, as on open.
3. **Exit.** A hidden boundary has no exit animation. When the modal is suspended, `exit-complete` is dispatched at once for it and for its descendants in `exiting` ([§7](#7-exit-animations-awaitexit)).
4. **Nested modals.** React cleans up the effects of hidden content as if it unmounted, including the registration of a managed modal nested in it. The boundary provides `NestedRequestsContext` to its content. A nested modal whose cleanup runs while the boundary's modal is `suspended` hands its request over to the boundary instead of cancelling it, so it stays registered, suspended with its flow, and keeps counting for the flow's rank. When the content is revealed, nested modals that are still there take their requests back in their registration effects. Right after (the boundary's layout effect runs after its content's), the boundary cancels every request that was not taken back: its modal was removed, or closed by the application, while it was hidden, and React reports neither. The boundary also provides `ActivityStateContext` (`"hidden"`, then `"revealing"` for the commit in which it comes back); while it is not `"visible"`, a nested root whose request is not registered keeps its last `rootOpen`, so its content is not unmounted.
5. **Reveal order.** A nested boundary stays hidden while its parent boundary is `"revealing"`, and is revealed one commit later, still before paint. Primitives such as Radix stack their layers in the order their effects register, and React runs a child's effects before its parent's; revealing both at once would put the parent's layer on top (Escape would close both).
6. **Assistive technology.** While the parent's content effects run on reveal, the nested content's portals are already in the document (hidden). Radix, through `aria-hidden`'s `hideOthers`, marks them as outside the parent, which a normal open never does. When a nested boundary is revealed, it removes that `aria-hidden` from the portals it reveals: the `<body>` children that React hid (`display: none !important`) while the boundary was hidden and that are visible now, when they carry `aria-hidden`'s `data-aria-hidden` marker.

Outside a managed modal, and on React versions without `<Activity>`, it renders its children as they are and does not register.

Scroll positions: the provider remembers the positions of elements scrolled inside dialogs (a capturing `scroll` listener, ignoring elements that are not rendered). When a modal goes from `suspended` back on screen, positions that the browser lost while the content was hidden are put back, in a layout effect and again on the next animation frame. Firefox resets the position of an element with `display: none`; other browsers keep it.

Media keeps playing while hidden. `usePauseWhileSuspended(ref)` pauses a `<video>`/`<audio>` in an effect cleanup (which runs both when the status becomes `suspended` and when a boundary hides the content) and plays it again when the modal is back, if it was playing.

#### `keepMounted` integration (all React versions)

Content components read `useModalPresentation()`, which returns `null` outside a managed modal, and apply:

| Primitive | Keep mounted | Hide while suspended | Suppress final focus | Focus on resume |
| --- | --- | --- | --- | --- |
| Base UI Dialog / AlertDialog / Drawer | `Portal keepMounted={keepMounted}` | automatic (`hidden`) | `Popup finalFocus={false}` | automatic |
| Radix Dialog / AlertDialog (shadcn Dialog, Sheet, AlertDialog) | `Portal forceMount={keepMounted \|\| undefined}` | `Content hidden`; do **not** render the overlay (it holds the scroll lock) | `onCloseAutoFocus` → `preventDefault()` | `useFocusOnResume(contentRef)` |
| vaul | not possible (vaul cannot keep a closed drawer mounted); use `<ModalActivity>` | — | — | — |

Without either integration, scheduling still works, but a suspended modal unmounts its content.

`useFocusOnResume(ref)` tracks the last focused element inside the content. It attaches in a layout effect, so it runs before the primitive's own passive auto-focus. When the status goes from `suspended` to open, it focuses that element again, or the content itself as a fallback, unless focus is already inside.

### 11.3 Custom primitives

Primitives that do not follow `open`/`onOpenChange` use `useManagedModal` directly. They render from `rootOpen` (or `presentation`), provide `contextValue` through `ManagedModalContext`, and call `onExitComplete` when their exit animation ends.

## 12. Invariants

After every action:

1. At most one request is `active`, and `activeRequestId` points to it (or is `null` when none is).
2. The `covered` requests are exactly the ancestors of the active request.
3. Every on-screen request is schedulable.
4. Every candidate's effective priority is ≤ the active request's effective priority, unless the candidate is waiting for its parent. This is the "no pending preemption" property.
5. `entryBlocked` is non-empty only while `exiting` is non-empty, and contains only on-screen requests.
6. `exiting` contains no id that is currently visible.
7. `suspended` implies `hasBeenPresented`.
8. Ordering decisions never depend on `requestedAt` or `now`, except expiry.

## 13. Known limitations and open questions

- **Test environment**: unit tests run in jsdom against React 19.3, and in CI against React 18.3 (skipping `<ModalActivity>`), Radix Dialog 1.1, Base UI 1.8 and vaul 1.1. The Playwright suite (`npm run test:e2e`) covers focus, keyboard, pointer and exit animations in Chromium, Firefox and WebKit, against a fixture app that uses the content integration from the README. Known problems are kept there as expected failures (`test.fail`, `test.fixme`) with the reason.
- **Radix and `awaitExit`**: Radix has no exit callback, so exits complete through `exitTimeoutMs`. A suspended Radix content is hidden immediately and does not animate, yet the timeout still applies to it.
- **vaul**: a suspended drawer keeps its state only with `<ModalActivity>`.
- **`keepMounted` integration on Radix and Escape**: while a resumed dialog plays its enter animation, Escape may be ignored (seen on WebKit on Linux). `<ModalActivity>` does not have this.
- **`<ModalActivity>` and focus**: a resumed dialog is focused as on open (its first field), not on the element that had focus before the suspension.
- **`<ModalActivity>` and animation**: a suspended modal disappears without an exit animation; its enter animation plays again when it comes back.
- **Name changes while open** are ignored ([§10.3](#103-registration)). A development warning could be added.
- **Expiry is lazy** ([§5.1](#51-expiry)). If applications need `onDismiss("expired")` at the exact deadline, the store could schedule a timer for the earliest deadline.
- **Stacking instead of hiding**: preemption currently hides the preempted flow. An alternative mode could keep it open underneath the preemptor, like nesting. It needs verification that independent (non-nested) Radix/Base UI modals stack correctly.
- **One scheduler per provider**: multiple independent "layers" (e.g. toasts-like sheets that may coexist with dialogs) would need several providers or a channel concept.
