import * as RadixDialog from "@radix-ui/react-dialog";
import { StrictMode, useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { ModalRequest } from "../src/core/index.js";
import { adapters, createManagedModals } from "../src/react/index.js";

// --- lib/modals.ts ------------------------------------------------------------

const policies = {
  "session-expired": { priority: 100 },
  "payment-failed": { priority: 80 },
  "edit-profile": { priority: 40 },
  "new-version": { priority: 10 },
} as const;

type ModalName = keyof typeof policies;

const { ModalProvider, managed, useModalSchedulerState } = createManagedModals({ policies });

// --- components/ui/dialog.tsx, with the change from the README ----------------

// The only change: the primitive's parts are wrapped. A suspended dialog keeps
// its state (what you typed) until it comes back.
const DialogPrimitive = managed(RadixDialog, { kind: "dialog", adapter: adapters.radix });

function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="overlay" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={`dialog ${className}`}
        // The playground's controls live outside the dialogs; using them must not close one.
        onInteractOutside={(event) => {
          if (event.target instanceof Element && event.target.closest(".panel")) event.preventDefault();
        }}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// --- the app on the left --------------------------------------------------------

type Intents = Record<ModalName, boolean>;
type SetIntent = (name: ModalName, open: boolean) => void;

const closed: Intents = { "session-expired": false, "payment-failed": false, "edit-profile": false, "new-version": false };

function App({ intents, setIntent }: { intents: Intents; setIntent: SetIntent }) {
  const intent = (name: ModalName) => ({
    name,
    open: intents[name],
    onOpenChange: (open: boolean) => setIntent(name, open),
  });
  const close = (name: ModalName) => () => setIntent(name, false);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">acme</span>
        <nav>
          <span>Dashboard</span>
          <span>Projects</span>
          <span className="current">Settings</span>
        </nav>
        <span className="avatar">AL</span>
      </header>

      <main className="page">
        <h1>Settings</h1>
        <p className="muted">Manage your account and preferences.</p>

        <section className="card">
          <div className="row">
            <div>
              <div className="label">Profile</div>
              <div className="muted small">Your name and username, visible to your team.</div>
            </div>
            <Dialog {...intent("edit-profile")}>
              <DialogPrimitive.Trigger className="button secondary">Edit profile</DialogPrimitive.Trigger>
              <DialogContent>
                <EditProfile onDone={close("edit-profile")} />
              </DialogContent>
            </Dialog>
          </div>
          <div className="row">
            <div>
              <div className="label">Notifications</div>
              <div className="muted small">Email me about mentions and weekly summaries.</div>
            </div>
            <span className="switch-visual on" />
          </div>
        </section>
      </main>

      <Dialog {...intent("session-expired")}>
        <DialogContent className="narrow">
          <div className="icon">🔒</div>
          <DialogPrimitive.Title>Your session expired</DialogPrimitive.Title>
          <p className="muted small">Sign in again to keep working.</p>
          <label>
            Password
            <input type="password" />
          </label>
          <button className="button full" onClick={close("session-expired")}>
            Sign in
          </button>
        </DialogContent>
      </Dialog>

      <Dialog {...intent("payment-failed")}>
        <DialogContent className="narrow">
          <div className="icon">💳</div>
          <DialogPrimitive.Title>Your payment failed</DialogPrimitive.Title>
          <p className="muted small">Update your card to keep your Pro plan.</p>
          <div className="actions stacked">
            <button className="button full" onClick={close("payment-failed")}>
              Update card
            </button>
            <button className="button ghost full" onClick={close("payment-failed")}>
              Later
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog {...intent("new-version")}>
        <DialogContent className="narrow">
          <div className="icon">✨</div>
          <DialogPrimitive.Title>A new version is out</DialogPrimitive.Title>
          <p className="muted small">Reload to get faster search and dark mode for reports.</p>
          <button className="button full" onClick={close("new-version")}>
            Reload
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditProfile({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [confirming, setConfirming] = useState(false);
  const dirty = name !== "" || username !== "";

  return (
    <>
      <DialogPrimitive.Title>Edit profile</DialogPrimitive.Title>
      <p className="muted small">Type something, then fire an event on the right.</p>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </label>
      <label>
        Username
        <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
      </label>
      <div className="actions">
        <button className="button ghost" onClick={() => (dirty ? setConfirming(true) : onDone())}>
          Cancel
        </button>
        <button className="button" onClick={onDone}>
          Save changes
        </button>
      </div>

      {/* No `name`: nested in "Edit profile", so it joins that flow. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="narrow">
          <DialogPrimitive.Title>Discard changes?</DialogPrimitive.Title>
          <p className="muted small">What you typed will be lost.</p>
          <div className="actions stacked">
            <button className="button full" onClick={onDone}>
              Discard
            </button>
            <button className="button ghost full" onClick={() => setConfirming(false)}>
              Keep editing
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- the panel on the right -------------------------------------------------------

const events: { name: ModalName; emoji: string; label: string; key: string }[] = [
  { name: "session-expired", emoji: "⏰", label: "Session expires", key: "1" },
  { name: "payment-failed", emoji: "💳", label: "Payment fails", key: "2" },
  { name: "new-version", emoji: "✨", label: "New version ships", key: "3" },
];

function Panel({
  enabled,
  onToggle,
  intents,
  setIntent,
}: {
  enabled: boolean;
  onToggle: () => void;
  intents: Intents;
  setIntent: SetIntent;
}) {
  // An open modal traps focus, so the events also have keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
      const match = events.find((candidate) => candidate.key === event.key);
      if (match) setIntent(match.name, true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setIntent]);

  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="panel-title">
          <span className="dots">
            <i className="g" />
            <i className="y" />
            <i className="p" />
          </span>
          managed-modals
        </div>
        <nav className="links">
          <a href="https://github.com/addstack/managed-modals">GitHub</a>
          <a href="https://www.npmjs.com/package/@addstack/managed-modals">npm</a>
        </nav>
      </div>

      <button className={`toggle ${enabled ? "on" : ""}`} onClick={onToggle} role="switch" aria-checked={enabled}>
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
        <span>
          <strong>Scheduler {enabled ? "on" : "off"}</strong>
          <span className="muted small block">
            {enabled ? "One modal at a time, by priority." : "Plain dialogs: they pile up on each other."}
          </span>
        </span>
      </button>

      <h2>Things that happen in your app</h2>
      <p className="muted small">
        Open <em>Edit profile</em> and type something first. Then click an event, or press its key.
      </p>
      <div className="events">
        {events.map((event) => (
          <button
            key={event.name}
            className={`event ${intents[event.name] ? "fired" : ""}`}
            onClick={() => setIntent(event.name, true)}
          >
            <span className="event-emoji">{event.emoji}</span>
            <span className="event-label">{event.label}</span>
            <span className="event-priority">priority {policies[event.name].priority}</span>
            <kbd>{event.key}</kbd>
          </button>
        ))}
      </div>

      <h2>What the scheduler sees</h2>
      {enabled ? (
        <SchedulerState />
      ) : (
        <div className="empty">Off. Every dialog opens on top of the others.</div>
      )}

      <details className="code">
        <summary>The code behind this</summary>
        <pre>{`createManagedModals({
  policies: {
    "session-expired": { priority: 100 },
    "payment-failed":  { priority: 80 },
    "edit-profile":    { priority: 40 },
    "new-version":     { priority: 10 },
  },
});

<Dialog name="edit-profile" open={open} onOpenChange={setOpen}>`}</pre>
      </details>
    </aside>
  );
}

const statusLabels: Record<ModalRequest["status"], string> = {
  active: "on screen",
  covered: "on screen",
  pending: "waiting",
  suspended: "suspended",
  dismissed: "dismissed",
};

function SchedulerState() {
  const state = useModalSchedulerState();
  const requests = Object.values(state.requests);
  if (requests.length === 0) return <div className="empty">Nothing requested yet.</div>;

  const root = (request: ModalRequest<string>): ModalRequest<string> => {
    const parent = request.parentRequestId === undefined ? undefined : state.requests[request.parentRequestId];
    return parent ? root(parent) : request;
  };
  // Flows by priority, each parent before its nested dialogs.
  const sorted = [...requests].sort((a, b) => {
    const [ra, rb] = [root(a), root(b)];
    return rb.policy.priority - ra.policy.priority || ra.sequence - rb.sequence || a.sequence - b.sequence;
  });

  return (
    <div className="requests">
      {sorted.map((request) => {
        const nested = request.parentRequestId !== undefined;
        return (
          <div key={request.requestId} className={`request ${request.status} ${nested ? "nested" : ""}`}>
            <div className="request-name">{nested ? "↳ nested dialog" : request.name}</div>
            <div className="request-meta">
              <span>{nested ? `no name, joins ${request.name}` : `priority ${request.policy.priority}`}</span>
              <span className="status">{statusLabels[request.status]}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- playground -----------------------------------------------------------------

function Playground() {
  const [enabled, setEnabled] = useState(true);
  const [intents, setIntents] = useState(closed);
  const setIntent = useCallback<SetIntent>((name, open) => setIntents((current) => ({ ...current, [name]: open })), []);

  const screen = (
    <>
      <App intents={intents} setIntent={setIntent} />
      <Panel
        enabled={enabled}
        onToggle={() => {
          setEnabled(!enabled);
          setIntents(closed);
        }}
        intents={intents}
        setIntent={setIntent}
      />
    </>
  );
  // Without a provider every managed root is the plain primitive.
  return enabled ? <ModalProvider key="on">{screen}</ModalProvider> : <div key="off">{screen}</div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
