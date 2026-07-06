/** Demo mode bootstrap: starts an MSW service worker that serves the whole
 * API from the browser. Loaded only when the bundle is built with VITE_DEMO=1
 * (dynamic import in main.tsx), so production builds carry none of this.
 */

import { setupWorker } from "msw/browser";
import { handlers } from "@/demo/handlers";
import { seedDemoShipments, type DemoShipment } from "@/demo/data";
import { buildPlan, solveVrp, type TrackStop } from "@/demo/logistics";

/** Her depodan hep-hareket eden döngüsel bir araç seed'ler (VRP + plan). */
function seedLoopingVehicles(): void {
  seedDemoShipments((_whId, depot, custs): DemoShipment | null => {
    const stops = solveVrp(
      depot,
      custs.map((c) => ({ id: c.id, lat: c.location.lat, lng: c.location.lng, demand: c.weight })),
      1,
      10_000,
    )[0]?.stops.slice(0, 6);
    if (!stops || stops.length < 2) return null;
    const byId = new Map(custs.map((c) => [c.id, c.name]));
    const shipStops = stops.map((s) => ({
      customer_id: s.id, name: byId.get(s.id) ?? `Müşteri ${s.id}`,
      lat: s.lat, lng: s.lng, demand: s.demand, service_min: 12,
    }));
    const plan = buildPlan(
      depot,
      shipStops.map((s): TrackStop => ({ id: s.customer_id, name: s.name, lat: s.lat, lng: s.lng, serviceMin: s.service_min })),
    );
    return {
      id: 0, warehouse_id: 0, vehicle_name: "",
      stops: shipStops, depot,
      base_speed_kmh: 65, time_scale: 30,
      total_km: plan.totalKm, total_min: plan.totalMin,
      depart_at_ms: 0,
    };
  });
}

export async function startDemo(): Promise<void> {
  seedLoopingVehicles();
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    // map tiles, fonts, GLTF/HDRI assets etc. pass straight through
    onUnhandledRequest: "bypass",
  });
}
