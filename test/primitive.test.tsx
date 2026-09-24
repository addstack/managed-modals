// @vitest-environment jsdom
import { Dialog as BaseDialogPrimitive } from "@base-ui/react/dialog";
import * as RadixDialogModule from "@radix-ui/react-dialog";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { memo, useState, type ComponentProps, type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { adapters, createManagedModals } from "../src/react/index.js";
import { AlertDialog as RadixAlertDialog, Dialog as RadixDialog } from "./fixtures/radix-ui.js";

// managed() on a primitive's parts, as the README shows it for the shadcn/ui
// files: the import is wrapped, and nothing else in the file changes.

beforeAll(() => {
  // vaul reads these; jsdom does not implement them.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(cleanup);

const modals = createManagedModals({
  policies: {
    "session-expired": { priority: 100 },
    "edit-user": { priority: 40 },
    filters: { priority: 30 },
  },
});

// --- components/ui/dialog.tsx (shadcn/ui on Radix), with the README's change ---------

const DialogPrimitive = modals.managed(RadixDialog, { kind: "dialog", adapter: adapters.radix });

function Dialog({ ...props }: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogContent({ children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogPrimitive.Overlay data-slot="dialog-overlay" />
      <DialogPrimitive.Content data-slot="dialog-content" aria-describedby={undefined} {...props}>
        {children}
        <DialogPrimitive.Close>Close</DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogTitle({ ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" {...props} />;
}

// --- components/ui/drawer.tsx (shadcn/ui on vaul), with the README's change ----------

const DrawerPrimitive = modals.managed(VaulDrawer, { kind: "drawer", adapter: adapters.vaul });

function Drawer({ ...props }: ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerContent({ children, ...props }: ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal data-slot="drawer-portal">
      <DrawerPrimitive.Overlay data-slot="drawer-overlay" />
      <DrawerPrimitive.Content data-slot="drawer-content" aria-describedby={undefined} {...props}>
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}

// --- components/ui/dialog.tsx (shadcn/ui on Base UI), with the README's change -------
// Base UI's shadcn/ui files type props with `DialogPrimitive.X.Props`, so the
// import keeps its name and the managed parts get their own.

const ManagedBaseDialog = modals.managed(BaseDialogPrimitive, { kind: "dialog", adapter: adapters.baseUi });

function BaseDialog({ ...props }: ComponentProps<typeof ManagedBaseDialog.Root>) {
  return <ManagedBaseDialog.Root data-slot="dialog" {...props} />;
}

function BaseDialogPortal({ ...props }: BaseDialogPrimitive.Portal.Props) {
  return <ManagedBaseDialog.Portal data-slot="dialog-portal" {...props} />;
}

function BaseDialogContent({ children, ...props }: BaseDialogPrimitive.Popup.Props) {
  return (
    <BaseDialogPortal>
      <BaseDialogPrimitive.Backdrop data-slot="dialog-overlay" />
      <BaseDialogPrimitive.Popup data-slot="dialog-content" {...props}>
        {children}
        <BaseDialogPrimitive.Close>Close</BaseDialogPrimitive.Close>
      </BaseDialogPrimitive.Popup>
    </BaseDialogPortal>
  );
}

// ---------------------------------------------------------------------------------------

/** Dialogs a user can see: `<Activity>` hides with `display: none`. */
function visibleDialogs(): string[] {
  return screen
    .queryAllByRole("dialog", { hidden: true })
    .filter((dialog) => !dialog.closest('[hidden], [style*="display: none"]'))
    .map((dialog) => dialog.querySelector("h2")?.textContent ?? "?");
}

function isHidden(element: Element): boolean {
  return element.closest('[hidden], [style*="display: none"]') !== null;
}

function SessionExpired({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog name="session-expired" open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Session expired</DialogTitle>
      </DialogContent>
    </Dialog>
  );
}

describe("managed(parts)", () => {
  test("Radix: a preempted dialog is hidden and comes back with its fields, and its trigger stays on the page", async () => {
    let setSession!: (open: boolean) => void;
    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <modals.ModalProvider>
          <Dialog name="edit-user">
            <DialogTrigger>Open editor</DialogTrigger>
            <DialogContent>
              <DialogTitle>Edit user</DialogTitle>
              <input aria-label="Name" />
            </DialogContent>
          </Dialog>
          <SessionExpired open={session} onOpenChange={setSessionState} />
        </modals.ModalProvider>
      );
    }

    render(<App />);
    fireEvent.click(screen.getByText("Open editor"));
    expect(visibleDialogs()).toEqual(["Edit user"]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });

    act(() => setSession(true));
    expect(visibleDialogs()).toEqual(["Session expired"]);
    // Only the content is hidden: what the root renders on the page is not.
    expect(isHidden(screen.getByText("Open editor"))).toBe(false);

    act(() => setSession(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ada");

    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(visibleDialogs()).toEqual([]));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Open editor")));
  });

  test("vaul: a dialog inside a drawer comes back on top of it, with its state", async () => {
    let setSession!: (open: boolean) => void;
    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <modals.ModalProvider>
          <Drawer name="filters" defaultOpen>
            <DrawerContent>
              <DrawerPrimitive.Title>Filters</DrawerPrimitive.Title>
              <Dialog defaultOpen>
                <DialogContent>
                  <DialogTitle>Save filter</DialogTitle>
                  <input aria-label="Filter name" />
                </DialogContent>
              </Dialog>
            </DrawerContent>
          </Drawer>
          <SessionExpired open={session} onOpenChange={setSessionState} />
        </modals.ModalProvider>
      );
    }

    render(<App />);
    expect(visibleDialogs()).toEqual(["Filters", "Save filter"]);
    fireEvent.change(screen.getByLabelText("Filter name"), { target: { value: "Red" } });

    act(() => setSession(true));
    expect(visibleDialogs()).toEqual(["Session expired"]);
    act(() => setSession(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Filters", "Save filter"]));
    expect(screen.getByLabelText<HTMLInputElement>("Filter name").value).toBe("Red");
  });

  test("Base UI: a dialog opened from a detached trigger is preempted and comes back with its payload and fields", async () => {
    const handle = BaseDialogPrimitive.createHandle<{ name: string }>();
    let setSession!: (open: boolean) => void;
    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <modals.ModalProvider>
          <BaseDialogPrimitive.Trigger handle={handle} payload={{ name: "Grace" }}>
            Edit Grace
          </BaseDialogPrimitive.Trigger>
          <BaseDialog name="edit-user" handle={handle}>
            {({ payload }) => (
              <BaseDialogContent>
                {/* As with shadcn/ui's `Dialog`, typed with `DialogPrimitive.Root.Props`: the payload is `unknown`. */}
                <BaseDialogPrimitive.Title>Edit {(payload as { name: string } | undefined)?.name}</BaseDialogPrimitive.Title>
                <input aria-label="Note" />
              </BaseDialogContent>
            )}
          </BaseDialog>
          <SessionExpired open={session} onOpenChange={setSessionState} />
        </modals.ModalProvider>
      );
    }

    render(<App />);
    fireEvent.click(screen.getByText("Edit Grace"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit Grace"]));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "promote" } });

    act(() => setSession(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));
    act(() => setSession(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit Grace"]));
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("promote");
  });

  test("only Root and Portal are replaced; every other part is the library's own", () => {
    const parts = [
      [RadixDialog, DialogPrimitive],
      [RadixAlertDialog, modals.managed(RadixAlertDialog, { kind: "alert-dialog", adapter: adapters.radix })],
      [RadixDialogModule, modals.managed(RadixDialogModule, { kind: "dialog", adapter: adapters.radix })],
      [BaseDialogPrimitive, ManagedBaseDialog],
      [VaulDrawer, DrawerPrimitive],
    ] as [Record<string, unknown>, Record<string, unknown>][];

    for (const [original, managed] of parts) {
      expect(Object.keys(managed).sort()).toEqual(Object.keys(original).sort());
      for (const key of Object.keys(original)) {
        if (key === "Root" || key === "Portal") expect(managed[key], key).not.toBe(original[key]);
        else expect(managed[key], key).toBe(original[key]);
      }
    }
  });

  test("outside <ModalProvider> the parts behave as the library's own", async () => {
    const warn = vi.spyOn(console, "warn");
    render(
      <Dialog>
        <DialogTrigger>Open editor</DialogTrigger>
        <DialogContent>
          <DialogTitle>Edit user</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByText("Open editor"));
    expect(visibleDialogs()).toEqual(["Edit user"]);
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(visibleDialogs()).toEqual([]));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("a root component is still wrapped as a root, memo and forwardRef ones included", () => {
    const MemoRoot = memo(RadixDialog.Root);
    const Root = modals.managed(MemoRoot, { kind: "dialog", adapter: adapters.radix });
    render(
      <modals.ModalProvider>
        <Root name="edit-user" defaultOpen>
          <DialogContent>
            <DialogTitle>Edit user</DialogTitle>
          </DialogContent>
        </Root>
      </modals.ModalProvider>,
    );
    expect(visibleDialogs()).toEqual(["Edit user"]);
  });

  test("names are typed from the policies", () => {
    const children: ReactNode = null;
    // @ts-expect-error "typo" is not a configured modal name
    void (<Dialog name="typo">{children}</Dialog>);
    // @ts-expect-error "typo" is not a configured modal name
    void (<Drawer name="typo">{children}</Drawer>);
    // @ts-expect-error "typo" is not a configured modal name
    void (<BaseDialog name="typo">{children}</BaseDialog>);
    void (<Dialog name="edit-user" priority={50} onDismiss={() => {}} />);
  });
});
