// @vitest-environment jsdom
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ModalSchedulerState } from "../src/core/index.js";
import { adapters, createManagedModals, useFocusOnResume, useModalPresentation } from "../src/react/index.js";

afterEach(cleanup);

const policies = {
  "session-expired": { priority: 100 },
  billing: { priority: 80 },
  "edit-user": { priority: 40 },
  settings: { priority: 40, unique: true },
  "delete-confirm": { priority: 40 },
  onboarding: { priority: 10 },
  "command-palette": { priority: 20, whenBlocked: "dismiss" },
} as const;

// --- shadcn-style components, as a project would have them -----------------

function RadixDialogContent({ title, children }: { title: string; children?: ReactNode }) {
  const managed = useModalPresentation();
  const suspended = managed?.status === "suspended";
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusOnResume(contentRef);
  return (
    // `forceMount={managed?.keepMounted || undefined}` in a regular project;
    // spelled out here because this repo uses exactOptionalPropertyTypes.
    <RadixDialog.Portal {...(managed?.keepMounted ? { forceMount: true } : {})}>
      {!suspended && <RadixDialog.Overlay />}
      <RadixDialog.Content
        ref={contentRef}
        aria-describedby={undefined}
        hidden={suspended || undefined}
        onCloseAutoFocus={(event) => {
          if (managed?.suppressFinalFocus) event.preventDefault();
        }}
      >
        <RadixDialog.Title>{title}</RadixDialog.Title>
        {children}
        <RadixDialog.Close>Close {title}</RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

function BaseDialogContent({ title, children }: { title: string; children?: ReactNode }) {
  const managed = useModalPresentation();
  return (
    <BaseDialog.Portal keepMounted={managed?.keepMounted}>
      <BaseDialog.Backdrop />
      <BaseDialog.Popup finalFocus={managed?.suppressFinalFocus ? false : undefined}>
        <BaseDialog.Title>{title}</BaseDialog.Title>
        {children}
        <BaseDialog.Close>Close {title}</BaseDialog.Close>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

/** shadcn/ui `components/ui/dialog.tsx`: its root, renamed and wrapped as in the README. */
function DialogRoot(props: ComponentProps<typeof RadixDialog.Root>) {
  return <RadixDialog.Root data-slot="dialog" {...props} />;
}

function setup(options: { awaitExit?: boolean; exitTimeoutMs?: number } = {}) {
  const modals = createManagedModals({ policies, ...options });
  const Dialog = modals.managed(DialogRoot, { kind: "dialog", adapter: adapters.radix });
  const RadixManaged = modals.managed(RadixDialog.Root, { kind: "dialog", adapter: adapters.radix });
  const BaseManaged = modals.managed((props: ComponentProps<typeof BaseDialog.Root>) => <BaseDialog.Root {...props} />, {
    kind: "dialog",
    adapter: adapters.baseUi,
  });
  return { ...modals, Dialog, RadixManaged, BaseManaged };
}

function visibleDialogs(): string[] {
  return screen
    .queryAllByRole("dialog", { hidden: true })
    .filter((dialog) => !dialog.closest("[hidden]"))
    .map((dialog) => dialog.querySelector("h2")?.textContent ?? "?");
}

// ---------------------------------------------------------------------------

describe("Radix", () => {
  test("shows one modal at a time, highest priority first, then the queue", async () => {
    const { ModalProvider, RadixManaged } = setup();
    function App() {
      const [billing, setBilling] = useState(true);
      return (
        <ModalProvider>
          <RadixManaged name="onboarding" defaultOpen>
            <RadixDialogContent title="Onboarding" />
          </RadixManaged>
          <RadixManaged name="billing" open={billing} onOpenChange={setBilling}>
            <RadixDialogContent title="Billing" />
          </RadixManaged>
        </ModalProvider>
      );
    }

    render(<App />);
    expect(visibleDialogs()).toEqual(["Billing"]);

    fireEvent.click(screen.getByText("Close Billing"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
  });

  test("a preempted dialog keeps its state and the app's open state stays true", async () => {
    const { ModalProvider, RadixManaged } = setup();
    const onOpenChange = vi.fn();
    let openSession!: () => void;

    function App() {
      const [session, setSession] = useState(false);
      openSession = () => setSession(true);
      return (
        <ModalProvider>
          <RadixManaged name="onboarding" defaultOpen onOpenChange={onOpenChange}>
            <RadixDialogContent title="Onboarding">
              <input aria-label="Your name" />
            </RadixDialogContent>
          </RadixManaged>
          <RadixManaged name="session-expired" open={session} onOpenChange={setSession}>
            <RadixDialogContent title="Session expired" />
          </RadixManaged>
        </ModalProvider>
      );
    }

    render(<App />);
    const input = screen.getByLabelText<HTMLInputElement>("Your name");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Ada" } });

    act(() => openSession());
    expect(visibleDialogs()).toEqual(["Session expired"]);
    const session = screen.getByRole("dialog", { name: "Session expired" });
    expect(session.closest("[aria-hidden=true]")).toBeNull();

    fireEvent.click(screen.getByText("Close Session expired"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
    expect(screen.getByLabelText<HTMLInputElement>("Your name").value).toBe("Ada");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(onOpenChange).not.toHaveBeenCalled();

    // Closing the last dialog leaves no scroll lock, inert page or blocked pointer events behind.
    fireEvent.click(screen.getByText("Close Onboarding"));
    await waitFor(() => expect(visibleDialogs()).toEqual([]));
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    expect(document.querySelectorAll("[aria-hidden=true]:not([data-radix-focus-guard])")).toHaveLength(0);
  });

  test("uncontrolled dialog opens from DialogTrigger and waits while a higher priority is open", async () => {
    const { ModalProvider, RadixManaged } = setup();
    let setBilling!: (open: boolean) => void;
    function App() {
      const [billing, setBillingState] = useState(false);
      setBilling = setBillingState;
      return (
        <ModalProvider>
          <RadixManaged name="onboarding">
            <RadixDialog.Trigger>Open onboarding</RadixDialog.Trigger>
            <RadixDialogContent title="Onboarding" />
          </RadixManaged>
          <RadixManaged name="billing" open={billing} onOpenChange={setBillingState}>
            <RadixDialogContent title="Billing" />
          </RadixManaged>
        </ModalProvider>
      );
    }

    render(<App />);
    fireEvent.click(screen.getByText("Open onboarding"));
    expect(visibleDialogs()).toEqual(["Onboarding"]);

    act(() => setBilling(true));
    expect(visibleDialogs()).toEqual(["Billing"]);
    act(() => setBilling(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
  });

  test("nested dialogs stack natively: the parent stays open under the child", async () => {
    const { ModalProvider, RadixManaged } = setup();
    function App() {
      const [confirm, setConfirm] = useState(false);
      return (
        <ModalProvider>
          <RadixManaged name="edit-user" defaultOpen>
            <RadixDialogContent title="Edit user">
              <button onClick={() => setConfirm(true)}>Delete</button>
              <RadixManaged name="delete-confirm" open={confirm} onOpenChange={setConfirm}>
                <RadixDialogContent title="Really delete?" />
              </RadixManaged>
            </RadixDialogContent>
          </RadixManaged>
        </ModalProvider>
      );
    }

    render(<App />);
    fireEvent.click(screen.getByText("Delete"));
    expect(visibleDialogs()).toEqual(["Edit user", "Really delete?"]);

    fireEvent.click(screen.getByText("Close Really delete?"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
  });

  test("a parent and its nested child mounted in one commit under Strict Mode form one flow", () => {
    const { ModalProvider, RadixManaged, useModalSchedulerState } = setup();
    let state!: ModalSchedulerState;
    function Probe() {
      state = useModalSchedulerState();
      return null;
    }

    // The child sits outside the parent's content, so both register in the same
    // commit and React runs the child's effects first.
    render(
      <StrictMode>
        <ModalProvider>
          <Probe />
          <RadixManaged name="edit-user" defaultOpen>
            <RadixDialogContent title="Edit user" />
            <RadixManaged name="delete-confirm" defaultOpen>
              <RadixDialogContent title="Really delete?" />
            </RadixManaged>
          </RadixManaged>
        </ModalProvider>
      </StrictMode>,
    );

    expect(visibleDialogs()).toEqual(["Edit user", "Really delete?"]);
    const byName = Object.fromEntries(Object.values(state.requests).map((request) => [request.name, request]));
    expect(byName["delete-confirm"]?.parentRequestId).toBe(byName["edit-user"]?.requestId);
    expect(byName["delete-confirm"]?.status).toBe("active");
    expect(byName["edit-user"]?.status).toBe("covered");
  });

  test('a dismissed modal ("whenBlocked: dismiss") is closed through onOpenChange', async () => {
    const { ModalProvider, RadixManaged } = setup();
    const onDismiss = vi.fn();
    let openPalette!: () => void;
    let paletteOpen = false;

    function App() {
      const [palette, setPalette] = useState(false);
      openPalette = () => setPalette(true);
      paletteOpen = palette;
      return (
        <ModalProvider>
          <RadixManaged name="billing" defaultOpen>
            <RadixDialogContent title="Billing" />
          </RadixManaged>
          <RadixManaged name="command-palette" open={palette} onOpenChange={setPalette} onDismiss={onDismiss}>
            <RadixDialogContent title="Command palette" />
          </RadixManaged>
        </ModalProvider>
      );
    }

    render(<App />);
    act(() => openPalette());
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith("blocked"));
    expect(paletteOpen).toBe(false);
    expect(visibleDialogs()).toEqual(["Billing"]);
  });
});

describe("Base UI", () => {
  test("uncontrolled dialog opens from its trigger and closes normally", async () => {
    const { ModalProvider, BaseManaged } = setup();
    render(
      <ModalProvider>
        <BaseManaged name="onboarding">
          <BaseDialog.Trigger>Open onboarding</BaseDialog.Trigger>
          <BaseDialogContent title="Onboarding" />
        </BaseManaged>
      </ModalProvider>,
    );

    expect(visibleDialogs()).toEqual([]);
    fireEvent.click(screen.getByText("Open onboarding"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));

    fireEvent.click(screen.getByText("Close Onboarding"));
    await waitFor(() => expect(visibleDialogs()).toEqual([]));
  });

  test("keepMounted preserves state of a preempted dialog", async () => {
    const { ModalProvider, BaseManaged } = setup();
    let openSession!: () => void;

    function App() {
      const [session, setSession] = useState(false);
      openSession = () => setSession(true);
      return (
        <ModalProvider>
          <BaseManaged name="onboarding" defaultOpen>
            <BaseDialogContent title="Onboarding">
              <input aria-label="Your name" />
            </BaseDialogContent>
          </BaseManaged>
          <BaseManaged name="session-expired" open={session} onOpenChange={setSession}>
            <BaseDialogContent title="Session expired" />
          </BaseManaged>
        </ModalProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada" } });

    act(() => openSession());
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));

    fireEvent.click(screen.getByText("Close Session expired"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
    expect(screen.getByLabelText<HTMLInputElement>("Your name").value).toBe("Ada");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Your name")));

    fireEvent.click(screen.getByText("Close Onboarding"));
    await waitFor(() => expect(visibleDialogs()).toEqual([]));
    expect(document.querySelectorAll("[inert], [aria-hidden=true]")).toHaveLength(0);
  });

  test("with awaitExit the next dialog opens after onOpenChangeComplete, not after the timeout", async () => {
    const { ModalProvider, BaseManaged, manager } = setup({ awaitExit: true, exitTimeoutMs: 60_000 });
    const store = manager.createStore();

    render(
      <ModalProvider store={store}>
        <BaseManaged name="billing" defaultOpen>
          <BaseDialogContent title="Billing" />
        </BaseManaged>
        <BaseManaged name="onboarding" defaultOpen>
          <BaseDialogContent title="Onboarding" />
        </BaseManaged>
      </ModalProvider>,
    );

    await waitFor(() => expect(visibleDialogs()).toEqual(["Billing"]));
    fireEvent.click(screen.getByText("Close Billing"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
    expect(store.getSnapshot().exiting).toEqual([]);
  });
});

describe("roots in components/ui (README integration)", () => {
  test("a dialog without a name is the plain primitive: it is not scheduled", async () => {
    const { ModalProvider, Dialog, useModalSchedulerState } = setup();
    let state!: ModalSchedulerState;
    function Probe() {
      state = useModalSchedulerState();
      return null;
    }

    render(
      <ModalProvider>
        <Probe />
        <Dialog name="billing" defaultOpen>
          <RadixDialogContent title="Billing" />
        </Dialog>
        <Dialog>
          <RadixDialog.Trigger>Open help</RadixDialog.Trigger>
          <RadixDialogContent title="Help" />
        </Dialog>
      </ModalProvider>,
    );

    // Not held back by the managed dialog on screen.
    fireEvent.click(screen.getByText("Open help"));
    expect(visibleDialogs()).toEqual(["Billing", "Help"]);
    expect(Object.values(state.requests).map((request) => request.name)).toEqual(["billing"]);

    fireEvent.click(screen.getByText("Close Help"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Billing"]));
  });

  test("a dialog without a name inside a managed modal joins its flow and is hidden and restored with it", async () => {
    const { ModalProvider, Dialog, useModalSchedulerState } = setup();
    let state!: ModalSchedulerState;
    function Probe() {
      state = useModalSchedulerState();
      return null;
    }
    let setSession!: (open: boolean) => void;
    const onConfirmChange = vi.fn();

    function App() {
      const [session, setSessionState] = useState(false);
      const [confirm, setConfirm] = useState(false);
      setSession = setSessionState;
      return (
        <ModalProvider>
          <Probe />
          <Dialog name="settings" defaultOpen>
            <RadixDialogContent title="Settings">
              <button onClick={() => setConfirm(true)}>Reset</button>
              <Dialog
                open={confirm}
                onOpenChange={(open) => {
                  onConfirmChange(open);
                  setConfirm(open);
                }}
              >
                <RadixDialogContent title="Really reset?">
                  <input aria-label="Type RESET" />
                </RadixDialogContent>
              </Dialog>
            </RadixDialogContent>
          </Dialog>
          <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
            <RadixDialogContent title="Session expired" />
          </Dialog>
        </ModalProvider>
      );
    }

    render(<App />);
    fireEvent.click(screen.getByText("Reset"));
    expect(visibleDialogs()).toEqual(["Settings", "Really reset?"]);
    // Nested under the same name; `unique: true` does not count it as a duplicate.
    const [settings, confirm] = Object.values(state.requests);
    expect(confirm).toMatchObject({ name: "settings", parentRequestId: settings?.requestId, status: "active" });

    fireEvent.change(screen.getByLabelText("Type RESET"), { target: { value: "RES" } });
    act(() => setSession(true));
    expect(visibleDialogs()).toEqual(["Session expired"]);

    fireEvent.click(screen.getByText("Close Session expired"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Settings", "Really reset?"]));
    expect(screen.getByLabelText<HTMLInputElement>("Type RESET").value).toBe("RES");
    expect(onConfirmChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Close Really reset?"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Settings"]));
    expect(onConfirmChange).toHaveBeenCalledWith(false);
  });

  test("without ModalProvider every root is the plain primitive, and a named one warns once", async () => {
    const { Dialog } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <StrictMode>
        <Dialog name="billing">
          <RadixDialog.Trigger>Open billing</RadixDialog.Trigger>
          <RadixDialogContent title="Billing" />
        </Dialog>
        <Dialog name="onboarding" />
        <Dialog>
          <RadixDialog.Trigger>Open help</RadixDialog.Trigger>
          <RadixDialogContent title="Help" />
        </Dialog>
      </StrictMode>,
    );

    fireEvent.click(screen.getByText("Open billing"));
    expect(visibleDialogs()).toEqual(["Billing"]);
    fireEvent.click(screen.getByText("Close Billing"));
    await waitFor(() => expect(visibleDialogs()).toEqual([]));

    fireEvent.click(screen.getByText("Open help"));
    expect(visibleDialogs()).toEqual(["Help"]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("<ModalProvider>");
    warn.mockRestore();
  });
});

describe("types", () => {
  test("names must exist in policies, and may be left out", () => {
    const { Dialog, RadixManaged } = setup();
    // @ts-expect-error "typo" is not a configured modal name
    const typo = <RadixManaged name="typo" />;
    const unnamed = <Dialog defaultOpen />;
    expect([typo, unnamed]).toHaveLength(2);
  });

  test("onOpenChange keeps the primitive's extra arguments (optional)", () => {
    const { BaseManaged, RadixManaged } = setup();
    const reasons: string[] = [];
    const base = (
      <BaseManaged
        name="onboarding"
        onOpenChange={(open, details) => {
          if (details) reasons.push(details.reason);
          return open;
        }}
      />
    );
    // @ts-expect-error Radix passes no event details
    const radix = <RadixManaged name="onboarding" onOpenChange={(_open, details: { reason: string }) => details} />;
    expect([base, radix]).toHaveLength(2);
  });
});
