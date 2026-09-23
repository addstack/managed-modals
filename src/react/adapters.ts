import type { ManagedModalContextValue } from "./context.js";

/** Primitive-specific glue. Adapters never import the primitive library. */
export type ModalAdapter = {
  /** Extra props for the root, merged over the user's props. */
  getRootProps?: (modal: ManagedModalContextValue, props: Record<string, unknown>) => Record<string, unknown>;
};

type Callback = ((open: boolean) => void) | undefined;

function reportExitFrom(propName: string): ModalAdapter {
  return {
    getRootProps: (modal, props) => ({
      [propName]: (open: boolean) => {
        (props[propName] as Callback)?.(open);
        if (!open) modal.onExitComplete();
      },
    }),
  };
}

export const adapters = {
  /** Base UI `Dialog`, `AlertDialog` and `Drawer`: exit reported via `onOpenChangeComplete`. */
  baseUi: reportExitFrom("onOpenChangeComplete"),
  /** vaul `Drawer` (shadcn Drawer): exit reported via `onAnimationEnd`. */
  vaul: reportExitFrom("onAnimationEnd"),
  /**
   * Radix `Dialog`/`AlertDialog` (shadcn Dialog, Sheet, AlertDialog). Radix has
   * no exit callback: report it from content (see README) or rely on
   * `exitTimeoutMs`.
   */
  radix: {},
} satisfies Record<string, ModalAdapter>;
