import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useLayoutEffect, useState } from "react";

import type { ModalDismissReason } from "../../src/core/index.js";
import { logEvent, registerIntent } from "./harness.js";
import { BaseDrawerModal, BaseModal, modals, options, RadixModal, VaulModal, Video } from "./modals.js";

export const store = modals.manager.createStore();

const Dialog = options.kit === "base-ui" ? BaseModal : RadixModal;
const Drawer = options.drawer === "base-ui" ? BaseDrawerModal : VaulModal;

/**
 * Controlled intent for one modal, known to the harness as `key` (the modal's
 * name, when it has one). Tests can also set it through `window.e2e.setOpen(key, open)`.
 */
function useIntent(key: string) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => registerIntent(key, setOpen), [key]);
  return {
    open,
    onOpenChange: (next: boolean) => {
      logEvent({ type: "open-change", name: key, open: next });
      setOpen(next);
    },
    onDismiss: (reason: ModalDismissReason) => logEvent({ type: "dismiss", name: key, reason }),
  };
}

export function App() {
  const [pageClicks, setPageClicks] = useState(0);
  const editUser = useIntent("edit-user");
  const deleteConfirm = useIntent("delete-confirm");
  const discardChanges = useIntent("discard-changes");
  const onboarding = useIntent("onboarding");
  const filters = useIntent("filters");
  const sessionExpired = useIntent("session-expired");
  const billing = useIntent("billing");
  const introVideo = useIntent("intro-video");
  // Base UI: a trigger for "Edit user" rendered away from its root.
  const [editUserHandle] = useState(() => BaseDialog.createHandle<unknown>());
  const saveFilter = useIntent("save-filter");

  return (
    <modals.ModalProvider store={store}>
      <main>
        <h1>managed-modals fixture</h1>
        <p>
          Dialogs: {options.kit}. Drawers: {options.drawer}. Content: {options.content}.
        </p>
        <div className="toolbar">
          <Dialog
            name="edit-user"
            {...editUser}
            {...(options.kit === "base-ui" ? { handle: editUserHandle } : {})}
            title="Edit user"
            trigger="Edit user"
          >
            <label>
              Name
              <input />
            </label>
            <label>
              Email
              <input type="email" />
            </label>
            <Dialog name="delete-confirm" {...deleteConfirm} title="Really delete?" trigger="Delete user">
              <p>This cannot be undone.</p>
            </Dialog>
            {/* No name: joins the flow of "Edit user". */}
            <Dialog {...discardChanges} title="Discard changes?" trigger="Discard changes">
              <p>Your edits will be lost.</p>
            </Dialog>
          </Dialog>
          <Dialog name="onboarding" {...onboarding} title="Onboarding" trigger="Start onboarding">
            <p>Welcome aboard.</p>
          </Dialog>
          <Dialog name="intro-video" {...introVideo} title="Intro video" trigger="Watch intro">
            <Video />
          </Dialog>
          <Drawer name="filters" {...filters} title="Filters" trigger="Open filters">
            <label>
              Search
              <input />
            </label>
            {/* No name: a dialog inside the drawer joins its flow. */}
            <Dialog {...saveFilter} title="Save filter" trigger="Save filter">
              <label>
                Filter name
                <input />
              </label>
            </Dialog>
          </Drawer>
          {options.kit === "base-ui" && (
            <BaseDialog.Trigger handle={editUserHandle}>Open user editor</BaseDialog.Trigger>
          )}
          <button type="button" onClick={() => setPageClicks((count) => count + 1)}>
            Page button
          </button>
          <output>Page clicks: {pageClicks}</output>
        </div>
        {/* Opened by application state only (`window.e2e.setOpen`), never by the user. */}
        <Dialog name="session-expired" {...sessionExpired} title="Session expired">
          <label>
            Password
            <input type="password" />
          </label>
          <button type="button">Sign in again</button>
        </Dialog>
        <Dialog name="billing" {...billing} title="Billing">
          <p>Your last payment failed.</p>
          <div className="terms" tabIndex={0} role="region" aria-label="Payment terms">
            {Array.from({ length: 30 }, (_, index) => (
              <p key={index}>Clause {index + 1}. Payments are due on the first day of each month.</p>
            ))}
          </div>
        </Dialog>
        <div className="spacer" />
      </main>
    </modals.ModalProvider>
  );
}
