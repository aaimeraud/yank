import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
// The brand face. Latin only: the package's Japanese subsets would add ~0.9 MB.
import "@fontsource/kapakana/latin-400.css";
import App from "./App";

async function start() {
  // Opened in a plain browser during development: use the fake backend in
  // dev/browserPreview.ts. The import is dropped from production builds.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const preview = await import("./dev/browserPreview");
    preview.install();
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
