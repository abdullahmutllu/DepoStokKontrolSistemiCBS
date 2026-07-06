<div align="center">

![Depo Konsolu](docs/media/banner.png)

**Harita entegrasyonlu · 3B görselleştirmeli · AI destekli depo & stok yönetim sistemi**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.118-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PostGIS](https://img.shields.io/badge/PostgreSQL%20%2B%20PostGIS-16%20%2F%203.5-336791?logo=postgresql&logoColor=white)](https://postgis.net)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![three.js](https://img.shields.io/badge/three.js-r3f%209-000000?logo=threedotjs&logoColor=white)](https://docs.pmnd.rs/react-three-fiber)
[![Tests](https://img.shields.io/badge/tests-233%20passing-3fb970)](#-testler)
[![License: MIT](https://img.shields.io/badge/license-MIT-5e8bff)](LICENSE)

*Excel'in göstermediği şeyi gösterir: **stoğunuzun fiziksel yerini.***

</div>

---

### 🇬🇧 English summary

**Depo Konsolu** is a multi-warehouse inventory management system for SMEs that treats *space* as a first-class citizen: warehouses live on a real map (MapLibre + PostGIS), a full **GIS workspace** lets you draw regions and get instant spatial analytics, and every rack is rendered in an **industrial-grade 3D scene** (react-three-fiber) where bin colors and fill heights encode live occupancy. On top of that: a **supply-chain network layer** (demand heatmap, center-of-gravity site suggestion, Voronoi service territories, drive-time coverage via OpenRouteService with an offline fallback), a **digital-twin realistic mode** (CC0 GLTF pallets & cartons, HDRI lighting, N8AO), **stock-alert pins** floating over low-stock bins, and an **order-picking route optimizer** (S-shape / largest-gap / greedy+2-opt) animated on the warehouse floor. And a full **logistics layer**: capacitated **vehicle routing** (Clarke-Wright + 2-opt), **live fleet tracking** where trucks move on the map in real time with per-stop ETAs (WebSocket push, REST-polling fallback), a **what-if scenario** planner (close a warehouse, see the network re-balance), **demand forecasting** (Holt double-exponential) with reorder points, **order + wave picking**, a **KPI dashboard**, and camera **barcode scanning**. An **AI layer** (OpenRouter) translates natural-language questions into safe, whitelisted, org-scoped queries — the model never touches SQL. Fully synchronous FastAPI backend, React 19 frontend, 233 tests, one-command Docker startup, plus a **serverless live demo** that runs the entire API in the browser via MSW. The UI is Turkish; the docs below follow in Turkish.

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
Mesafe ölçümü, üç altlık (OSM / Esri Uydu / OpenTopoMap), Türkiye'nin 7 coğrafi bölgesi için
hazır analiz preset'leri ve doluluk-renkli, stok-ölçekli depo marker'ları dahil.

![CBS çalışma alanı](docs/media/map-workspace.png)

### 🛰️ Ağ Analizi — tesis yeri, kapsama, akış

Gerçek sektör araçlarındaki (ArcGIS Network Analyst, anyLogistix) tesis-yeri analizlerinin
saf PostGIS ile kurulmuş hali. 60 ağırlıklı müşteri/talep noktası üzerinde:

- **Talep ısı haritası** + ağırlıkla ölçekli müşteri noktaları (CSV içe aktarılabilir)
- **En yakın depo ataması** — örümcek çizgiler + depo başına yük özeti + `ST_VoronoiPolygons`
  hizmet bölgeleri
- **Kapsama alanları** — varsayılan kuş uçuşu 10/25/50 km halkaları; `ORS_API_KEY`
  tanımlıysa gerçek **sürüş süresi isochrone'ları** (OpenRouteService, Postgres'te
  cache'lenir — kota dostu, anahtar yoksa uygulama halkalarla tam çalışır)
- **Yeni depo öner** — ağırlık merkezi (deterministik weighted k-means, 1-3 saha):
  önerilen koordinatlar, mevcut vs önerilen toplam ağırlıklı mesafe ve **% iyileşme** kartı
- **Depolar arası akış** — transfer hacmine göre kalınlaşan arklar

![Ağ analizi demosu](docs/media/demo-network.gif)

| Ağırlık merkezi önerisi + atamalar | Voronoi + kapsama halkaları |
|---|---|
| ![Ağ analizi](docs/media/network-analysis.png) | ![Kapsama](docs/media/network-coverage.png) |

### 🏗️ Endüstriyel Dijital İkiz — Analitik & Gerçekçi mod

Sahne tamamen veriden türetilir: gerçek palet rafı iskeleti (dikmeler + turuncu kat kirişleri +
tablalar — kat seviyeleri gerçek `shelf` kayıtlarından), çevre duvarları, prosedürel **dok
kepenkleri**, zemin **güvenlik çizgileri** ve kapı önü taramaları, koridor başı **raf
tabelaları**. İki mod:

- **Analitik** — her gözdeki kutunun **rengi** doluluk kovasını, **yüksekliği** doluluk
  oranını kodlar; renk modu tek tıkla **Hareket (ABC)**'ye geçer (son 30 günün
  giriş/çıkış yoğunluğu, A=kırmızı sıcak → C=yeşil seyrek)
- **Gerçekçi** — dolu gözler CC0 GLTF **palet + koli yığınlarına** dönüşür
  (doluluk oranı kadar katman), park halinde forkliftler, Poly Haven depo HDRI'ı
  (yerelde barındırılır — CDN yok), **N8AO + Bloom + SMAA** post-processing;
  veri katmanı kaybolmaz: göz önlerinde doluluk renkli LED şeritleri kalır.
  Zayıf GPU için `?lite` parametresi composer'ı kapatır. Künyeler: `docs/ASSETS-CREDITS.md`

**📍 Stok uyarı pinleri:** org genelinde stoğu eşiğin altına düşen ürün taşıyan gözlerin
üstünde **kırmızı pin**, eşiğin 1.5 katının altındakilerde **sarı pin** belirir; raf,
içindeki en kötü durumu tepesindeki büyük pinle uzaktan okunur kılar.

Ürün arayın: sahne kararır, eşleşen gözler parlar. Göze tıklayın: içerik paneli açılır.
Kamera damping'li, hazır açılar tek tık uzakta. drei `Instances` sayesinde 1000+ gözde
bile draw call sayısı iki basamaklı kalır.

| Analitik: doluluk + uyarı pinleri | Gerçekçi: palet/koli + HDRI + N8AO |
|---|---|
| ![3B depo](docs/media/3d-warehouse.png) | ![Gerçekçi mod](docs/media/realistic-3d.png) |

| Kritik stok pini (raf üstü) | Arama vurgusu (karart & parlat) |
|---|---|
| ![Uyarı pinleri](docs/media/alert-pins.png) | ![Arama vurgusu](docs/media/3d-search.png) |

### 🧭 Toplama Rotası Optimizasyonu

Sipariş gözlerini seçin (ya da "Rastgele 8 göz") — üç literatür politikası aynı koridor
grafiği üzerinde yarışır: **S-shape** (endüstri temeli), **Largest-gap** ve
**Optimize** (greedy en-yakın-komşu + 2-opt). Metre cinsinden karşılaştırma çipleri
kazananı işaretler; seçilen rota 3B zeminde **animasyonlu kesikli çizgi** ve numaralı
duraklarla çizilir. Optimum referansı: Ratliff–Rosenthal (1983).

![Toplama rotası demosu](docs/media/demo-route.gif)

![Toplama rotası — üstten](docs/media/pick-route.png)

### 🚚 Canlı Araç Takibi + Teslimat Rotalama

Depoya atanmış müşteriler için **kapasiteli araç rotalama** (Clarke-Wright savings + 2-opt):
depo/araç sayısı/kapasite seçin, turlar renkli çizgilerle haritaya düşsün. "Sevkiyatı
başlat" deyince araçlar **gerçek zamanlı** yola çıkar — konumları haritada sürekli güncellenir,
oklar kerterize döner, her araç kartında **durum, ilerleme %, sıradaki durak ve tahmini
varış (ETA)** görünür.

Takip mimarisi durumsuz: araç konumu saklanmaz, `konum = f(plan, geçen_süre)` ile her
istekte deterministik hesaplanır. Backend bunu **WebSocket** ile 2 saniyede bir push'lar
(SignalR muadili, JWT'li); soket kurulamazsa istemci **REST polling'e** düşer. Aynı motor
tarayıcı-içi demoda TypeScript olarak koşar — canlı demo sunucusuz da araçları hareket ettirir.

Demoda haritada **hep 3 araç hazır** gelir (her depodan biri, döngüsel): seed'lenmiş bu
sevkiyatlar plan bitince başa sarar, böylece hangi sekmede olursanız olun kamyonlar sürekli
Türkiye üzerinde yol alır — tek tık gerektirmeden.

![Canlı araç takibi demosu](docs/media/demo-tracking.gif)

![Canlı filo — harita üzerinde araçlar](docs/media/live-tracking.png)

### 🔀 What-if Senaryosu — depo kapat, ağı yeniden gör

Bir ya da daha çok depoyu "kapalı" işaretleyin: müşteriler anında en yakın açık depoya
yeniden atanır, **toplam ağırlıklı taşıma mesafesi**, ortalama mesafe ve kapsama nasıl
değişir kartta belirir (% fark, yeniden atanan müşteri sayısı, kapsama dışı değişimi).
Kapalı depolar haritada soluklaşıp üstü çizilir. Ağ tasarımı araçlarının (anyLogistix,
Coupa) çekirdek sorusu.

![What-if senaryosu demosu](docs/media/demo-scenario.gif)

### 📈 Talep Tahmini + Yeniden Sipariş

Her ürünün son 30 günlük çıkışından **Holt çift üstel düzeltme** ile 14 günlük tahmin
eğrisi; ortalama talep, standart sapma ve güvenlik stoklu **yeniden sipariş noktası (ROP)**.
"Ne zaman biter?" sorusuna gün cinsinden yanıt + order-up-to politikasıyla önerilen sipariş
miktarı. Genel Bakış'a operasyonun nabzını tutan **KPI şeridi** (stok devir hızı, giriş/çıkış,
hareket/gün, açık sipariş, aktif sevkiyat) eklendi.

![Talep tahmini + reorder demosu](docs/media/demo-forecast.gif)

### 📥 Sipariş + Dalga Toplama · Barkod

Müşteri siparişleri oluşturun, birden çoğunu **tek dalgada** birleştirin: kalemler ürün
bazında toplanır, gözlere çözülür ve mevcut rota çözücüyle optimize edilip **yazdırılabilir
toplama listesi** olarak çıkar. Stok işlemlerinde **kamerayla barkod okuma** (tarayıcı
yerlisi BarcodeDetector API) ile SKU'yu okutup ürün seçin.

![Sipariş + dalga toplama demosu](docs/media/demo-orders.gif)

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
        API[REST /api/v1 + WS\nJWT + org izolasyonu]
        STOCK[Stok Servisi\nkilitli & atomik]
        GEO[Geo Analiz\nST_Covers · ST_Area · ST_Distance]
        NET[Ağ Analizi\nCoG · Voronoi · kapsama]
        LOG[Lojistik\nVRP · canlı takip · tahmin]
        AI[AI Katmanı\nbeyaz-listeli sorgu derleyici]
        SCHED[APScheduler\ndüşük stok kontrolü]
    end

    DB[(PostgreSQL 16\n+ PostGIS 3.5)]
    OR[OpenRouter API]
    ORS[OpenRouteService\nisochrone · cache'li]
    SMTP[SMTP / konsol]

    RTK -->|JSON| API
    RTK -.->|"WebSocket · canlı konum"| API
    API --> STOCK & GEO & NET & LOG & AI
    STOCK & GEO & NET & LOG --> DB
    NET -.->|"anahtar varsa"| ORS
    AI -->|"kısıtlı JSON şema"| OR
    AI --> DB
    SCHED --> DB
    SCHED --> SMTP
```

Saf, test edilebilir çekirdekler (`services/vrp.py`, `tracking.py`, `forecast.py`) db/FastAPI'den
bağımsızdır; aynı algoritmalar tarayıcı-içi demoda TypeScript olarak birebir çalışır.

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
| `ORS_API_KEY` | *(boş)* | [openrouteservice](https://account.heigit.org) anahtarı: kapsama analizi gerçek sürüş süresi isochrone'larına geçer (yanıtlar cache'lenir, ücretsiz kota ~500/gün). Boşsa kuş uçuşu halkalar kullanılır |
| `AI_MAX_TOKENS` / `AI_DAILY_LIMIT` | `800` / `50` | Maliyet korumaları |
| `SMTP_HOST` … `SMTP_FROM` | *(boş)* | Boşsa e-postalar konsola loglanır |
| `RUN_SCHEDULER` / `LOW_STOCK_CHECK_MINUTES` | `1` / `15` | Düşük stok zamanlayıcısı |

## 🧪 Testler

```bash
cd backend  && .venv\Scripts\python -m pytest      # 119 test
cd frontend && npm test                            # 114 test
```

| Alan | Kanıtlanan |
|---|---|
| Org izolasyonu | B org'u A'nın verisine her uçta 404 alır — listelerde sızıntı yok |
| Stok tutarlılığı | Negatif stok reddi, **transfer atomikliği** (ortada crash → hiçbir şey yazılmaz), tam audit |
| AI güvenliği | Mock'lu: `DROP TABLE` içeren model çıktısı asla çalışmaz; alan beyaz listesi; limit → 429 |
| Geo/Ağ analizi | Poligon içi/dışı, alan/mesafe metre ölçeğinde; ağırlık merkezi beklenen noktada; Voronoi bölge sayısı; kapsama bantları; ORS mock + cache + anahtarsız halka fallback |
| VRP + rota | Clarke-Wright tek araç TSP sırası elle doğrulanmış; kapasite bölünmesi; her rotada yük ≤ kapasite; 2-opt çapraz kenar düzeltir; S-shape mesafesi birebir |
| Canlı takip | Durumsuz motor: t=0 depot, bacak ortası interpolasyon, servis penceresinde at_stop, bitişte completed; ETA/kerteriz elle hesapla; **WebSocket kare push'lar + kötü token 4401** |
| What-if | Depo kapatınca ağırlıklı mesafe artar, yeniden atanan müşteri sayısı doğru, hepsini kapatma 422 |
| Tahmin | Holt sabit seride sabit, artan trendde monoton; ROP elle hesapla birebir; stok bitiş günü; reorder önerisi |
| Sipariş/dalga | Ürün birleştirme (5+3=8), göze çözme + rota; tek-depo kısıtı 422; org izolasyonu |
| Uyarı pinleri | Eşik altı → critical, 1.5× eşik altı → warning; pin konumları göz/raf üstünde (saf kurucular) |
| Frontend | Login, depo/builder/göz paneli, ağ katmanları/CoG, canlı filo kartları, senaryo kartı, tahmin grafiği, sipariş dalgası, KPI şeridi, barkod fallback, WASD yürüyüş overlay'i |

## Notlar

- **DWG desteklenmez** — dosyayı önce DXF'e çevirin (ör. [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)).
- **Esri World Imagery** uydu katmanı atıfla, anahtarsız çalışır ancak Esri şartları koşulsuz
  ücretsiz değildir; ticari dağıtımda `frontend/src/features/map/mapStyles.ts` içindeki
  `ESRI_IMAGERY_URL` sabitini lisanslı bir uç noktayla değiştirin. Uygulama OSM ile tam çalışır.
- 3B sahnenin tüm geometrisi saf fonksiyonlarla üretilir (`sceneModel.ts`) — WebGL'siz test edilir.
- 3B varlıklar (palet, koli, forklift) ve HDRI yerelde barındırılır; kaynak ve lisans
  künyeleri için [docs/ASSETS-CREDITS.md](docs/ASSETS-CREDITS.md). Forklift CC-BY 3.0
  (KolosStudios), gerisi CC0.
- Zayıf GPU'da 3B sekmesine `?lite` ekleyin — post-processing kapanır, sahne aynı kalır.
- **Canlı araç takibi** WebSocket ile push'lanır; Docker'da nginx `/api/` WS upgrade'i
  geçirir. Takip **hızlandırılmış simülasyondur** (varsayılan 30× — 1 gerçek dakika = 30
  sim dakikası), gerçek GPS değil; amaç mekanizmayı demoda görünür kılmak.
- **Barkod okuma** tarayıcı yerlisi `BarcodeDetector` API'sine yaslanır (Chrome/Edge); harici
  WASM çözücü paketlenmez, desteklenmeyen tarayıcıda dürüst bir mesaj gösterilir.
- **Canlı demo** (`abdullahmutllu.github.io/DepoStokKontrolSistemiCBS`) tüm API'yi MSW ile
  tarayıcıda koşturur — canlı araç takibi dahil her şey sunucusuz çalışır (soket yerine 3 sn
  REST polling). Veriler sekmede tutulur, yenileyince sıfırlanır.

## Lisans

[MIT](LICENSE) © 2026 Abdullah Mutlu
