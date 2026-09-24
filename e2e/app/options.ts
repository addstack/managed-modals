/** Fixture configuration, passed from a test to the page through the URL. */
export type FixtureOptions = {
  /** Dialog primitive. */
  kit: "radix" | "base-ui";
  /** Drawer primitive. */
  drawer: "vaul" | "base-ui";
  /** How content keeps its state while suspended: `<ModalActivity>`, or the `keepMounted` integration. */
  content: "activity" | "keep-mounted";
  awaitExit: boolean;
  exitTimeoutMs: number;
  /** Length of the dialogs' enter and exit animations. vaul uses its own 500ms. */
  durationMs: number;
};

export const defaultOptions: FixtureOptions = {
  kit: "radix",
  drawer: "vaul",
  content: "activity",
  awaitExit: false,
  exitTimeoutMs: 1000,
  durationMs: 300,
};

export function toSearch(options: Partial<FixtureOptions>): string {
  return new URLSearchParams(Object.entries(options).map(([key, value]) => [key, String(value)])).toString();
}

export function fromSearch(search: string): FixtureOptions {
  const params = new URLSearchParams(search);
  return {
    kit: params.get("kit") === "base-ui" ? "base-ui" : "radix",
    drawer: params.get("drawer") === "base-ui" ? "base-ui" : "vaul",
    content: params.get("content") === "keep-mounted" ? "keep-mounted" : "activity",
    awaitExit: params.get("awaitExit") === "true",
    exitTimeoutMs: Number(params.get("exitTimeoutMs") ?? defaultOptions.exitTimeoutMs),
    durationMs: Number(params.get("durationMs") ?? defaultOptions.durationMs),
  };
}
