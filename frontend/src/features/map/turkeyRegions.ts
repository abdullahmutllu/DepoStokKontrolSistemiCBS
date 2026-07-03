/** Türkiye'nin 7 coğrafi bölgesi — hazır analiz preset'leri.
 *
 * Poligonlar yaklaşık bölge sınırlarıdır (analiz amaçlı, idari sınır değil).
 * Ring'ler saat yönünün tersine, kapatma noktası olmadan tutulur;
 * kapatmayı geometry.ts / backend halleder.
 */

import type { LatLng } from "@/types";

export interface RegionPreset {
  id: string;
  name: string;
  ring: LatLng[];
}

const ring = (pairs: [number, number][]): LatLng[] =>
  pairs.map(([lat, lng]) => ({ lat, lng }));

export const TURKEY_REGIONS: RegionPreset[] = [
  {
    id: "marmara",
    name: "Marmara",
    ring: ring([
      [42.1, 26.0], [42.0, 28.0], [41.5, 29.6], [41.2, 31.4],
      [40.3, 31.1], [39.8, 30.1], [39.5, 28.6], [39.5, 27.0],
      [40.0, 26.0],
    ]),
  },
  {
    id: "ege",
    name: "Ege",
    ring: ring([
      [39.6, 26.1], [39.5, 28.0], [39.0, 29.4], [38.0, 30.0],
      [36.9, 29.6], [36.5, 27.2], [37.6, 26.6], [38.4, 26.0],
    ]),
  },
  {
    id: "akdeniz",
    name: "Akdeniz",
    ring: ring([
      [36.9, 29.6], [38.0, 30.1], [38.4, 31.8], [37.4, 34.0],
      [38.1, 36.2], [37.9, 37.0], [36.1, 36.4], [35.9, 35.7],
      [36.1, 32.0], [36.1, 30.0],
    ]),
  },
  {
    id: "ic-anadolu",
    name: "İç Anadolu",
    ring: ring([
      [39.8, 30.1], [40.3, 31.1], [40.7, 32.6], [40.8, 34.1],
      [40.3, 36.1], [39.9, 38.6], [38.9, 38.4], [38.1, 36.2],
      [37.4, 34.0], [38.4, 31.8], [38.0, 30.1],
    ]),
  },
  {
    id: "karadeniz",
    name: "Karadeniz",
    ring: ring([
      [41.2, 31.4], [42.2, 35.1], [41.2, 38.0], [41.6, 40.0],
      [41.6, 42.6], [40.4, 41.5], [40.1, 39.8], [40.3, 36.1],
      [40.8, 34.1], [40.7, 32.6], [40.3, 31.1],
    ]),
  },
  {
    id: "dogu-anadolu",
    name: "Doğu Anadolu",
    ring: ring([
      [39.9, 38.6], [40.1, 39.8], [40.4, 41.5], [41.6, 42.6],
      [41.2, 43.7], [39.8, 44.8], [38.4, 44.4], [37.2, 44.3],
      [37.6, 42.6], [38.4, 41.0], [38.0, 39.0], [38.9, 38.4],
    ]),
  },
  {
    id: "guneydogu-anadolu",
    name: "Güneydoğu Anadolu",
    ring: ring([
      [37.9, 37.0], [38.0, 37.4], [38.0, 39.0], [38.4, 41.0],
      [37.6, 42.6], [37.1, 42.6], [36.7, 40.2], [36.6, 38.0],
      [36.9, 36.7],
    ]),
  },
];
