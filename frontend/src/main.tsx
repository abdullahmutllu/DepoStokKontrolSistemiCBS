import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@/index.css";
import { store } from "@/app/store";
import { router } from "@/app/router";

async function bootstrap() {
  // Demo build (VITE_DEMO=1): the whole API runs in the browser via MSW.
  // Dynamic import keeps every byte of it out of real production bundles.
  if (import.meta.env.VITE_DEMO === "1") {
    const { startDemo } = await import("@/demo");
    await startDemo();
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
      {import.meta.env.VITE_DEMO === "1" && (
        <div
          style={{
            position: "fixed",
            bottom: 10,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            padding: "4px 12px",
            borderRadius: 999,
            background: "#131a2acc",
            border: "1px solid #2a3550",
            color: "#8a94ad",
            fontSize: 11.5,
            backdropFilter: "blur(4px)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          Demo modu — API tarayıcınızda çalışır, sunucu yok · sayfa yenilenince veriler sıfırlanır
        </div>
      )}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#1d2740",
            border: "1px solid #2a3550",
            color: "#e6eaf4",
            fontSize: "13px",
          },
        }}
      />
    </Provider>
  </React.StrictMode>,
  );
}

void bootstrap();
