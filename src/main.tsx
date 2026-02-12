import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Render the app immediately — don't block on Sentry
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Load Sentry asynchronously after first render
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  const initSentry = () => {
    import("@sentry/react").then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
        ],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.05,
        replaysOnErrorSampleRate: 1.0,
        environment: import.meta.env.MODE,
      });
      console.log("[Sentry] Error monitoring initialized (async)");
    });
  };

  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(initSentry, { timeout: 3000 });
  } else {
    setTimeout(initSentry, 2000);
  }
}
