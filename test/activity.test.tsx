// @vitest-environment jsdom
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { StrictMode, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import type { ModalSchedulerState } from "../src/core/index.js";
import {
  adapters,
  createManagedModals,
  ModalActivity,
  useModalPresentation,
  usePauseWhileSuspended,
} from "../src/react/index.js";

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

// `<ModalActivity>` needs `<Activity>` (React 19.2+); before that it renders its children as they are.
const hasActivity = "Activity" in React;

const policies = {
  "session-expired": { priority: 100 },
  "edit-user": { priority: 40 },
  filters: { priority: 30 },
  onboarding: { priority: 10 },
} as const;

function setup(options: { awaitExit?: boolean; exitTimeoutMs?: number } = {}) {
  const modals = createManagedModals({ policies, ...options });
  return {
    ...modals,
    Dialog: modals.managed(RadixDialog.Root, { kind: "dialog", adapter: adapters.radix }),
    BaseDialogRoot: modals.managed((props: ComponentProps<typeof BaseDialog.Root>) => <BaseDialog.Root {...props} />, {
      kind: "dialog",
      adapter: adapters.baseUi,
    }),
    Drawer: modals.managed(VaulDrawer.Root, { kind: "drawer", adapter: adapters.vaul }),
  };
}

// --- content components with the one-line integration --------------------------

function RadixContent({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <ModalActivity>
      <RadixDialog.Portal>
        <RadixDialog.Overlay />
        <RadixDialog.Content aria-describedby={undefined}>
          <RadixDialog.Title>{title}</RadixDialog.Title>
          {children}
          <RadixDialog.Close>Close {title}</RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </ModalActivity>
  );
}

function BaseContent({ title, children }: { title: string; children?: ReactNode }) {
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

function VaulContent({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <ModalActivity>
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay />
        <VaulDrawer.Content aria-describedby={undefined}>
          <VaulDrawer.Title>{title}</VaulDrawer.Title>
          {children}
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </ModalActivity>
  );
}

/** Dialogs a user can see: `<Activity>` hides with `display: none`, the `keepMounted` integration with `hidden`. */
function visibleDialogs(): string[] {
  return screen
    .queryAllByRole("dialog", { hidden: true })
    .filter((dialog) => !dialog.closest('[hidden], [style*="display: none"]'))
    .map((dialog) => dialog.querySelector("h2")?.textContent ?? "?");
}

function pageReleased(): boolean {
  return (
    document.body.style.pointerEvents === "" &&
    !document.body.hasAttribute("data-scroll-locked") &&
    document.querySelectorAll("[aria-hidden=true]:not([data-radix-focus-guard]):not([data-type])").length === 0
  );
}

// ---------------------------------------------------------------------------------

describe.runIf(hasActivity)("Radix", () => {
  test("a preempted dialog is hidden with its state kept, and the page is left to the active one", async () => {
    const { ModalProvider, Dialog } = setup();
    const onOpenChange = vi.fn();
    let setSession!: (open: boolean) => void;

    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <ModalProvider>
          <Dialog name="edit-user" defaultOpen onOpenChange={onOpenChange}>
            <RadixContent title="Edit user">
              <input aria-label="Name" />
            </RadixContent>
          </Dialog>
          <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
            <RadixContent title="Session expired" />
          </Dialog>
        </ModalProvider>
      );
    }

    render(<App />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });

    act(() => setSession(true));
    expect(visibleDialogs()).toEqual(["Session expired"]);
    // Still open in Radix, hidden by <Activity>; the active dialog is not hidden from assistive tech.
    const hiddenDialog = screen.getAllByRole("dialog", { hidden: true }).find((dialog) => dialog.textContent?.includes("Edit user"));
    expect(hiddenDialog?.dataset.state).toBe("open");
    expect(screen.getByRole("dialog", { name: "Session expired" }).closest("[aria-hidden=true]")).toBeNull();

    fireEvent.click(screen.getByText("Close Session expired"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ada");
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Edit user" }).contains(document.activeElement)).toBe(true));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Close Edit user"));
    await waitFor(() => expect(visibleDialogs()).toEqual([]));
    await waitFor(() => expect(pageReleased()).toBe(true));
  });

  test("a nested flow is hidden and brought back whole, the nested dialog's state included", async () => {
    const { ModalProvider, Dialog, useModalSchedulerState } = setup();
    let state!: ModalSchedulerState;
    function Probe() {
      state = useModalSchedulerState();
      return null;
    }
    let setSession!: (open: boolean) => void;

    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <ModalProvider>
          <Probe />
          <Dialog name="edit-user" defaultOpen>
            <RadixContent title="Edit user">
              <Dialog defaultOpen>
                <RadixContent title="Really delete?">
                  <input aria-label="Type DELETE" />
                </RadixContent>
              </Dialog>
            </RadixContent>
          </Dialog>
          <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
            <RadixContent title="Session expired" />
          </Dialog>
        </ModalProvider>
      );
    }

    render(<App />);
    expect(visibleDialogs()).toEqual(["Edit user", "Really delete?"]);
    fireEvent.change(screen.getByLabelText("Type DELETE"), { target: { value: "DEL" } });
    const requestIds = Object.keys(state.requests);

    act(() => setSession(true));
    expect(visibleDialogs()).toEqual(["Session expired"]);

    fireEvent.click(screen.getByText("Close Session expired"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user", "Really delete?"]));
    expect(screen.getByLabelText<HTMLInputElement>("Type DELETE").value).toBe("DEL");
    // As after opening the flow: the nested dialog is exposed to assistive tech and holds focus, its parent is not.
    await waitFor(() => expect(screen.getAllByRole("dialog").map((dialog) => dialog.querySelector("h2")?.textContent)).toEqual(["Really delete?"]));
    expect(screen.getByRole("dialog", { name: "Really delete?" }).contains(document.activeElement)).toBe(true);
    // The same requests came back; nothing was closed and reopened.
    expect(Object.keys(state.requests)).toEqual(requestIds);
  });

  test("with awaitExit, the preempting dialog does not wait: a hidden dialog has no exit animation", () => {
    const { ModalProvider, Dialog, manager } = setup({ awaitExit: true, exitTimeoutMs: 60_000 });
    const store = manager.createStore();
    let setSession!: (open: boolean) => void;

    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <ModalProvider store={store}>
          <Dialog name="edit-user" defaultOpen>
            <RadixContent title="Edit user">
              <Dialog defaultOpen>
                <RadixContent title="Really delete?" />
              </Dialog>
            </RadixContent>
          </Dialog>
          <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
            <RadixContent title="Session expired" />
          </Dialog>
        </ModalProvider>
      );
    }

    render(<App />);
    act(() => setSession(true));
    expect(visibleDialogs()).toEqual(["Session expired"]);
    expect(store.getSnapshot().exiting).toEqual([]);
  });

  test("outside a managed modal it renders its children as they are", () => {
    render(
      <RadixDialog.Root defaultOpen>
        <RadixContent title="Plain" />
      </RadixDialog.Root>,
    );
    expect(visibleDialogs()).toEqual(["Plain"]);
  });
});

describe.runIf(hasActivity)("Base UI", () => {
  test("Escape and outside presses do not close a suspended dialog, although its root stays open", async () => {
    const { ModalProvider, BaseDialogRoot } = setup();
    const onEditOpenChange = vi.fn();
    let setSession!: (open: boolean) => void;

    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <ModalProvider>
          <BaseDialogRoot name="edit-user" defaultOpen onOpenChange={onEditOpenChange}>
            <BaseContent title="Edit user">
              <input aria-label="Name" />
            </BaseContent>
          </BaseDialogRoot>
          <BaseDialogRoot name="session-expired" open={session} onOpenChange={setSessionState}>
            <BaseContent title="Session expired" />
          </BaseDialogRoot>
        </ModalProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });

    act(() => setSession(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));
    // As for a user: Escape goes to the dialog on top once it holds focus (jsdom keeps focus on hidden elements).
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Session expired" }).contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ada");
    expect(onEditOpenChange).not.toHaveBeenCalled();
  });
});

describe.runIf(hasActivity)("Base UI behind a Radix dialog", () => {
  // Base UI listens for Escape and outside presses at its root, which stays
  // open behind a <ModalActivity>. Radix closes the dialog on top first
  // (synchronously), which brings the Base UI dialog back while the same
  // event, or the rest of the same press, is still on its way to it.
  function setupMixed() {
    const { ModalProvider, BaseDialogRoot, Dialog } = setup();
    const onEditOpenChange = vi.fn();
    let setSession!: (open: boolean) => void;

    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <ModalProvider>
          <BaseDialogRoot name="edit-user" defaultOpen onOpenChange={onEditOpenChange}>
            <BaseContent title="Edit user">
              <input aria-label="Name" />
            </BaseContent>
          </BaseDialogRoot>
          <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
            <RadixContent title="Session expired" />
          </Dialog>
        </ModalProvider>
      );
    }

    return { App, onEditOpenChange, openSession: () => setSession(true) };
  }

  async function preempt({ App, openSession }: ReturnType<typeof setupMixed>) {
    render(<App />);
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    act(() => openSession());
    expect(visibleDialogs()).toEqual(["Session expired"]);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Session expired" }).contains(document.activeElement)).toBe(true));
  }

  test("Escape closes only the dialog on top", async () => {
    const mixed = setupMixed();
    await preempt(mixed);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ada");
    expect(mixed.onEditOpenChange).not.toHaveBeenCalled();
  });

  test("a mouse press outside closes only the dialog on top, the rest of the press included", async () => {
    const mixed = setupMixed();
    await preempt(mixed);

    fireEvent.pointerDown(document.body, { pointerType: "mouse" });
    fireEvent.mouseDown(document.body);
    fireEvent.pointerUp(document.body, { pointerType: "mouse" });
    fireEvent.mouseUp(document.body);
    fireEvent.click(document.body);
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit user"]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(visibleDialogs()).toEqual(["Edit user"]);
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ada");
    expect(mixed.onEditOpenChange).not.toHaveBeenCalled();
  });
});

describe.runIf(hasActivity)("vaul", () => {
  test("a suspended drawer keeps what was typed", async () => {
    const { ModalProvider, Dialog, Drawer } = setup();
    let setSession!: (open: boolean) => void;

    function App() {
      const [session, setSessionState] = useState(false);
      setSession = setSessionState;
      return (
        <ModalProvider>
          <Drawer name="filters" defaultOpen>
            <VaulContent title="Filters">
              <input aria-label="Search" />
            </VaulContent>
          </Drawer>
          <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
            <RadixContent title="Session expired" />
          </Dialog>
        </ModalProvider>
      );
    }

    render(<App />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "red shoes" } });

    act(() => setSession(true));
    expect(visibleDialogs()).toEqual(["Session expired"]);

    fireEvent.click(screen.getByText("Close Session expired"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Filters"]));
    expect(screen.getByLabelText<HTMLInputElement>("Search").value).toBe("red shoes");
  });
});

/** Media positions of the jsdom stand-in, and what an engine does without any event. */
const times = new WeakMap<HTMLMediaElement, number>();
function engineDropsPosition(media: HTMLMediaElement) {
  times.set(media, 0);
  media.dispatchEvent(new Event("waiting"));
}

describe("usePauseWhileSuspended", () => {
  // jsdom does not play media: a minimal stand-in for play/pause.
  beforeAll(() => {
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get(this: HTMLMediaElement) {
        return paused.get(this) ?? true;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get(this: HTMLMediaElement) {
        return times.get(this) ?? 0;
      },
      // Seeking, as in a browser: `seeking` at once, `seeked` a moment later.
      set(this: HTMLMediaElement, time: number) {
        times.set(this, time);
        this.dispatchEvent(new Event("seeking"));
        setTimeout(() => this.dispatchEvent(new Event("seeked")));
      },
    });
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      paused.set(this, false);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      paused.set(this, true);
    };
  });

  function Video() {
    const ref = useRef<HTMLVideoElement>(null);
    usePauseWhileSuspended(ref);
    return <video ref={ref} data-testid="video" />;
  }

  /** The README's `keepMounted` integration for Radix. */
  function KeepMountedContent({ title, children }: { title: string; children?: ReactNode }) {
    const presentation = useModalPresentation();
    const suspended = presentation?.status === "suspended";
    return (
      <RadixDialog.Portal {...(presentation?.keepMounted ? { forceMount: true } : {})}>
        {!suspended && <RadixDialog.Overlay />}
        <RadixDialog.Content aria-describedby={undefined} hidden={suspended || undefined}>
          <RadixDialog.Title>{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    );
  }

  for (const [integration, Content] of [
    ...(hasActivity ? ([["ModalActivity", RadixContent]] as const) : []),
    ["keepMounted", KeepMountedContent],
  ] as const) {
    test(`${integration}: a playing video is paused while suspended and plays again from the same point (Strict Mode)`, async () => {
      const { ModalProvider, Dialog } = setup();
      let setSession!: (open: boolean) => void;

      function App() {
        const [session, setSessionState] = useState(false);
        setSession = setSessionState;
        return (
          <ModalProvider>
            <Dialog name="edit-user" defaultOpen>
              <Content title="Intro video">
                <Video />
              </Content>
            </Dialog>
            <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
              <Content title="Session expired" />
            </Dialog>
          </ModalProvider>
        );
      }

      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      const video = screen.getByTestId<HTMLVideoElement>("video");
      act(() => void video.play());
      video.currentTime = 7;

      act(() => setSession(true));
      expect(visibleDialogs()).toEqual(["Session expired"]);
      expect(video.paused).toBe(true);

      act(() => setSession(false));
      expect(visibleDialogs()).toEqual(["Intro video"]);
      expect(screen.getByTestId("video")).toBe(video);
      await waitFor(() => expect(video.paused).toBe(false));
      expect(video.currentTime).toBe(7);
    });

    test(`${integration}: a video comes back at the same point even if the engine drops its position after resuming`, async () => {
      const { ModalProvider, Dialog } = setup();
      let setSession!: (open: boolean) => void;

      function App() {
        const [session, setSessionState] = useState(false);
        setSession = setSessionState;
        return (
          <ModalProvider>
            <Dialog name="edit-user" defaultOpen>
              <Content title="Intro video">
                <Video />
              </Content>
            </Dialog>
            <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
              <Content title="Session expired" />
            </Dialog>
          </ModalProvider>
        );
      }

      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      const video = screen.getByTestId<HTMLVideoElement>("video");
      act(() => void video.play());
      video.currentTime = 12.5;

      act(() => setSession(true));
      act(() => setSession(false));
      await waitFor(() => expect(video.paused).toBe(false));
      // WebKit with GStreamer: playback starts over a moment after it resumes.
      engineDropsPosition(video);
      expect(video.currentTime).toBe(12.5);

      // The user's own seek, once ours is done, is left alone.
      await new Promise((resolve) => setTimeout(resolve));
      video.currentTime = 3;
      video.dispatchEvent(new Event("timeupdate"));
      expect(video.currentTime).toBe(3);
    });

    test(`${integration}: a video the user paused stays paused when the modal comes back`, () => {
      const { ModalProvider, Dialog } = setup();
      let setSession!: (open: boolean) => void;

      function App() {
        const [session, setSessionState] = useState(false);
        setSession = setSessionState;
        return (
          <ModalProvider>
            <Dialog name="edit-user" defaultOpen>
              <Content title="Intro video">
                <Video />
              </Content>
            </Dialog>
            <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
              <Content title="Session expired" />
            </Dialog>
          </ModalProvider>
        );
      }

      render(<App />);
      const video = screen.getByTestId<HTMLVideoElement>("video");
      act(() => setSession(true));
      act(() => setSession(false));
      expect(video.paused).toBe(true);
    });
  }
});
