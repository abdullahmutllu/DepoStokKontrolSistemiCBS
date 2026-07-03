<div align="center">

![Depo Konsolu](docs/media/banner.png)

**Harita entegrasyonlu · 3B görselleştirmeli · AI destekli depo & stok yönetim sistemi**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.118-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PostGIS](https://img.shields.io/badge/PostgreSQL%20%2B%20PostGIS-16%20%2F%203.5-336791?logo=postgresql&logoColor=white)](https://postgis.net)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![three.js](https://img.shields.io/badge/three.js-r3f%209-000000?logo=threedotjs&logoColor=white)](https://docs.pmnd.rs/react-three-fiber)
[![Tests](https://img.shields.io/badge/tests-108%20passing-3fb970)](#-testler)
[![License: MIT](https://img.shields.io/badge/license-MIT-5e8bff)](LICENSE)

*Excel'in göstermediği şeyi gösterir: **stoğunuzun fiziksel yerini.***

</div>

---

### 🇬🇧 English summary

**Depo Konsolu** is a multi-warehouse inventory management system for SMEs that treats *space* as a first-class citizen: warehouses live on a real map (MapLibre + PostGIS), a full **GIS workspace** lets you draw regions and get instant spatial analytics, and every rack is rendered in an **industrial-grade 3D scene** (react-three-fiber) where bin colors and fill heights encode live occupancy. An **AI layer** (OpenRouter) translates natural-language questions into safe, whitelisted, org-scoped queries — the model never touches SQL. Fully synchronous FastAPI backend, React 19 frontend, 108 tests, one-command Docker startup. The UI is Turkish; the docs below follow in Turkish.

---

## Bir bakışta

Bir bölge çizin — içindeki depoların stok analizi anında gelsin:

![Harita çalışma alanı demosu](docs/media/demo-map.gif)

Sonra depoya girin — her göz, doluluk durumunu renk **ve** yükseklikle anlatsın:

![3B depo demosu](docs/media/demo-3d.gif)

---

## Özellikler

### 🗺️ CBS Harita Çalışma Alanı

Gerçek bir GIS aracı gibi: poligon / dikdörtgen / daire çizin, **PostGIS** çizdiğiniz bölgedeki
depoları bulsun; toplam stok, doluluk, kritik ürün sayısı, bölge alanı ve depolar arası
mesafeler panelde toplansın. Bölgeyi adlandırıp kaydedin — tek tıkla güncel analizi yeniden alın.
Mesafe ölçümü, üç altlık (OSM / Esri Uydu / OpenTopoMap) ve doluluk-renkli, stok-ölçekli
depo marker'ları dahil.

![CBS çalışma alanı](docs/media/map-workspace.png)

### 🏗️ Endüstriyel Gerçekçi 3B Depo

Sahne tamamen veriden türetilir: gerçek palet rafı iskeleti (dikmeler + turuncu kat kirişleri +
tablalar — kat seviyeleri gerçek `shelf` kayıtlarından), çevre duvarları ve giriş kapısı,
zemin zon/koridor işaretleri. Her gözdeki kutunun **rengi** doluluk kovasını, **yüksekliği**
doluluk oranını kodlar. Ürün arayın: sahne kararır, eşleşen gözler parlar. Göze tıklayın:
içerik paneli açılır. Kamera damping'li, hazır açılar tek tık uzakta. drei `Instances`
sayesinde 1000+ gözde bile ~10 draw call.

| İzometrik görünüm | Arama vurgusu (karart & parlat) |
|---|---|
| ![3B depo](docs/media/3d-warehouse.png) | ![Arama vurgusu](docs/media/3d-search.png) |

### 📦 Stok Operasyonları + Tam Denetim İzi

Mal kabul / toplama / transfer / sayım — hepsi tek transaction, satır kilitli
(`SELECT … FOR UPDATE`), negatif stok reddedilir, transfer atomiktir (test kanıtlı).
Her işlem kim/ne/nereden/nereye bilgisiyle hareket kaydı üretir. Göz kodları
`Z1-A2-R3-S2-B4` şemasıyla otomatik üretilir; 2B ızgara builder'ı ya da
**DXF içe aktarma** (katman konvansiyonu: `RACK / AISLE / ZONE / WALL`) ile
yerleşim saniyeler içinde kurulur.

| Yerleşim builder | Genel bakış |
|---|---|
| ![Builder](docs/media/builder.png) | ![Dashboard](docs/media/dashboard.png) |

### 🤖 AI Katmanı — güvenli tasarım

*"Stoğu 10'un altına düşen ürünler hangileri?"* — Türkçe sorun. Model **ham SQL üretmez**;
`extra="forbid"` Pydantic şemasında kısıtlı bir JSON sorgusu döndürür, backend bunu beyaz
listeli alanlarla, her zaman org-filtreli parametreli SQLAlchemy sorgusuna çevirir.
Model çıktısının veritabanında çalışabileceği bir kod yolu yoktur — testle kanıtlı
(`DROP TABLE` enjeksiyon senaryoları dahil). Ek olarak: kural tabanlı yerleştirme önerisi,
haftalık AI özeti, kullanıcı başına günlük istek limiti. **AI kapalıyken uygulama tam çalışır.**

![AI asistan](docs/media/assistant.png)

### 📊 Raporlar & Bildirimler

Zon/koridor/raf bazında stok dağılımı, göz doluluk dağılımı, 14 günlük hareket akışı,
en hareketli ürünler, düşük stok raporu (Recharts — CVD-güvenli doğrulanmış palet).
APScheduler periyodik düşük-stok kontrolü: uygulama içi zil rozeti + e-posta
(SMTP yoksa konsola log).

![Raporlar](docs/media/reports.png)

---

## Mimari

```mermaid
flowchart LR
    subgraph Frontend["React 19 + TypeScript"]
        UI[Konsol UI\nTailwind v4]
        MAP[CBS Çalışma Alanı\nMapLibre + Terra Draw + turf]
        THREE[3B Sahne\nreact-three-fiber + drei]
        RTK[RTK Query]
        UI --> RTK
        MAP --> RTK
        THREE --> RTK
    end

    subgraph Backend["FastAPI (sync)"]
        API[REST /api/v1\nJWT + org izolasyonu]
        STOCK[Stok Servisi\nkilitli & atomik]
        GEO[Geo Analiz\nST_Covers · ST_Area · ST_Distance]
        AI[AI Katmanı\nbeyaz-listeli sorgu derleyici]
        SCHED[APScheduler\ndüşük stok kontrolü]
    end

    DB[(PostgreSQL 16\n+ PostGIS 3.5)]
    OR[OpenRouter API]
    SMTP[SMTP / konsol]

    RTK -->|JSON| API
    API --> STOCK & GEO & AI
    STOCK & GEO --> DB
    AI -->|"kısıtlı JSON şema"| OR
    AI --> DB
    SCHED --> DB
    SCHED --> SMTP
```

**İki koordinat sistemi, bilinçli ayrım:** depo *konumu* WGS84/PostGIS (harita);
depo *içi* metre cinsinden düz kartezyen x/y/z (builder + 3B). İkisi hiç karışmaz.

---

## Hızlı başlangıç

Tek gereksinim: Docker.

```bash
docker compose up --build
```

| | |
|---|---|
| Uygulama | http://localhost:8080 |
| Demo giriş | `owner@demo.co` / `Demo1234!` |
| API dokümanı | http://localhost:8080/api/v1 → backend `/docs` |

Migration + demo seed (2 depo, 216 göz, 30 ürün, gerçekçi doluluk dağılımı) otomatik çalışır.

## Geliştirme ortamı

```bash
# 1) Veritabanı (PostGIS + pytest için depo_test otomatik)
docker compose up -d db

# 2) Backend
cd backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
copy .env.example .env
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python -m app.seed
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# 3) Frontend  (http://localhost:5173 — /api'yi 8000'e proxy'ler)
cd frontend
npm install
npm run dev
```

### Ortam değişkenleri (`backend/.env`)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@localhost:5432/depo` | PostGIS'li Postgres |
| `JWT_SECRET` | `dev-secret-change-me` | Üretimde mutlaka değiştirin |
| `OPENROUTER_API_KEY` | *(boş)* | Boşsa AI kapalı kalır; uygulama tam çalışır |
| `OPENROUTER_MODEL` | `deepseek/deepseek-chat-v3-0324` | Ucuz varsayılan; bedava modeller yalnızca test için (~20 istek/dk) |
| `AI_MAX_TOKENS` / `AI_DAILY_LIMIT` | `800` / `50` | Maliyet korumaları |
| `SMTP_HOST` … `SMTP_FROM` | *(boş)* | Boşsa e-postalar konsola loglanır |
| `RUN_SCHEDULER` / `LOW_STOCK_CHECK_MINUTES` | `1` / `15` | Düşük stok zamanlayıcısı |

## 🧪 Testler

```bash
cd backend  && .venv\Scripts\python -m pytest      # 58 test
cd frontend && npm test                            # 50 test
```

| Alan | Kanıtlanan |
|---|---|
| Org izolasyonu | B org'u A'nın verisine her uçta 404 alır — listelerde sızıntı yok |
| Stok tutarlılığı | Negatif stok reddi, **transfer atomikliği** (ortada crash → hiçbir şey yazılmaz), tam audit |
| AI güvenliği | Mock'lu: `DROP TABLE` içeren model çıktısı asla çalışmaz; alan beyaz listesi; limit → 429 |
| Geo analiz | Poligon içi/dışı ayrımı, alan/mesafe büyüklükleri metre ölçeğinde doğrulanır |
| Builder & DXF | Kod benzersizliği, pos/dim tutarlılığı, mm→m ölçekleme, bozuk dosya hataları |
| Frontend | Login, harita-tıklamalı depo oluşturma, builder, göz paneli, arama vurgusu, bölge analizi |

## Notlar

- **DWG desteklenmez** — dosyayı önce DXF'e çevirin (ör. [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)).
- **Esri World Imagery** uydu katmanı atıfla, anahtarsız çalışır ancak Esri şartları koşulsuz
  ücretsiz değildir; ticari dağıtımda `frontend/src/features/map/mapStyles.ts` içindeki
  `ESRI_IMAGERY_URL` sabitini lisanslı bir uç noktayla değiştirin. Uygulama OSM ile tam çalışır.
- 3B sahnenin tüm geometrisi saf fonksiyonlarla üretilir (`sceneModel.ts`) — WebGL'siz test edilir.

## Lisans

[MIT](LICENSE) © 2026 Abdullah Mutlu
