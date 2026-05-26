# Değişiklik Kaydı (Changelog)

Bu dosya, projede yapılan tüm değişiklikleri detaylı olarak kaydeder.
Her girdi: **tarih**, **dosya**, **ne yapıldı**, **neden** ve teknik **nasıl** bilgisini içerir.

---

## 2026-05-21 — Bulanık Mantık Tabanlı Fan Hızı Kontrolü (Sera 2.0)

`02_seraFront_Tasks.md` görev spesifikasyonunun uygulanması. Hedef: otomatik modda fan
hızını sıcaklık (T) ve bağıl nem (RH) değerlerinden bulanık mantık (fuzzy logic) ile
hesaplayıp Supabase `device_controls.fan_speed` alanına yazmak; manuel modda 0-100
slider ile ayarlamak; bulanık mantık görselleştirme paneli eklemek.

> Donanım ESP32 ile yeniden kurulacak. Frontend yalnızca `fan_speed` yazar; bu değeri
> okuyup SG90 servoyu sürmek firmware'in görevidir (bu repo kapsamı dışı).

### Girdiler

<!-- Yeni değişiklikler buraya, en yeni en üstte olacak şekilde eklenecek. -->

#### `migrations/001_add_fan_speed.sql` (yeni dosya)
- **Ne yapıldı:** `device_controls` tablosuna 0-100 aralığında CHECK kısıtı olan `fan_speed INTEGER DEFAULT 0` kolonu ekleyen ve mevcut `led_fan` kaydını 0'a set eden SQL migration'ı oluşturuldu.
- **Neden:** Mevcut DB'de `fan_speed` kolonu yoktu (sadece boolean `status` vardı). Kademeli fan hızı kontrolü için sayısal bir alana ihtiyaç var.
- **Nasıl:** `ADD COLUMN IF NOT EXISTS` ile idempotent tutuldu; `CHECK (fan_speed BETWEEN 0 AND 100)` ile geçersiz değerler engellendi. Bu dosya Supabase SQL Editor'dan **manuel** çalıştırılacak (uygulama doğrudan migration koşturmuyor).

#### `src/fuzzyLogic.js` (yeni dosya)
- **Ne yapıldı:** Mamdani tabanlı bulanık mantık motoru oluşturuldu. Dışa açılan fonksiyonlar: `tempMembership(T)`, `humidityMembership(RH)`, `computeFanSpeed(T, RH)`, `getDominantLabel(memberships)`.
- **Neden:** Otomatik modda fan hızını T ve RH'den deterministik ve açıklanabilir şekilde hesaplamak için. Eski eşik (threshold) tabanlı boolean mantığın yerini alır.
- **Nasıl:** Sıcaklık (cold/ideal/hot) ve nem (dry/ideal/humid) için üçgensel/trapez üyelik fonksiyonları; 9 kurallı taban (3×3); kural gücü = min(üyelikler) (Mamdani AND); ağırlıklı ortalama (singleton çıkış değerleri off=10..max=95) ile defuzzifikasyon; sonuç 0-100'e clamp'lenir. Birim doğrulaması: `computeFanSpeed(35,90)=95`, `(22,60)=30`, `(10,40)=10` (node ile test edildi, beklenenle uyumlu).

#### `src/App.jsx` (düzenleme)
- **Ne yapıldı:**
  1. `fuzzyLogic` ve `FuzzyVisualization` importları eklendi.
  2. Header rozeti `ESP12-E Online` → `ESP32 Online`.
  3. `controls` state'ine `fan_speed: 0` eklendi.
  4. Kullanılmayan `fanActive` state'i (sadece set ediliyor, render'da hiç okunmuyordu) kaldırıldı.
  5. `getInitialStatus` → `getInitialControls`: artık `auto_mode, status, threshold_humidity, fan_speed` çekilip tüm `controls` state'i Supabase'den dolduruluyor.
  6. Yeni effect: otomatik mod açık + ölçüm varken `computeFanSpeed` ile fan hızı hesaplanıp ≥2 birim fark varsa `device_controls.fan_speed`'e yazılıyor.
  7. Otomasyon paneli yeniden yazıldı: manuel modda fan aç/kapa switch + 0-100 fan hızı slider (kapalıyken disabled); otomatik modda `<AutoModeIndicator>`. Nem eşiği slider'ı kaldırıldı.
  8. `AutoModeIndicator` component'i eklendi (mevcut hız, dilsel etiketler, Progress, aktif kural sayısı).
  9. Grid ile footer arasına `<FuzzyVisualization>` bölümü eklendi.
  10. Footer metni `Sera 2.0 — Bulanık Mantık Tabanlı Kontrol` yapıldı.
- **Neden:** Otomatik modu eşik tabanlı boolean kontrolden fuzzy logic tabanlı kademeli kontrole geçirmek (kullanıcı kararı); donanımın ESP32'ye taşınması; fan hızının görselleştirilmesi.
- **Nasıl:** Mantine ve recharts `Tooltip` çakışmasını önlemek için Mantine `Tooltip` **eklenmedi** (task'te öneriliyordu ama kullanılmıyordu, kullanılmayan import = lint hatası olurdu); recharts `Tooltip` orijinal adıyla kaldı. Fuzzy effect'in deps dizisi `[measurements, controls.auto_mode]`; `controls.fan_speed` kasıtlı olarak dışarıda bırakıldığı için tek satırlık `eslint-disable-next-line react-hooks/exhaustive-deps` eklendi (aksi halde yazma sonrası gereksiz yeniden tetiklenme olurdu).

#### `src/components/FuzzyVisualization.jsx` (yeni dosya)
- **Ne yapıldı:** Bulanık mantık görselleştirme paneli — sıcaklık ve nem üyelik fonksiyonu grafikleri (Recharts `LineChart` + mevcut ölçümü gösteren `ReferenceLine`) ve aktif kuralların güç yüzdeleriyle listesi.
- **Neden:** Sunum/teslim için fuzzy mantığın nasıl çalıştığını görsel olarak açıklamak (Görev 4).
- **Nasıl:** `generateMembershipData` ile 0-40°C ve 0-100%RH aralığında üyelik değerleri örneklenip grafiklere besleniyor; `computeFanSpeed` sonucu rozet ve kural listesinde gösteriliyor. Ayrı modül olduğu için recharts `Tooltip` burada çakışmadan kullanılabiliyor.

#### `README.md` (düzenleme)
- **Ne yapıldı:** Vite boilerplate içeriği Sera 2.0 dokümantasyonuyla değiştirildi (teknolojiler, kurulum, ortam değişkenleri, migration notu, fuzzy mimari özeti).
- **Neden:** Proje gerçeğini yansıtmayan şablon README'yi anlamlı kuruluma çevirmek.
- **Nasıl:** ESP32 + DHT22 + SG90 donanımı, `migrations/001_add_fan_speed.sql` çalıştırma talimatı ve fuzzy mimari özeti eklendi.

#### `src/App.jsx` (lint düzeltmesi)
- **Ne yapıldı:** Kullanılmayan `useMemo` importu kaldırıldı.
- **Neden:** `npm run lint` `no-unused-vars` hatası veriyordu (mevcut koddan kalma kullanılmayan import).
- **Nasıl:** `import { useEffect, useState } from 'react';` olarak sadeleştirildi. Sonuç: `npm run lint` temiz, `npm run build` başarılı.
