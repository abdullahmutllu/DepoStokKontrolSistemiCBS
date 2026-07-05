# 3B Varlık Künyeleri

Uygulama tamamen çevrimdışı çalışır: tüm modeller ve HDRI yerelde
(`frontend/public/models/`, `frontend/public/hdri/`) barındırılır, CDN çağrısı yapılmaz.

| Dosya | İçerik | Kaynak | Yazar | Lisans |
|---|---|---|---|---|
| `models/pallet.glb` | EUR palet | [poly.pizza/m/cUAsYHDqfD](https://poly.pizza/m/cUAsYHDqfD) | Quaternius | CC0 1.0 (Public Domain) |
| `models/box_stack.glb` | Koli yığını | [poly.pizza/m/rdKKO0DvMG](https://poly.pizza/m/rdKKO0DvMG) | Quaternius | CC0 1.0 (Public Domain) |
| `models/box_single.glb` | Tekli koli | [poly.pizza/m/V9KbWC8Vd6](https://poly.pizza/m/V9KbWC8Vd6) | Quaternius | CC0 1.0 (Public Domain) |
| `models/forklift.glb` | Forklift (statik dekor) | [poly.pizza/m/DTQBuenKJY](https://poly.pizza/m/DTQBuenKJY) | KolosStudios | **CC-BY 3.0** — atıf zorunlu |
| `hdri/empty_warehouse_01_1k.hdr` | Depo iç HDRI (ortam ışığı) | [polyhaven.com/a/empty_warehouse_01](https://polyhaven.com/a/empty_warehouse_01) | Sergej Majboroda / Poly Haven | CC0 1.0 |

## İşleme

Modeller `@gltf-transform/cli optimize` ile geçirildi (weld/prune/dedup;
**sıkıştırma yok** — Draco/meshopt decoder'ları CDN gerektirir, çevrimdışı
kısıtını bozar). Dok kapıları, güvenlik çizgileri ve koridor tabelaları
prosedüreldir (CC0 muadili bulunamadı; `sceneModel.ts` içinde üretilir).

## CC-BY atfı

> Forklift by KolosStudios [CC-BY 3.0] via Poly Pizza
