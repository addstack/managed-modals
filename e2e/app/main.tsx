import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, store } from "./app.js";
import { installHarness } from "./harness.js";
import { options } from "./modals.js";

document.documentElement.style.setProperty("--duration", `${options.durationMs}ms`);
installHarness(store.getSnapshot);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
