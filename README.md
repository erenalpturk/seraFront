# 🌱 Sera 2.0 — Bulanık Mantık Tabanlı Akıllı Sera Otomasyonu

IoT tabanlı, gerçek zamanlı sera takip ve kontrol sistemi. ESP32 üzerinden DHT22 ile sıcaklık ve nem okur, **Mamdani bulanık mantık** ile fan hızını otomatik hesaplar, SG90 servo motor ile havalandırmayı temsil eder. Tüm veriler Supabase üzerinden gerçek zamanlı senkronize olur; React tabanlı dashboard ile izlenir ve kontrol edilir.

<p align="center">
  <img src="public/greenhouse.png" alt="Sera 2.0" width="120" />
</p>

---

## ✨ Özellikler

- **Bulanık Mantık Kontrol Merkezi** — T ve RH girdileriyle 9 kurallık Mamdani tabanı; fan hızı 0–100 aralığında ağırlıklı ortalama defuzzifikasyonu ile hesaplanır.
- **Canlı Görselleştirme** — Üyelik fonksiyonu grafikleri, 3×3 kural matrisi (aktif kurallar parlatılır), 5 adımlı defuzzifikasyon akışı, animasyonlu fan ikonu ve 0–180° servo göstergesi.
- **Otomatik / Manuel Mod** — Otomatik modda fuzzy hesabı; manuel modda kullanıcı slider ile fan hızını 0–100 arasında belirler.
- **Gerçek Zamanlı Senkronizasyon** — Supabase Realtime kanalı ile yeni ölçümler anında UI'a yansır.
- **ESP32 Bağlantı Sağlığı** — 30 sn boyunca veri gelmezse `ÇEVRİMDIŞI` uyarısı; UI'daki hero panelin durumu otomatik güncellenir.
- **Yumuşak Servo Geçişi** — 30 ms tick, 10°/adım smoothing → tam süpürme ~0.5 sn (jitter yok, mekanik zorlama yok).
- **Tarımsal Analitik** — VPD (Buhar Basıncı Açığı, kPa), Mutlak Nem (g/m³) ve Bitki Sağlık Skoru hesaplanır.
- **PWA Desteği** — `vite-plugin-pwa` ile mobilde standalone uygulama gibi çalışır.

---

## 🏗 Sistem Mimarisi

```
┌─────────────┐   I2C/Digital   ┌──────────┐
│   DHT22     │ ──────────────► │  ESP32   │
│ (T + RH)    │                 │ DevKit V1│
└─────────────┘                 └────┬─────┘
                                     │ PWM (50Hz)
                                     ▼
                              ┌──────────────┐
                              │  SG90 Servo  │
                              │ (0–180°)     │
                              └──────────────┘
                                     ▲
                                     │ HTTPS POST/GET (3–10 sn)
                                     ▼
                              ┌──────────────┐
                              │   Supabase   │
                              │ (Postgres +  │
                              │  Realtime)   │
                              └──────┬───────┘
                                     │ WebSocket (Realtime)
                                     ▼
                          ┌────────────────────┐
                          │  React Dashboard   │
                          │  (Vite + Mantine)  │
                          │  — Fuzzy Engine    │
                          │  — Recharts        │
                          └────────────────────┘
```

**Veri Akışı:**
1. ESP32, DHT22'den 5 sn'de bir ölçer; 5 örneklik hareketli ortalama uygular.
2. 10 sn'de bir `measurements` tablosuna POST atar.
3. Frontend, Supabase Realtime ile yeni satırları anında alır.
4. Otomatik moddaysa `fuzzyLogic.js` fan hızını hesaplar, `device_controls.fan_speed` alanına yazar.
5. ESP32, 3 sn'de bir `device_controls` tablosunu çeker; 30 ms'de bir servo açısını yumuşak şekilde günceller.

---

## 🧠 Bulanık Mantık Tasarımı

**Girişler:**
| Değişken | Kümeler | Aralık |
|----------|---------|--------|
| Sıcaklık (T) | `Soğuk` / `İdeal` / `Sıcak` | trapez (–∞..16..22), üçgen (18..24..30), trapez (26..32..∞) |
| Nem (RH) | `Kuru` / `İdeal` / `Nemli` | trapez (–∞..30..50), üçgen (40..60..80), trapez (70..85..∞) |

**Çıkış kümeleri (singleton):** `off=10`, `low=30`, `medium=55`, `high=80`, `max=95`

**Kural Tabanı (9 kural — 3×3):**

| T \ RH | Kuru | İdeal | Nemli |
|--------|------|-------|-------|
| **Soğuk** | OFF | OFF | LOW |
| **İdeal** | OFF | LOW | MEDIUM |
| **Sıcak** | MEDIUM | HIGH | **MAX** |

**Çıkarım:** Mamdani AND = `min(μT, μRH)` · **Defuzzifikasyon:** Ağırlıklı ortalama → `Σ(strength × output) / Σ(strength)`

> Detaylı uygulama: [`src/fuzzyLogic.js`](src/fuzzyLogic.js)

---

## 🛠 Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Frontend | React 19, Vite 7, Mantine v8, Recharts, dayjs, Tabler Icons |
| State / Realtime | Supabase JS Client (`postgres_changes`) |
| PWA | `vite-plugin-pwa` |
| Backend | Supabase (PostgreSQL + REST + Realtime) |
| Donanım | ESP32 DevKit V1, DHT22, SG90 Servo |
| Firmware | Arduino C++ — `WiFi`, `HTTPClient`, `ArduinoJson`, `DHT`, `ESP32Servo` |

---

## 📦 Klasör Yapısı

```
seraOtomasyon/
├── sera_firmware.ino          # ESP32 firmware (Arduino IDE)
├── migrations/
│   └── 001_add_fan_speed.sql  # Supabase migration
├── src/
│   ├── App.jsx                # Ana dashboard
│   ├── fuzzyLogic.js          # Mamdani bulanık mantık motoru
│   ├── supabaseClient.js      # Supabase bağlantısı
│   └── components/
│       └── FuzzyVisualization.jsx  # Hero kontrol paneli
├── public/                    # PWA ikonları + greenhouse.png
├── DEGISIKLIKLER.md           # Detaylı değişiklik kaydı
└── package.json
```

---

## 🚀 Kurulum

### 1. Frontend

```bash
npm install
npm run dev
```

`.env.local` oluştur:

```env
VITE_SUPABASE_URL=https://xxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

### 2. Supabase

Aşağıdaki tabloları oluştur (SQL Editor):

```sql
-- Ölçümler
CREATE TABLE measurements (
  id          BIGSERIAL PRIMARY KEY,
  temperature NUMERIC,
  humidity    NUMERIC,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Cihaz kontrolleri
CREATE TABLE device_controls (
  device_name TEXT PRIMARY KEY,
  status      BOOLEAN DEFAULT FALSE,
  auto_mode   BOOLEAN DEFAULT FALSE
);

INSERT INTO device_controls (device_name) VALUES ('led_fan');
```

Sonra fan hızı kolonunu ekle:

```bash
# migrations/001_add_fan_speed.sql içeriğini SQL Editor'da çalıştır
```

`measurements` tablosu için **Realtime** özelliğini Supabase Dashboard'da aktifleştir.

### 3. ESP32 Firmware

[`sera_firmware.ino`](sera_firmware.ino) içindeki kısımları doldur:

```cpp
const char* WIFI_SSID     = "SSID";
const char* WIFI_PASSWORD = "PASSWORD";
const char* SUPABASE_URL  = "https://xxxxxxx.supabase.co";
const char* SUPABASE_KEY  = "eyJhbGc...";  // anon key
```

**Pin bağlantıları:**
- DHT22 data → GPIO 4
- SG90 servo PWM → GPIO 18
- Servo besleme → 5V (ESP32 dışından harici 5V önerilir)

**Arduino IDE kütüphaneleri:**
- `DHT sensor library` (Adafruit)
- `ArduinoJson` (Benoit Blanchon)
- `ESP32Servo` (Kevin Harrington)

Kart: **ESP32 Dev Module** — flashla ve seri monitörden bağlantıyı doğrula.

---

## 🎛 Kullanım

| Mod | Davranış |
|-----|----------|
| **Otomatik** | Fan hızı `computeFanSpeed(T, RH)` ile her yeni ölçümde hesaplanır; aktif kurallar UI'da parlatılır. |
| **Manuel** | Slider ile 0–100 arası hız; on/off switch'i ile fan kesilebilir. |

Hero panel başlığındaki rozet:
- 🟢 **CANLI HH:mm:ss** — son ölçüm 30 sn içinde geldi
- 🔴 **ÇEVRİMDIŞI** — ESP32 ile bağlantı kopuk

---

## ⚙ Zamanlama Parametreleri

| Parametre | Değer | Yer |
|-----------|-------|-----|
| DHT okuma | 5 sn | `SENSOR_READ_INTERVAL` |
| Kontrol çekme | 3 sn | `CONTROL_FETCH_INTERVAL` |
| Veri yükleme | 10 sn | `UPLOAD_INTERVAL` |
| Servo tick | 30 ms | `SERVO_UPDATE_INTERVAL` |
| Smoothing adımı | 10°/tick | `applyServoPosition()` |
| ESP32 offline eşiği | 30 sn | `ESP_OFFLINE_THRESHOLD_MS` |
| Fan hızı yazma eşiği | ±2 birim | `App.jsx` fuzzy effect |

---

## 📜 Lisans

Eğitim amaçlı proje. İhtiyaca göre kullanılabilir.
