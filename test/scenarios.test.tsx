// @vitest-environment jsdom
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ModalName, ModalSchedulerState } from "../src/core/index.js";
import { adapters, createManagedModals, ModalActivity, type ManagedRootProps } from "../src/react/index.js";

// Scenarios around the scheduler that each content integration has to get
// right: vetoed closes, assistive technology, reactive priority, unmounting,
// double preemption, alert dialogs, content that renders while closed.

afterEach(cleanup);

const policies = {
  "session-expired": { priority: 100 },
  billing: { priority: 80 },
  "edit-user": { priority: 40 },
  onboarding: { priority: 10 },
} as const;

type ContentProps = {
  title: string;
  children?: ReactNode;
  onEscapeKeyDown?: ((event: KeyboardEvent) => void) | undefined;
};
type ManagedRoot = ComponentType<ManagedRootProps<ComponentProps<typeof RadixDialog.Root>, ModalName<typeof policies>>>;
type Kit = { label: string; Root: ManagedRoot; Content: ComponentType<ContentProps> };

// --- content components -----------------------------------------------------------

function RadixActivityContent({ title, children, onEscapeKeyDown }: ContentProps) {
  return (
    <ModalActivity>
      <RadixDialog.Portal>
        <RadixDialog.Overlay />
        <RadixDialog.Content aria-describedby={undefined} {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}>
          <RadixDialog.Title>{title}</RadixDialog.Title>
          {children}
          <RadixDialog.Close>Close {title}</RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </ModalActivity>
  );
}

function BaseActivityContent({ title, children }: ContentProps) {
  return (
    <ModalActivity>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop />
        <BaseDialog.Popup>
          <BaseDialog.Title>{title}</BaseDialog.Title>
          {children}
          <BaseDialog.Close>Close {title}</BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </ModalActivity>
  );
}

function setup() {
  const modals = createManagedModals({ policies });
  const radix = modals.managed(RadixDialog.Root, { kind: "dialog", adapter: adapters.radix });
  // Typed as the Radix root: the scenarios use only props both roots share.
  const base = modals.managed((props: ComponentProps<typeof BaseDialog.Root>) => <BaseDialog.Root {...props} />, {
    kind: "dialog",
    adapter: adapters.baseUi,
  }) as unknown as ManagedRoot;
  const kits: Kit[] = [
    { label: "radix", Root: radix, Content: RadixActivityContent },
    { label: "base-ui", Root: base, Content: BaseActivityContent },
  ];
  return { ...modals, kits };
}

const kitLabels = ["radix", "base-ui"];

// --- helpers ------------------------------------------------------------------------

/** Dialogs a sighted user sees: `<Activity>` hides with `display: none`. */
function visibleDialogs(role: "dialog" | "alertdialog" = "dialog"): string[] {
  return screen
    .queryAllByRole(role, { hidden: true })
    .filter((dialog) => !dialog.closest('[hidden], [style*="display: none"]'))
    .map((dialog) => dialog.querySelector("h2")?.textContent ?? "?");
}

/** Dialogs exposed to assistive technology. */
function accessibleDialogs(role: "dialog" | "alertdialog" = "dialog"): string[] {
  return screen.queryAllByRole(role).map((dialog) => dialog.querySelector("h2")?.textContent ?? "?");
}

/** Controlled intent for one modal, settable from the test. */
function useIntent(initial = false) {
  const [open, setOpen] = useState(initial);
  return { open, onOpenChange: setOpen, setOpen };
}

// ---------------------------------------------------------------------------------------

describe.each(kitLabels)("%s", (label) => {
  test("the preempted dialog is hidden from assistive technology; only the active one is exposed", async () => {
    const { ModalProvider, kits } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    let session!: ReturnType<typeof useIntent>;

    function App() {
      session = useIntent();
      return (
        <ModalProvider>
          <Root name="edit-user" defaultOpen>
            <Content title="Edit user" />
          </Root>
          <Root name="session-expired" open={session.open} onOpenChange={session.onOpenChange}>
            <Content title="Session expired" />
          </Root>
        </ModalProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(accessibleDialogs()).toEqual(["Edit user"]));
    act(() => session.setOpen(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));
    expect(accessibleDialogs()).toEqual(["Session expired"]);

    act(() => session.setOpen(false));
    await waitFor(() => expect(accessibleDialogs()).toEqual(["Edit user"]));
  });

  test("a resumed nested flow exposes the nested dialog on top, as when it was opened", async () => {
    const { ModalProvider, kits } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    let session!: ReturnType<typeof useIntent>;

    function App() {
      session = useIntent();
      return (
        <ModalProvider>
          <Root name="edit-user" defaultOpen>
            <Content title="Edit user">
              <Root defaultOpen>
                <Content title="Really delete?" />
              </Root>
            </Content>
          </Root>
          <Root name="session-expired" open={session.open} onOpenChange={session.onOpenChange}>
            <Content title="Session expired" />
          </Root>
        </ModalProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(accessibleDialogs()).toEqual(["Really delete?"]));
    act(() => session.setOpen(true));
    await waitFor(() => expect(accessibleDialogs()).toEqual(["Session expired"]));

    act(() => session.setOpen(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user", "Really delete?"]));
    await waitFor(() => expect(accessibleDialogs()).toEqual(["Really delete?"]));
  });

  test("raising and lowering the priority prop preempts and resumes, with state kept", async () => {
    const { ModalProvider, kits } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    let setPriority!: (priority: number | undefined) => void;

    function App() {
      const [priority, setPriorityState] = useState<number | undefined>(undefined);
      setPriority = setPriorityState;
      return (
        <ModalProvider>
          <Root name="edit-user" defaultOpen>
            <Content title="Edit user">
              <input aria-label="Name" />
            </Content>
          </Root>
          <Root name="onboarding" defaultOpen priority={priority}>
            <Content title="Onboarding" />
          </Root>
        </ModalProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });

    act(() => setPriority(90));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));

    act(() => setPriority(undefined));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ada");
  });

  test("two preemptions in a row come back in reverse order, each with its state (Strict Mode)", async () => {
    const { ModalProvider, kits } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    let billing!: ReturnType<typeof useIntent>;
    let session!: ReturnType<typeof useIntent>;

    function App() {
      billing = useIntent();
      session = useIntent();
      return (
        <ModalProvider>
          <Root name="edit-user" defaultOpen>
            <Content title="Edit user">
              <input aria-label="Name" />
            </Content>
          </Root>
          <Root name="billing" open={billing.open} onOpenChange={billing.onOpenChange}>
            <Content title="Billing">
              <input aria-label="Card" />
            </Content>
          </Root>
          <Root name="session-expired" open={session.open} onOpenChange={session.onOpenChange}>
            <Content title="Session expired" />
          </Root>
        </ModalProvider>
      );
    }

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    act(() => billing.setOpen(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Billing"]));
    fireEvent.change(screen.getByLabelText("Card"), { target: { value: "4242" } });
    act(() => session.setOpen(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));

    act(() => session.setOpen(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Billing"]));
    expect(screen.getByLabelText<HTMLInputElement>("Card").value).toBe("4242");
    act(() => billing.setOpen(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ada");
  });

  test("a suspended dialog closed by the application is gone, and the queue goes on", async () => {
    const { ModalProvider, kits, useModalSchedulerState } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    let edit!: ReturnType<typeof useIntent>;
    let session!: ReturnType<typeof useIntent>;
    let state!: ModalSchedulerState;
    function Probe() {
      state = useModalSchedulerState();
      return null;
    }

    function App() {
      edit = useIntent(true);
      session = useIntent();
      return (
        <ModalProvider>
          <Probe />
          <Root name="edit-user" open={edit.open} onOpenChange={edit.onOpenChange}>
            <Content title="Edit user" />
          </Root>
          <Root name="session-expired" open={session.open} onOpenChange={session.onOpenChange}>
            <Content title="Session expired" />
          </Root>
          <Root name="onboarding" defaultOpen>
            <Content title="Onboarding" />
          </Root>
        </ModalProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    act(() => session.setOpen(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));

    act(() => edit.setOpen(false));
    expect(visibleDialogs()).toEqual(["Session expired"]);
    act(() => session.setOpen(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
    expect(Object.values(state.requests).map((request) => request.name)).toEqual(["onboarding"]);
  });

  test("a suspended dialog that unmounts (e.g. a route change) does not block the queue", async () => {
    const { ModalProvider, kits, useModalSchedulerState } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    let setRoute!: (route: string) => void;
    let session!: ReturnType<typeof useIntent>;
    let state!: ModalSchedulerState;
    function Probe() {
      state = useModalSchedulerState();
      return null;
    }

    function App() {
      const [route, setRouteState] = useState("users");
      setRoute = setRouteState;
      session = useIntent();
      return (
        <ModalProvider>
          <Probe />
          {route === "users" && (
            <Root name="edit-user" defaultOpen>
              <Content title="Edit user">
                <Root defaultOpen>
                  <Content title="Really delete?" />
                </Root>
              </Content>
            </Root>
          )}
          <Root name="session-expired" open={session.open} onOpenChange={session.onOpenChange}>
            <Content title="Session expired" />
          </Root>
          <Root name="onboarding" defaultOpen>
            <Content title="Onboarding" />
          </Root>
        </ModalProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user", "Really delete?"]));
    act(() => session.setOpen(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));

    act(() => setRoute("settings"));
    act(() => session.setOpen(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
    expect(Object.values(state.requests).map((request) => request.name)).toEqual(["onboarding"]);
  });

  test("a controlled dialog that refuses to close stays on screen and keeps the queue waiting", async () => {
    const { ModalProvider, kits } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    const onOpenChange = vi.fn();

    render(
      <ModalProvider>
        <Root name="edit-user" open onOpenChange={onOpenChange}>
          <Content title="Edit user" />
        </Root>
        <Root name="onboarding" defaultOpen>
          <Content title="Onboarding" />
        </Root>
      </ModalProvider>,
    );
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));

    fireEvent.click(screen.getByText("Close Edit user"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false, ...(label.startsWith("base-ui") ? [expect.anything()] : [])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(visibleDialogs()).toEqual(["Edit user"]);
  });
});

// --- vetoes -------------------------------------------------------------------------

describe.each(kitLabels.filter((label) => label.startsWith("radix")))("%s", (label) => {
  test("Escape prevented on the dialog on top closes nothing, and the suspended one stays hidden", async () => {
    const { ModalProvider, kits } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    const onEditOpenChange = vi.fn();

    render(
      <ModalProvider>
        <Root name="edit-user" defaultOpen onOpenChange={onEditOpenChange}>
          <Content title="Edit user" />
        </Root>
        <Root name="session-expired" defaultOpen>
          <Content title="Session expired" onEscapeKeyDown={(event) => event.preventDefault()} />
        </Root>
      </ModalProvider>,
    );
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(visibleDialogs()).toEqual(["Session expired"]);
    expect(onEditOpenChange).not.toHaveBeenCalled();
  });
});

describe.each(kitLabels.filter((label) => label.startsWith("base-ui")))("%s", (label) => {
  test("a close cancelled with eventDetails.cancel() keeps an uncontrolled dialog open", async () => {
    const { ModalProvider, kits } = setup();
    const { Root, Content } = kits.find((candidate) => candidate.label === label)!;
    const BaseRoot = Root as unknown as ComponentType<
      Omit<ComponentProps<typeof BaseDialog.Root>, "open" | "onOpenChange"> & {
        name?: "edit-user";
        defaultOpen?: boolean;
        onOpenChange?: (open: boolean, details?: BaseDialog.Root.ChangeEventDetails) => void;
      }
    >;

    render(
      <ModalProvider>
        <BaseRoot name="edit-user" defaultOpen onOpenChange={(_open, details) => details?.cancel()}>
          <Content title="Edit user" />
        </BaseRoot>
      </ModalProvider>,
    );
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));

    fireEvent.click(screen.getByText("Close Edit user"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(visibleDialogs()).toEqual(["Edit user"]);
  });
});

// --- alert dialogs ------------------------------------------------------------------

describe("alert dialogs", () => {
  function RadixAlertContent({ title, children }: ContentProps) {
    return (
      <ModalActivity>
        <RadixAlertDialog.Portal>
          <RadixAlertDialog.Overlay />
          <RadixAlertDialog.Content aria-describedby={undefined}>
            <RadixAlertDialog.Title>{title}</RadixAlertDialog.Title>
            {children}
            <RadixAlertDialog.Cancel>Cancel {title}</RadixAlertDialog.Cancel>
          </RadixAlertDialog.Content>
        </RadixAlertDialog.Portal>
      </ModalActivity>
    );
  }

  function BaseAlertContent({ title, children }: ContentProps) {
    return (
      <ModalActivity>
        <BaseAlertDialog.Portal>
          <BaseAlertDialog.Backdrop />
          <BaseAlertDialog.Popup>
            <BaseAlertDialog.Title>{title}</BaseAlertDialog.Title>
            {children}
            <BaseAlertDialog.Close>Cancel {title}</BaseAlertDialog.Close>
          </BaseAlertDialog.Popup>
        </BaseAlertDialog.Portal>
      </ModalActivity>
    );
  }

  for (const [label, Content, createRoot] of [
    ["radix", RadixAlertContent, () => createManagedModals({ policies }).managed(RadixAlertDialog.Root, { kind: "alert-dialog", adapter: adapters.radix })],
    [
      "base-ui",
      BaseAlertContent,
      () =>
        createManagedModals({ policies }).managed(
          (props: ComponentProps<typeof BaseAlertDialog.Root>) => <BaseAlertDialog.Root {...props} />,
          { kind: "alert-dialog", adapter: adapters.baseUi },
        ),
    ],
  ] as const) {
    test(`${label}: an alert dialog is preempted and comes back with its state; outside presses do not close it`, async () => {
      const modals = createManagedModals({ policies });
      const AlertRoot = createRoot() as unknown as ComponentType<{
        name: "edit-user" | "session-expired";
        open?: boolean;
        defaultOpen?: boolean;
        onOpenChange?: (open: boolean) => void;
        children?: ReactNode;
      }>;
      let session!: ReturnType<typeof useIntent>;

      function App() {
        session = useIntent();
        return (
          <modals.ModalProvider>
            <AlertRoot name="edit-user" defaultOpen>
              <Content title="Discard draft?">
                <input aria-label="Reason" />
              </Content>
            </AlertRoot>
            <AlertRoot name="session-expired" open={session.open} onOpenChange={session.onOpenChange}>
              <Content title="Session expired" />
            </AlertRoot>
          </modals.ModalProvider>
        );
      }

      render(<App />);
      await waitFor(() => expect(visibleDialogs("alertdialog")).toEqual(["Discard draft?"]));
      fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "typo" } });

      fireEvent.pointerDown(document.body);
      fireEvent.mouseDown(document.body);
      fireEvent.click(document.body);
      expect(visibleDialogs("alertdialog")).toEqual(["Discard draft?"]);

      act(() => session.setOpen(true));
      await waitFor(() => expect(visibleDialogs("alertdialog")).toEqual(["Session expired"]));
      expect(accessibleDialogs("alertdialog")).toEqual(["Session expired"]);

      fireEvent.click(screen.getByText("Cancel Session expired"));
      await waitFor(() => expect(visibleDialogs("alertdialog")).toEqual(["Discard draft?"]));
      expect(screen.getByLabelText<HTMLInputElement>("Reason").value).toBe("typo");
    });
  }
});

// --- content that renders while its root is closed ----------------------------------

describe("<ModalActivity> and content that renders while closed", () => {
  test("Radix forceMount driven by the application's open state (JS animations): a queued dialog stays hidden", async () => {
    const { ModalProvider } = setup();
    const Dialog = createManagedModals({ policies }).managed(RadixDialog.Root, { kind: "dialog", adapter: adapters.radix });

    // The "Animating with JavaScript libraries" pattern from the Radix docs: rendering follows the app's own `open`.
    function AnimatedContent({ open, title }: { open: boolean; title: string }) {
      return (
        <ModalActivity>
          {open && (
            <RadixDialog.Portal forceMount>
              <RadixDialog.Overlay forceMount />
              <RadixDialog.Content forceMount aria-describedby={undefined}>
                <RadixDialog.Title>{title}</RadixDialog.Title>
                <RadixDialog.Close>Close {title}</RadixDialog.Close>
              </RadixDialog.Content>
            </RadixDialog.Portal>
          )}
        </ModalActivity>
      );
    }

    function App() {
      const billing = useIntent(true);
      const onboarding = useIntent(true);
      return (
        <ModalProvider>
          <Dialog name="billing" {...billing}>
            <AnimatedContent open={billing.open} title="Billing" />
          </Dialog>
          <Dialog name="onboarding" {...onboarding}>
            <AnimatedContent open={onboarding.open} title="Onboarding" />
          </Dialog>
        </ModalProvider>
      );
    }

    render(<App />);
    expect(visibleDialogs()).toEqual(["Billing"]);
    expect(accessibleDialogs()).toEqual(["Billing"]);

    fireEvent.click(screen.getByText("Close Billing"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Onboarding"]));
    expect(accessibleDialogs()).toEqual(["Onboarding"]);
  });
});

describe("Base UI with keepMounted always on (the application's own choice)", () => {
  function AlwaysMountedContent({ title, children }: ContentProps) {
    return (
      <BaseDialog.Portal keepMounted>
        <BaseDialog.Backdrop />
        <BaseDialog.Popup>
          <BaseDialog.Title>{title}</BaseDialog.Title>
          {children}
          <BaseDialog.Close>Close {title}</BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    );
  }

  for (const withActivity of [false, true]) {
    test(`queues, preempts and resumes with state${withActivity ? ", inside <ModalActivity>" : ""}`, async () => {
      const { kits, ModalProvider } = setup();
      const Root = kits.find((candidate) => candidate.label === "base-ui")!.Root;
      const Content = withActivity
        ? ({ title, children }: ContentProps) => (
            <ModalActivity>
              <AlwaysMountedContent title={title}>{children}</AlwaysMountedContent>
            </ModalActivity>
          )
        : AlwaysMountedContent;
      let session!: ReturnType<typeof useIntent>;

      function App() {
        session = useIntent();
        return (
          <ModalProvider>
            <Root name="edit-user" defaultOpen>
              <Content title="Edit user">
                <input aria-label="Name" />
              </Content>
            </Root>
            <Root name="onboarding" defaultOpen>
              <Content title="Onboarding" />
            </Root>
            <Root name="session-expired" open={session.open} onOpenChange={session.onOpenChange}>
              <Content title="Session expired" />
            </Root>
          </ModalProvider>
        );
      }

      render(<App />);
      await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });

      act(() => session.setOpen(true));
      await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));
      act(() => session.setOpen(false));
      await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
      expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ada");
    });
  }
});
