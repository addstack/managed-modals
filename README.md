# managed-modals

Priority scheduling for dialogs and drawers in React. Works with the Dialog and Drawer components you already have: shadcn/ui on Radix or Base UI, and vaul.

Apps pile up independent modals: session expired, billing problem, "new version available", onboarding, confirmations. Each one is correct on its own. Together they open over each other, fight over focus, and show onboarding on top of a payment form. `managed-modals` makes each modal a *request* and puts one scheduler in charge:

- **One flow on screen.** Other modals wait in a priority queue.
- **Preemption with resume.** A strictly higher priority takes over. The modal it replaces is hidden (with its state kept, where the primitive allows) and comes back afterwards.
- **Nested flows.** A modal opened from inside another modal (e.g. "Really delete?" inside "Edit user") stacks on top of its parent, the way Radix and Base UI nest natively.
- **Policies** per modal name: priority, what happens when preempted or blocked, maximum waiting time, deduplication.
- **Optional serialized transitions.** With `awaitExit`, the next modal opens only after the previous one finished its exit animation.
- **No dependency on any UI library.** The core is framework-agnostic. The React bindings wrap any root component that has `open` and `onOpenChange`.

```bash
npm install @addstack/managed-modals
```

The exact scheduling model is described in [docs/specification.md](docs/specification.md).

## Quick start (shadcn/ui)

Declare the policies once:

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

Render the provider once:

```tsx
<ModalProvider>
  <App />
</ModalProvider>
```

Wrap the root in your `components/ui` files. Rename it and add one line:

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

Do the same for `AlertDialog` (`kind: "alert-dialog"`), `Sheet` (`"sheet"`) and `Drawer` (`"drawer"`). The adapter is `adapters.radix` for Radix, `adapters.baseUi` for Base UI and `adapters.vaul` for the vaul Drawer. Imports in the rest of the app stay the same.

Then give a `name` to each modal the scheduler should manage:

```tsx
<Dialog name="billing-problem" open={hasBillingProblem} onOpenChange={setHasBillingProblem}>
  <DialogContent>
    <DialogTitle>Payment failed</DialogTitle>
  </DialogContent>
</Dialog>
```

`name` is typed from `policies`, so a typo is a compile error. Controlled (`open`/`onOpenChange`) and uncontrolled (`defaultOpen`, `DialogTrigger`) usage both work.

A dialog **without a `name`** is left alone:

- On its own, it is the plain primitive. It is not scheduled, so a managed modal can open on top of it.
- Inside a managed modal, it joins that modal's flow: it opens on top of it, and it is hidden and brought back with it.
- Outside `<ModalProvider>` (Storybook, component tests), every dialog is the plain primitive. A named one logs a warning.

### What `open` means now

`open` is **intent**: "this modal wants to be open". The scheduler decides when it is actually shown.

- A modal that is queued or suspended keeps `open === true` in your state. `onOpenChange(false)` is **not** called when the scheduler hides it.
- `onOpenChange(false)` is called when the user closes the modal, or when the scheduler **dismisses** it for good (see `onPreempt`, `whenBlocked`, `maxWaitMs`, `unique`). `onDismiss(reason)` is called right before, so you can tell the two apart.

## Scheduling rules

1. With nothing on screen, the best waiting modal is shown.
2. Only a **strictly higher** priority takes over the screen. Equal or lower priority waits, so equal priorities never thrash.
3. Ties are broken by, in order:
   1. the flow already on screen;
   2. a flow that was shown before (resume before starting something new);
   3. the most recently suspended flow first;
   4. first come, first served.

   Ordering uses a logical clock, never timestamps.
4. A modal rendered inside another managed modal is **nested**. It opens on top right away, whatever its own priority, and its effective priority is at least its parent's. The parent stays open underneath, which is the native nesting behaviour of Radix, Base UI and vaul.
5. Preempting a nested flow hides the whole flow. The flow resumes where it was, with the child on top.
6. Closing a modal closes its nested modals.
7. `priority` is reactive: changing it can reorder the queue or preempt without creating a new request.

## Policies

| Field         | Default     | Meaning                                                                                 |
| ------------- | ----------- | --------------------------------------------------------------------------------------- |
| `priority`    | required    | Higher wins.                                                                            |
| `onPreempt`   | `"suspend"` | `"suspend"` hides the modal and brings it back later. `"dismiss"` closes it for good.   |
| `whenBlocked` | `"wait"`    | `"wait"` queues the modal. `"dismiss"` drops it if it cannot open right away (good for user-triggered UI such as a command palette). |
| `maxWaitMs`   | none        | Drop a queued modal that has not been shown within this time, e.g. a stale "new version" prompt. |
| `unique`      | `false`     | Drop a request whose name is already open or queued.                                     |

An instance can override the policy with `priority={95}` (reactive) or `policy={{ onPreempt: "dismiss" }}`.

## Keeping a suspended modal's state

When a modal is preempted, its content must stay mounted to keep form state and scroll position. The primitives support this at the *content* level, so add a few lines to your `components/ui/*.tsx`. `useModalPresentation()` returns `null` outside a managed modal, so the same component keeps working for unmanaged dialogs.

### Base UI (shadcn `dialog.tsx`)

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

### Radix (shadcn `dialog.tsx`, also `sheet.tsx` and `alert-dialog.tsx`)

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

On Tailwind v4 the preflight hides `[hidden]` even on `grid`/`flex` elements. On Tailwind v3, also add the `hidden` class while `suspended`.

Without these changes everything still works. A suspended modal just unmounts its content, and local state is lost unless you lift it.

## Waiting for exit animations (`awaitExit`)

```ts
createManagedModals({ policies, awaitExit: true, exitTimeoutMs: 300 });
```

With `awaitExit`, a modal that leaves the screen must finish its exit animation before a *different* modal opens. Nested modals are not delayed. The adapter reports the end of the animation:

- `adapters.baseUi` uses `onOpenChangeComplete` (Base UI Dialog, AlertDialog, Drawer);
- `adapters.vaul` uses `onAnimationEnd`;
- Radix has no such callback, so `exitTimeoutMs` is used. Set it to your animation duration (shadcn uses 200ms).

`exitTimeoutMs` (default 1000) is also the fallback if a report never arrives. For custom primitives, call `onExitComplete()` from `useManagedModalContext()`.

## Custom primitives: `useManagedModal`

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

`modal.presentation` is `{ status, open, keepMounted, suppressFinalFocus, dismissReason? }`. `status` is one of `idle`, `pending`, `active`, `covered` (on screen under a nested child), `suspended` or `dismissed`.

## Core (no React)

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

## Debugging

```tsx
const { useModalSchedulerState } = createManagedModals({ policies });

function ModalDebugger() {
  const state = useModalSchedulerState();
  return <pre>{JSON.stringify(getDebugSnapshot(state), null, 2)}</pre>;
}
```

## Notes

- **SSR / RSC.** The React entry is marked `"use client"`. Managed modals render closed on the server and open after hydration.
- **Strict Mode.** Double-invoked effects are handled. A nested modal may register before its parent (React runs child effects first); it waits for the parent instead of failing.
- **Focus.** Base UI moves focus back into a resumed dialog by itself. For Radix, use `useFocusOnResume` as shown above: it restores the element that had focus before the suspension.
- **Tested with** React 18.3 and 19.3, `@radix-ui/react-dialog` 1.1, `@base-ui/react` 1.8 and vaul 1.1, in jsdom, and in Chromium, Firefox and WebKit with Playwright for focus, keyboard, pointer and exit animations.

## License

MIT
