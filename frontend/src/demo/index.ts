/** Demo mode bootstrap: starts an MSW service worker that serves the whole
 * API from the browser. Loaded only when the bundle is built with VITE_DEMO=1
 * (dynamic import in main.tsx), so production builds carry none of this.
 */

import { setupWorker } from "msw/browser";
import { handlers } from "@/demo/handlers";

export async function startDemo(): Promise<void> {
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    // map tiles, fonts, GLTF/HDRI assets etc. pass straight through
    onUnhandledRequest: "bypass",
  });
}
