// @vitest-environment jsdom
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentType, type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import type { ModalKind } from "../src/core/index.js";
import { adapters, createManagedModals, ModalActivity, type ModalAdapter } from "../src/react/index.js";

// Incremental adoption: adding the library to an existing project, without
// naming any modal, must not change anything. Each scenario runs twice, on the
// plain primitives ("before") and with <ModalProvider> and the primitives
// wrapped in managed() as the README shows, but no names ("after"), and
// compares the DOM, focus, onOpenChange calls and console output step by step.

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

const policies = { billing: { priority: 80 } } as const;

type ContentProps = { title: string; children?: ReactNode };
// The harness renders every primitive through the same props; their own prop types differ.
type AnyRoot = ComponentType<any>;
type AnyParts = { Root: AnyRoot; Trigger: ComponentType<{ children?: ReactNode }> } & Record<string, any>;

type Kit = {
  label: string;
  /** The primitive's parts, as its library exports them. */
  parts: AnyParts;
  kind: ModalKind;
  adapter: ModalAdapter;
  /** The shadcn/ui content component, built on the given parts. */
  content: (parts: AnyParts) => ComponentType<ContentProps>;
  /** The kit a dialog opened from inside this one comes from. */
  nested: () => Kit;
};

// --- content components: the shadcn/ui ones, and with <ModalActivity> added by hand -------

function withActivity(Content: ComponentType<ContentProps>): ComponentType<ContentProps> {
  return function ActivityContent(props: ContentProps) {
    return (
      <ModalActivity>
        <Content {...props} />
      </ModalActivity>
    );
  };
}

const radixContent = (P: AnyParts) =>
  function Content({ title, children }: ContentProps) {
    return (
      <P.Portal>
        <P.Overlay />
        <P.Content aria-describedby={undefined}>
          <P.Title>{title}</P.Title>
          {children}
          <P.Close>Close {title}</P.Close>
        </P.Content>
      </P.Portal>
    );
  };

const radixAlertContent = (P: AnyParts) =>
  function Content({ title, children }: ContentProps) {
    return (
      <P.Portal>
        <P.Overlay />
        <P.Content aria-describedby={undefined}>
          <P.Title>{title}</P.Title>
          {children}
          <P.Cancel>Close {title}</P.Cancel>
        </P.Content>
      </P.Portal>
    );
  };

const baseContent = (P: AnyParts) =>
  function Content({ title, children }: ContentProps) {
    return (
      <P.Portal>
        <P.Backdrop />
        <P.Popup>
          <P.Title>{title}</P.Title>
          {children}
          <P.Close>Close {title}</P.Close>
        </P.Popup>
      </P.Portal>
    );
  };

const baseDrawerContent = (P: AnyParts) =>
  function Content({ title, children }: ContentProps) {
    return (
      <P.Portal>
        <P.Backdrop />
        <P.Viewport>
          <P.Popup>
            <P.Content>
              <P.Title>{title}</P.Title>
              {children}
              <P.Close>Close {title}</P.Close>
            </P.Content>
          </P.Popup>
        </P.Viewport>
      </P.Portal>
    );
  };

const vaulContent = (P: AnyParts) =>
  function Content({ title, children }: ContentProps) {
    return (
      <P.Portal>
        <P.Overlay />
        <P.Content aria-describedby={undefined}>
          <P.Title>{title}</P.Title>
          {children}
          <P.Close>Close {title}</P.Close>
        </P.Content>
      </P.Portal>
    );
  };

const radixDialog: Kit = {
  label: "Radix Dialog",
  parts: RadixDialog,
  kind: "dialog",
  adapter: adapters.radix,
  content: radixContent,
  nested: () => radixDialog,
};
const baseDialog: Kit = {
  label: "Base UI Dialog",
  parts: BaseDialog,
  kind: "dialog",
  adapter: adapters.baseUi,
  content: baseContent,
  nested: () => baseDialog,
};
const kits: Kit[] = [
  radixDialog,
  {
    label: "Radix AlertDialog",
    parts: RadixAlertDialog,
    kind: "alert-dialog",
    adapter: adapters.radix,
    content: radixAlertContent,
    nested: () => radixDialog,
  },
  baseDialog,
  {
    label: "Base UI AlertDialog",
    parts: BaseAlertDialog,
    kind: "alert-dialog",
    adapter: adapters.baseUi,
    content: baseContent,
    nested: () => baseDialog,
  },
  {
    label: "Base UI Drawer",
    parts: BaseDrawer,
    kind: "drawer",
    adapter: adapters.baseUi,
    content: baseDrawerContent,
    nested: () => baseDialog,
  },
  {
    label: "vaul Drawer",
    parts: VaulDrawer,
    kind: "drawer",
    adapter: adapters.vaul,
    content: vaulContent,
    nested: () => radixDialog,
  },
];

// --- "before" and "after" ------------------------------------------------------------------

type Integration = "managed(parts)" | "managed(Root) only" | "managed(Root) + <ModalActivity>";

/** What a scenario renders with: the plain primitives, or the adopted ones. */
type Env = {
  Provider: ComponentType<{ children?: ReactNode }>;
  Root: AnyRoot;
  Trigger: AnyParts["Trigger"];
  Content: ComponentType<ContentProps>;
  NestedRoot: AnyRoot;
  NestedTrigger: AnyParts["Trigger"];
  NestedContent: ComponentType<ContentProps>;
  /** Props that make a root a managed, named modal "after"; none "before". */
  named: Record<string, string>;
};

function Fragment({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function before(kit: Kit): Env {
  const nested = kit.nested();
  return {
    Provider: Fragment,
    Root: kit.parts.Root,
    Trigger: kit.parts.Trigger,
    Content: kit.content(kit.parts),
    NestedRoot: nested.parts.Root,
    NestedTrigger: nested.parts.Trigger,
    NestedContent: nested.content(nested.parts),
    named: {},
  };
}

function after(kit: Kit, integration: Integration): Env {
  const modals = createManagedModals({ policies });
  const adopt = (of: Kit): Pick<Env, "Root" | "Trigger" | "Content"> => {
    const options = { kind: of.kind, adapter: of.adapter };
    if (integration === "managed(parts)") {
      const parts = modals.managed(of.parts, options);
      return { Root: parts.Root, Trigger: parts.Trigger, Content: of.content(parts) };
    }
    const Content = of.content(of.parts);
    return {
      Root: modals.managed(of.parts.Root, options),
      Trigger: of.parts.Trigger,
      Content: integration === "managed(Root) + <ModalActivity>" ? withActivity(Content) : Content,
    };
  };
  const own = adopt(kit);
  const nested = adopt(kit.nested());
  return {
    Provider: modals.ModalProvider,
    ...own,
    NestedRoot: nested.Root,
    NestedTrigger: nested.Trigger,
    NestedContent: nested.Content,
    named: { name: "billing" },
  };
}

// --- scenarios --------------------------------------------------------------------------------

/** Ways for a scenario's steps to reach into its app. */
type Controls = Record<string, (open: boolean) => void>;

type Scenario = {
  name: string;
  App: (props: { env: Env; log: (entry: string) => void; controls: Controls }) => ReactNode;
  steps: ((controls: Controls) => void)[];
};

/** onOpenChange as the application writes it, logging what it receives. */
function logged(name: string, log: (entry: string) => void, set?: (open: boolean) => void) {
  return (open: boolean, details?: { reason?: string }) => {
    log(`${name}: onOpenChange(${open}${details?.reason ? `, ${details.reason}` : ""})`);
    set?.(open);
  };
}

function click(text: string) {
  fireEvent.click(screen.getByText(text));
}

function escape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

function pressOutside() {
  fireEvent.pointerDown(document.body, { pointerType: "mouse" });
  fireEvent.mouseDown(document.body);
  fireEvent.pointerUp(document.body, { pointerType: "mouse" });
  fireEvent.mouseUp(document.body);
  fireEvent.click(document.body);
}

const scenarios: Scenario[] = [
  {
    name: "uncontrolled, opened from its trigger, typed into, closed with Escape and with Close",
    App: ({ env, log }) => (
      <env.Provider>
        <env.Root onOpenChange={logged("A", log)}>
          <env.Trigger>Open A</env.Trigger>
          <env.Content title="A">
            <input aria-label="A field" />
          </env.Content>
        </env.Root>
      </env.Provider>
    ),
    steps: [
      () => click("Open A"),
      () => fireEvent.change(screen.getByLabelText("A field"), { target: { value: "typed" } }),
      () => escape(),
      () => click("Open A"),
      () => click("Close A"),
    ],
  },
  {
    name: "controlled, opened from outside, closed by a press outside and by Close",
    App: ({ env, log, controls }) => {
      const [open, setOpen] = useState(false);
      controls.b = setOpen;
      return (
        <env.Provider>
          <button onClick={() => setOpen(true)}>Show B</button>
          <env.Root open={open} onOpenChange={logged("B", log, setOpen)}>
            <env.Content title="B" />
          </env.Root>
        </env.Provider>
      );
    },
    steps: [() => click("Show B"), () => pressOutside(), () => click("Show B"), () => click("Close B")],
  },
  {
    name: "open from the start (defaultOpen)",
    App: ({ env, log }) => (
      <env.Provider>
        <env.Root defaultOpen onOpenChange={logged("C", log)}>
          <env.Content title="C" />
        </env.Root>
      </env.Provider>
    ),
    steps: [() => click("Close C")],
  },
  {
    name: "two independent dialogs open at once, and a nested one: they stack, nothing waits",
    App: ({ env, log, controls }) => {
      const [open, setOpen] = useState(false);
      controls.e = setOpen;
      return (
        <env.Provider>
          <env.Root onOpenChange={logged("D", log)}>
            <env.Trigger>Open D</env.Trigger>
            <env.Content title="D">
              <env.NestedRoot onOpenChange={logged("D nested", log)}>
                <env.NestedTrigger>Open nested</env.NestedTrigger>
                <env.NestedContent title="Nested" />
              </env.NestedRoot>
            </env.Content>
          </env.Root>
          <env.Root open={open} onOpenChange={logged("E", log, setOpen)}>
            <env.Content title="E" />
          </env.Root>
        </env.Provider>
      );
    },
    steps: [
      () => click("Open D"),
      () => click("Open nested"),
      (controls) => controls.e?.(true),
      () => escape(),
      () => escape(),
      () => escape(),
    ],
  },
  {
    name: "a named modal beside unnamed ones (partial adoption): the unnamed ones do not change",
    App: ({ env, log, controls }) => {
      const [billing, setBilling] = useState(false);
      controls.billing = setBilling;
      return (
        <env.Provider>
          <env.Root onOpenChange={logged("F", log)}>
            <env.Trigger>Open F</env.Trigger>
            <env.Content title="F" />
          </env.Root>
          <env.Root {...env.named} open={billing} onOpenChange={logged("billing", log, setBilling)}>
            <env.Content title="Billing" />
          </env.Root>
        </env.Provider>
      );
    },
    steps: [() => click("Open F"), (controls) => controls.billing?.(true), () => escape(), () => escape()],
  },
];

// --- runner -----------------------------------------------------------------------------------

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

/** The DOM, focus and log after a step, with generated ids numbered by first appearance. */
function snapshot(log: string[]): string {
  const ids = new Map<string, string>();
  const html = document.body.innerHTML.replace(/_r_[0-9a-z]+_/g, (id) => {
    if (!ids.has(id)) ids.set(id, `id${ids.size}`);
    return ids.get(id)!;
  });
  const active = document.activeElement;
  const focus =
    !active || active === document.body
      ? "body"
      : `${active.tagName} "${(active.getAttribute("aria-label") ?? active.textContent ?? "").slice(0, 40)}"`;
  return JSON.stringify({ focus, log: [...log], html }, null, 1);
}

async function run(scenario: Scenario, env: Env): Promise<string[]> {
  const log: string[] = [];
  const controls: Controls = {};
  const warn = vi.spyOn(console, "warn");
  const error = vi.spyOn(console, "error");
  const snapshots: string[] = [];
  try {
    render(<scenario.App env={env} log={(entry) => log.push(entry)} controls={controls} />);
    await settle();
    snapshots.push(snapshot(log));
    for (const step of scenario.steps) {
      await act(async () => step(controls));
      await settle();
      snapshots.push(snapshot(log));
    }
    snapshots.push(`console.warn: ${JSON.stringify(warn.mock.calls)}\nconsole.error: ${JSON.stringify(error.mock.calls.map(String))}`);
  } finally {
    warn.mockRestore();
    error.mockRestore();
    cleanup();
  }
  return snapshots;
}

const integrations: Integration[] = ["managed(parts)", "managed(Root) only", "managed(Root) + <ModalActivity>"];

describe.each(kits)("$label", (kit) => {
  describe.each(integrations)("%s, no names", (integration) => {
    test.each(scenarios)("$name", async (scenario) => {
      const expected = await run(scenario, before(kit));
      const actual = await run(scenario, after(kit, integration));
      expect(actual).toEqual(expected);
    });
  });
});

describe("the check itself", () => {
  test("it sees the difference once modals are named: named modals are scheduled", async () => {
    const scenario = scenarios.find((candidate) => candidate.name.startsWith("two independent"))!;
    const namedEverywhere: Env = {
      ...after(radixDialog, "managed(parts)"),
    };
    const NamedRoot = namedEverywhere.Root;
    namedEverywhere.Root = (props: object) => <NamedRoot name="billing" {...props} />;

    const expected = await run(scenario, before(radixDialog));
    const actual = await run(scenario, namedEverywhere);
    expect(actual).not.toEqual(expected);
  });
});
