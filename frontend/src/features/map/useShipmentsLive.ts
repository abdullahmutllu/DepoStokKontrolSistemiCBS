/** Canlı sevkiyat verisi — iki taşımalı:
 *
 * 1. WebSocket (tercih): backend 2 sn'de bir anlık görüntü push'lar
 *    (SignalR'ın FastAPI muadili). Gelen kare RTK Query önbelleğine yazılır,
 *    böylece haritadaki her tüketici aynı `useActiveShipmentsQuery`
 *    seçicisinden okur.
 * 2. REST polling (fallback): WS kurulamazsa (proxy engeli, demo modu —
 *    MSW WS'i yakalayamaz) 3 sn'lik pollingInterval devreye girer.
 */

import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { logisticsApi, useActiveShipmentsQuery } from "@/api/endpoints/logistics";
import type { Shipment } from "@/types";

const WS_DISABLED = import.meta.env.VITE_DEMO === "1" || import.meta.env.MODE === "test";

export function useShipmentsLive(enabled: boolean) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.auth.token);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // WS bağlıyken polling durur; değilken 3 sn'de bir REST tazeler.
  const query = useActiveShipmentsQuery(undefined, {
    skip: !enabled,
    pollingInterval: enabled && !wsConnected ? 3000 : 0,
  });

  useEffect(() => {
    if (!enabled || WS_DISABLED || !token) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/v1/shipments/ws?token=${token}`;
    let closedByUs = false;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type: string; data: Shipment[] };
        if (message.type !== "shipments") return;
        dispatch(
          logisticsApi.util.updateQueryData("activeShipments", undefined, () => message.data),
        );
      } catch {
        // bozuk kare — polling zaten güvenlik ağı
      }
    };
    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
      void closedByUs; // yeniden bağlanmayı polling'e bırakıyoruz
    };
    ws.onerror = () => ws.close();

    return () => {
      closedByUs = true;
      setWsConnected(false);
      ws.close();
      wsRef.current = null;
    };
  }, [enabled, token, dispatch]);

  return { shipments: query.data ?? [], transport: wsConnected ? "ws" : "poll", query };
}
