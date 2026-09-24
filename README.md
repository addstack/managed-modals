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

### 3. Wrap the root in `components/ui`

Rename the root and add one line:

```diff
 // components/ui/dialog.tsx
+import { adapters } from "@addstack/managed-modals/react";
+import { managed } from "@/lib/modals";

-function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
+function DialogRoot({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
   return <DialogPrimitive.Root data-slot="dialog" {...props} />;
 }
+const Dialog = managed(DialogRoot, { kind: "dialog", adapter: adapters.radix });
```

Do the same in the other files you use:

| File               | Root          | `kind`           | `adapter`                                        |
| ------------------ | ------------- | ---------------- | ------------------------------------------------ |
| `dialog.tsx`       | `Dialog`      | `"dialog"`       | `adapters.radix` (Radix) or `adapters.baseUi` (Base UI) |
| `alert-dialog.tsx` | `AlertDialog` | `"alert-dialog"` | `adapters.radix` or `adapters.baseUi`            |
| `sheet.tsx`        | `Sheet`       | `"sheet"`        | `adapters.radix` or `adapters.baseUi`            |
| `drawer.tsx`       | `Drawer`      | `"drawer"`       | `adapters.vaul` (vaul) or `adapters.baseUi` (Base UI) |

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

**Next steps:** keep a preempted modal's state (forms, scroll, a playing video) with [one more line in `DialogContent`](#-keeping-a-suspended-modals-state), or serialize exit animations with [`awaitExit`](#-waiting-for-exit-animations-awaitexit).

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

When a modal is preempted, its content has to stay alive to keep form state, scroll position or a playing video. On React 19.2+, wrap the portal in your content component with `<ModalActivity>`:

```diff
 // components/ui/dialog.tsx
+import { ModalActivity } from "@addstack/managed-modals/react";

 function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
   return (
+    <ModalActivity>
       <DialogPortal data-slot="dialog-portal">
         <DialogOverlay />
         <DialogPrimitive.Content data-slot="dialog-content" className={cn(/* … */, className)} {...props}>
           {children}
         </DialogPrimitive.Content>
       </DialogPortal>
+    </ModalActivity>
   );
 }
```

The same line works in `alert-dialog.tsx`, `sheet.tsx` and `drawer.tsx`, on Radix, Base UI and vaul. Nested modals, such as a dialog inside a drawer, are hidden and brought back with their flow, and stay known to the scheduler meanwhile. While the modal is suspended, React's [`<Activity>`](https://react.dev/reference/react/Activity) hides the content and cleans up its effects (focus trap, scroll lock, `aria-hidden` on the page) but keeps its state and DOM. When the modal comes back, it is shown again as it was, with focus on its first field, as when it opens. Outside a managed modal, `<ModalActivity>` renders its children as they are.

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

Without `<ModalActivity>` everything still works: a suspended modal unmounts its content, and local state is lost unless you lift it.

<details>
<summary><b>React 18 – 19.1:</b> the <code>keepMounted</code> integration</summary>

`<Activity>` needs React 19.2. On older versions, `<ModalActivity>` does nothing, and each primitive keeps its content mounted at the content level instead. `useModalPresentation()` returns `null` outside a managed modal, so the same component keeps working for unmanaged dialogs. vaul has no way to keep a closed drawer mounted, so a suspended vaul drawer loses its state here.

##### Base UI (shadcn `dialog.tsx`)

```tsx
import { useModalPresentation } from "@addstack/managed-modals/react";

function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  const managed = useModalPresentation();
  return (
    <DialogPortal keepMounted={managed?.keepMounted}>
      <DialogOverlay />
      <DialogPrimitive.Popup
        // A scheduler switch is not a real close: don't send focus back to the trigger.
        finalFocus={managed?.suppressFinalFocus ? false : undefined}
        className={cn(/* … */, className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}
```

The same applies to Base UI `AlertDialog` and `Drawer`.

##### Radix (shadcn `dialog.tsx`, also `sheet.tsx` and `alert-dialog.tsx`)

```tsx
import { useFocusOnResume, useModalPresentation } from "@addstack/managed-modals/react";

function DialogContent({ className, children, onCloseAutoFocus, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const managed = useModalPresentation();
  const suspended = managed?.status === "suspended";
  const contentRef = React.useRef<HTMLDivElement>(null);
  // Radix auto-focuses only on mount; bring focus back when a kept-mounted dialog resumes.
  useFocusOnResume(contentRef);

  return (
    <DialogPortal forceMount={managed?.keepMounted || undefined}>
      {/* The overlay locks scrolling; don't keep it while suspended. */}
      {!suspended && <DialogOverlay />}
      <DialogPrimitive.Content
        ref={contentRef}
        hidden={suspended || undefined}
        onCloseAutoFocus={(event) => {
          if (managed?.suppressFinalFocus) event.preventDefault();
          onCloseAutoFocus?.(event);
        }}
        className={cn(/* … */, className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
```

> [!WARNING]
> On Tailwind v4 the preflight hides `[hidden]` even on `grid`/`flex` elements. On Tailwind v3, also add the `hidden` class while `suspended`.

</details>

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

`modal.rootOpen` is the value for your primitive's `open` prop: it stays `true` while the modal is suspended behind a `<ModalActivity>`. `modal.presentation` is `{ status, open, keepMounted, suppressFinalFocus, dismissReason? }`. `status` is one of `idle`, `pending`, `active`, `covered` (on screen under a nested child), `suspended` or `dismissed`.

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

## 📝 Notes

- **SSR / RSC.** The React entry is marked `"use client"`, and so should be `lib/modals.ts`: `createManagedModals()` runs on the client. Managed modals render closed on the server and open after hydration.
- **Strict Mode.** Double-invoked effects are handled. A nested modal may register before its parent (React runs child effects first); it waits for the parent instead of failing.
- **Scroll.** Scroll positions inside a suspended dialog are kept. Firefox resets them while the content is hidden; they are put back when the modal comes back.
- **Focus.** With `<ModalActivity>`, a resumed dialog gets focus the way it does when it opens (its first field), and a resumed nested flow focuses the nested dialog on top. With the `keepMounted` integration, Base UI does the same by itself, and on Radix `useFocusOnResume` restores the element that had focus before the suspension.
- **Playground.** `npm run playground` runs the [playground](https://addstack.github.io/managed-modals/) against your local `src/`.
- **Tested with** React 19.3 and, for everything but `<ModalActivity>`, React 18.3, `@radix-ui/react-dialog` 1.1, `@base-ui/react` 1.8 and vaul 1.1, in jsdom, and in Chromium, Firefox and WebKit with Playwright for focus, keyboard, pointer, exit animations and media playback.

## 📄 License

MIT
