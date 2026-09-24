<p align="center">
  <img src="https://raw.githubusercontent.com/addstack/managed-modals/main/assets/banner.png" alt="managed-modals" width="100%">
</p>

<p align="center">
  <b>Priority scheduling for dialogs and drawers in React.</b><br>
  One modal on screen, a queue for the rest. Works with the shadcn/ui components you already have.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@addstack/managed-modals"><img src="https://img.shields.io/npm/v/@addstack/managed-modals" alt="npm"></a>
  <a href="https://github.com/addstack/managed-modals/actions/workflows/ci.yml"><img src="https://github.com/addstack/managed-modals/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/addstack/managed-modals/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@addstack/managed-modals" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="https://addstack.github.io/managed-modals/">Playground</a> ·
  <a href="#-how-it-works">How it works</a> ·
  <a href="#-policies">Policies</a> ·
  <a href="#-guides">Guides</a> ·
  <a href="https://github.com/addstack/managed-modals/blob/main/docs/specification.md">Specification</a>
</p>

---

<p align="center">
  <a href="https://addstack.github.io/managed-modals/">
    <img src="https://raw.githubusercontent.com/addstack/managed-modals/main/assets/demo.gif" alt="A session-expired dialog takes over an edit form; after signing in the form comes back as it was, then a queued dialog opens" width="100%">
  </a>
</p>

<p align="center">
  🎮 <a href="https://addstack.github.io/managed-modals/"><b>Try it in the playground</b></a>: fire events, watch the queue, and switch the scheduler off to see the mess it prevents.
</p>

Apps pile up independent modals: session expired, billing problem, "new version available", onboarding, confirmations. Each one is correct on its own. Together they open over each other, fight over focus, and show onboarding on top of a payment form. `managed-modals` makes each modal a *request* and puts one scheduler in charge:

- 🎯 **One flow on screen.** Other modals wait in a priority queue.
- ⏸️ **Preemption with resume.** A strictly higher priority takes over. The modal it replaces is hidden (with its state kept, where the primitive allows) and comes back afterwards.
- 🪆 **Nested flows.** A modal opened from inside another modal (e.g. "Really delete?" inside "Edit user") stacks on top of its parent, the way Radix and Base UI nest natively.
- 📋 **Policies** per modal name: priority, what happens when preempted or blocked, maximum waiting time, deduplication.
- 🎬 **Optional serialized transitions.** With `awaitExit`, the next modal opens only after the previous one finished its exit animation.
- 🧩 **No dependency on any UI library.** Radix, Base UI and vaul are supported through small adapters. The core is framework-agnostic.

## 🚀 Quick start

> [!TIP]
> With shadcn/ui you only touch `lib/modals.ts` and the files in `components/ui`. Every `import { Dialog } from "@/components/ui/dialog"` in your app stays as it is.

### 1. Install

```bash
npm install @addstack/managed-modals
```

Requires React 19.2 or later (it builds on [`<Activity>`](https://react.dev/reference/react/Activity)).

### 2. Declare your modals and render the provider

```tsx
// lib/modals.ts
"use client";
import { createManagedModals } from "@addstack/managed-modals/react";

export const { ModalProvider, managed } = createManagedModals({
  policies: {
    "session-expired": { priority: 100 },
    "billing-problem": { priority: 80 },
    "new-version": { priority: 50, maxWaitMs: 60_000 },
    "command-palette": { priority: 20, whenBlocked: "dismiss" },
    onboarding: { priority: 10, onPreempt: "dismiss" },
  },
});
```

```tsx
// once, near the root of the app (e.g. app/layout.tsx)
<ModalProvider>
  <App />
</ModalProvider>
```

### 3. Wrap the primitive in `components/ui`

One change per file: wrap what the file imports from the primitive library. The rest of the file stays as it is.

```diff
 // components/ui/dialog.tsx
-import { Dialog as DialogPrimitive } from "radix-ui"
+import { Dialog as RadixDialog } from "radix-ui"
+import { adapters } from "@addstack/managed-modals/react"
+import { managed } from "@/lib/modals"
+
+const DialogPrimitive = managed(RadixDialog, { kind: "dialog", adapter: adapters.radix })
```

`managed()` replaces two parts, and leaves every other one as the library's own:

- `Root` becomes managed, so `Dialog` takes a `name`;
- `Portal` keeps the content alive while another modal takes over: form fields, scroll positions and a playing video are still there when the dialog comes back.

Do the same in the other files you use:

| File               | Wrap                                          | `kind`           | `adapter`        |
| ------------------ | --------------------------------------------- | ---------------- | ---------------- |
| `dialog.tsx`       | `Dialog` from `radix-ui`                      | `"dialog"`       | `adapters.radix` |
| `alert-dialog.tsx` | `AlertDialog` from `radix-ui`                 | `"alert-dialog"` | `adapters.radix` |
| `sheet.tsx`        | `Dialog` from `radix-ui` (`SheetPrimitive`)   | `"sheet"`        | `adapters.radix` |
| `drawer.tsx`       | `Drawer` from `vaul` (`DrawerPrimitive`)      | `"drawer"`       | `adapters.vaul`  |

> [!TIP]
> Older shadcn/ui files import `* as DialogPrimitive from "@radix-ui/react-dialog"`. Rename that import the same way: `import * as RadixDialog from "@radix-ui/react-dialog"`.

<details>
<summary><b>shadcn/ui on Base UI</b></summary>

Base UI's files type their props with `DialogPrimitive.Root.Props`, which needs the import itself. Keep it, give the managed parts their own name, and use them where the root and the portal are rendered:

```diff
 // components/ui/dialog.tsx
 import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
+import { adapters } from "@addstack/managed-modals/react"
+import { managed } from "@/lib/modals"
+
+const ManagedDialog = managed(DialogPrimitive, { kind: "dialog", adapter: adapters.baseUi })

-function Dialog({ ...props }: DialogPrimitive.Root.Props) {
-  return <DialogPrimitive.Root data-slot="dialog" {...props} />
+function Dialog({ ...props }: React.ComponentProps<typeof ManagedDialog.Root>) {
+  return <ManagedDialog.Root data-slot="dialog" {...props} />
 }

 function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
-  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
+  return <ManagedDialog.Portal data-slot="dialog-portal" {...props} />
 }
```

The same goes for `alert-dialog.tsx`, `sheet.tsx` and `drawer.tsx`, all with `adapters.baseUi`.

</details>

### 4. Name the modals the scheduler should manage

```tsx
<Dialog name="billing-problem" open={hasBillingProblem} onOpenChange={setHasBillingProblem}>
  <DialogContent>
    <DialogTitle>Payment failed</DialogTitle>
  </DialogContent>
</Dialog>
```

✅ **That's it.** `name` is typed from `policies`, so a typo is a compile error. Controlled (`open`/`onOpenChange`) and uncontrolled (`defaultOpen`, `DialogTrigger`) usage both work.

> [!NOTE]
> A dialog **without a `name`** is left alone:
>
> - On its own, it is the plain primitive. It is not scheduled, so a managed modal can open on top of it.
> - Inside a managed modal, it joins that modal's flow: it opens on top of it, and it is hidden and brought back with it.
> - Outside `<ModalProvider>` (Storybook, component tests), every dialog is the plain primitive. A named one logs a warning.

> [!IMPORTANT]
> `open` now means **intent**: "this modal wants to be open". The scheduler decides when it is actually shown.
>
> - A modal that is queued or suspended keeps `open === true` in your state. `onOpenChange(false)` is **not** called when the scheduler hides it.
> - `onOpenChange(false)` is called when the user closes the modal, or when the scheduler **dismisses** it for good (see `onPreempt`, `whenBlocked`, `maxWaitMs`, `unique`). `onDismiss(reason)` is called right before, so you can tell the two apart.

**Next steps:** see [what a suspended modal keeps](#-keeping-a-suspended-modals-state) (and how to pause a video), or serialize exit animations with [`awaitExit`](#-waiting-for-exit-animations-awaitexit).

---

## 🧠 How it works

1. With nothing on screen, the best waiting modal is shown.
2. Only a **strictly higher** priority takes over the screen. Equal or lower priority waits, so equal priorities never thrash.
3. Ties are broken by, in order:
   1. the flow already on screen;
   2. a flow that was shown before (resume before starting something new);
   3. the most recently suspended flow first;
   4. first come, first served.

   Ordering uses a logical clock, never timestamps.
4. A modal rendered inside another managed modal is **nested**, with or without its own `name`. It opens on top right away, whatever its own priority, and its effective priority is at least its parent's. The parent stays open underneath, which is the native nesting behaviour of Radix, Base UI and vaul.
5. Preempting a nested flow hides the whole flow. The flow resumes where it was, with the child on top.
6. Closing a modal closes its nested modals.
7. `priority` is reactive: changing it can reorder the queue or preempt without creating a new request.

The exact model is described in the [specification](https://github.com/addstack/managed-modals/blob/main/docs/specification.md).

## 🚦 Policies

| Field         | Default     | Meaning                                                                                 |
| ------------- | ----------- | --------------------------------------------------------------------------------------- |
| `priority`    | required    | Higher wins.                                                                            |
| `onPreempt`   | `"suspend"` | `"suspend"` hides the modal and brings it back later. `"dismiss"` closes it for good.   |
| `whenBlocked` | `"wait"`    | `"wait"` queues the modal. `"dismiss"` drops it if it cannot open right away (good for user-triggered UI such as a command palette). |
| `maxWaitMs`   | none        | Drop a queued modal that has not been shown within this time, e.g. a stale "new version" prompt. |
| `unique`      | `false`     | Drop a request whose name is already open or queued.                                     |

An instance can override the policy with `priority={95}` (reactive) or `policy={{ onPreempt: "dismiss" }}`.

## 📚 Guides

### 💾 Keeping a suspended modal's state

When a modal is preempted, its content has to stay alive to keep form state, scroll position or a playing video. The managed `Portal` from the [quick start](#3-wrap-the-primitive-in-componentsui) takes care of it: it renders the library's portal inside `<ModalActivity>`. It works on Radix, Base UI and vaul.

While the modal is suspended, React's [`<Activity>`](https://react.dev/reference/react/Activity) hides the content and cleans up its effects (focus trap, scroll lock, `aria-hidden` on the page) but keeps its state and DOM. When the modal comes back, it is shown again as it was, with focus on its first field, as when it opens. Nested modals, such as a dialog inside a drawer, are hidden and brought back with their flow, and stay known to the scheduler meanwhile. Outside a managed modal, `<ModalActivity>` renders its children as they are.

It also hides the content of a modal that is waiting in the queue. Content that renders while its root is closed therefore waits its turn too: Radix `forceMount`, Base UI `keepMounted`, or an animation library such as Motion driven by your own `open` state.

> [!TIP]
> Hidden media keeps playing, and is heard. Add `usePauseWhileSuspended` to your video or audio component: it pauses while the modal is suspended and plays on from the same point when it comes back, if it was playing.
>
> ```tsx
> function Video(props: React.ComponentProps<"video">) {
>   const ref = React.useRef<HTMLVideoElement>(null);
>   usePauseWhileSuspended(ref);
>   return <video ref={ref} {...props} />;
> }
> ```

`managed()` also takes a root component alone, e.g. `managed(DialogPrimitive.Root, options)`, for primitives without a `Portal` part. Put `<ModalActivity>` around the content's portal yourself then. Without it everything still works: a suspended modal unmounts its content, and local state is lost unless you lift it.

### 🎬 Waiting for exit animations (`awaitExit`)

```ts
createManagedModals({ policies, awaitExit: true, exitTimeoutMs: 300 });
```

With `awaitExit`, a modal that leaves the screen must finish its exit animation before a *different* modal opens. Nested modals are not delayed. The adapter reports the end of the animation:

- `adapters.baseUi` uses `onOpenChangeComplete` (Base UI Dialog, AlertDialog, Drawer);
- `adapters.vaul` uses `onAnimationEnd`;
- Radix has no such callback, so `exitTimeoutMs` is used.

> [!NOTE]
> With Radix, set `exitTimeoutMs` to your animation duration (shadcn uses 200ms).

`exitTimeoutMs` (default 1000) is also the fallback if a report never arrives. For custom primitives, call `onExitComplete()` from `useManagedModalContext()`.

### 🧩 Custom primitives: `useManagedModal`

`managed()` is a thin wrapper over a hook you can use directly:

```tsx
const { useManagedModal } = createManagedModals({ policies });

function MyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const modal = useManagedModal({ name: "onboarding", open, onDismiss: onClose });
  return (
    <ManagedModalContext.Provider value={modal.contextValue}>
      {modal.presentation.open && <MyOverlay onClose={onClose} />}
    </ManagedModalContext.Provider>
  );
}
```

`modal.rootOpen` is the value for your primitive's `open` prop: it stays `true` while the modal is suspended behind a `<ModalActivity>`. `modal.presentation` is `{ status, open, dismissReason? }`. `status` is one of `idle`, `pending`, `active`, `covered` (on screen under a nested child), `suspended` or `dismissed`.

### 🔧 Core (no React)

```ts
import { createModalManager, getDebugSnapshot } from "@addstack/managed-modals";

const manager = createModalManager({ policies: { alert: { priority: 10 } } });
const store = manager.createStore();

store.subscribe(() => console.table(getDebugSnapshot(store.getSnapshot())));
store.request({ requestId: "r1", instanceId: "i1", name: "alert" });
store.getPresentation("r1"); // { status: "active", open: true, … }
store.cancel("r1");
```

The scheduler itself is a pure reducer (`modalSchedulerReducer`) with actions `request`, `cancel`, `update-priority` and `exit-complete`. `store.subscribe`/`store.getSnapshot` match React's `useSyncExternalStore`, and `store.getPresentation(id)` is referentially stable while nothing relevant changes.

### 🐞 Debugging

```tsx
const { useModalSchedulerState } = createManagedModals({ policies });

function ModalDebugger() {
  const state = useModalSchedulerState();
  return <pre>{JSON.stringify(getDebugSnapshot(state), null, 2)}</pre>;
}
```

## ⬆️ Upgrading

### From 2.0

The 2.0 setup, `managed()` on the root plus `<ModalActivity>` around the portal, keeps working. To simplify a file, undo both and wrap the import instead, as in the [quick start](#3-wrap-the-primitive-in-componentsui).

### From 1.x

- React 19.2 or later is required.
- The `keepMounted` content integration is gone. In each content component (`DialogContent`, `AlertDialogContent`, `SheetContent`, `DrawerContent`), remove what it added (`useModalPresentation()`, `forceMount`/`keepMounted` on the portal, `hidden`, the overlay condition, `onCloseAutoFocus`/`finalFocus`, `useFocusOnResume`). Then wrap the file's import, as in the [quick start](#3-wrap-the-primitive-in-componentsui).
- `useFocusOnResume` is removed, and `useModalPresentation()` returns `{ status, open, dismissReason? }` (no `keepMounted`, no `suppressFinalFocus`).

## 📝 Notes

- **SSR / RSC.** The React entry is marked `"use client"`, and so should be `lib/modals.ts`: `createManagedModals()` runs on the client. Managed modals render closed on the server and open after hydration.
- **Strict Mode.** Double-invoked effects are handled. A nested modal may register before its parent (React runs child effects first); it waits for the parent instead of failing.
- **Scroll.** Scroll positions inside a suspended dialog are kept. Firefox resets them while the content is hidden; they are put back when the modal comes back.
- **Focus.** A resumed dialog gets focus the way it does when it opens (its first field), and a resumed nested flow focuses the nested dialog on top.
- **Playground.** `npm run playground` runs the [playground](https://addstack.github.io/managed-modals/) against your local `src/`.
- **Tested with** React 19.3, `@radix-ui/react-dialog` 1.1, `@base-ui/react` 1.8 and vaul 1.1, in jsdom, and in Chromium, Firefox and WebKit with Playwright for focus, keyboard, pointer, exit animations and media playback.

## 📄 License

MIT
