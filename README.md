# Sera 2.0 — Bulanık Mantık Tabanlı Akıllı Sera Sistemi

IoT tabanlı, gerçek zamanlı sera takip ve kontrol dashboard'u. ESP32 üzerinden DHT22 sensör verisi alır, bulanık mantık ile fan hızını otomatik hesaplar, SG90 servo motor ile aktuasyonu temsil eder.

## Teknolojiler
- **Frontend:** React 19 + Vite + Mantine v8 + Recharts
- **Backend:** Supabase (PostgreSQL + Realtime + REST API)
- **Donanım:** ESP32 DevKit V1 + DHT22 + SG90

## Kurulum

```bash
npm install
npm run dev
```

## Ortam Değişkenleri

`.env.local` dosyası oluştur:

```
VITE_SUPABASE_URL=https://xxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

## Veritabanı

İlk kez kuruyorsan `migrations/001_add_fan_speed.sql` dosyasını Supabase SQL Editor'da çalıştır.

## Bulanık Mantık Mimarisi

- **Giriş:** Sıcaklık (Soğuk/İdeal/Sıcak), Nem (Kuru/İdeal/Nemli)
- **Çıkış:** Fan hızı (0-100)
- **Kural sayısı:** 9 (Mamdani)
- **Defuzzifikasyon:** Ağırlıklı ortalama

Detaylar: `src/fuzzyLogic.js`
