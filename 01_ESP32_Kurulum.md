# PART 1: ESP32 Donanım Kurulumu ve Firmware

> Sera 2.0 — Bulanık Mantık Tabanlı Akıllı Sera Sistemi
> Donanım: ESP32 DevKit V1 + DHT22 + SG90 Servo

---

## 1. Donanım Bağlantıları

### Pin Eşleştirme Tablosu

| Bileşen | Bileşen Pini | ESP32 Pini | Not |
|---|---|---|---|
| DHT22 | VCC (+) | **3.3V** | Modülün üstündeki + işaretli pin |
| DHT22 | DATA | **GPIO 4** | Pull-up dirençli (modülde dahili) |
| DHT22 | GND (-) | **GND** | Ortak toprak |
| SG90 Servo | Kırmızı (VCC) | **VIN (5V)** | Servo 5V'ta çalışır, 3.3V yetmez |
| SG90 Servo | Kahverengi (GND) | **GND** | Aynı GND barına bağla |
| SG90 Servo | Turuncu/Sarı (Signal) | **GPIO 18** | PWM uyumlu pin |

### Breadboard Yerleşim Şeması (ASCII)

```
                    ┌────────────────────────┐
                    │      ESP32 DevKit       │
                    │                         │
                    │  3.3V ●─────────┐       │
                    │  GND  ●───────┐ │       │
                    │  GPIO4●─────┐ │ │       │
                    │  GPIO18●──┐ │ │ │       │
                    │  VIN  ●─┐ │ │ │ │       │
                    │         │ │ │ │ │       │
                    │  USB    │ │ │ │ │       │
                    └────┬────┘ │ │ │ │ │
                         │      │ │ │ │ │
                  PC/USB Şarjı  │ │ │ │ │
                                │ │ │ │ │
        ┌───────────────────────┘ │ │ │ │
        │ ┌───────────────────────┘ │ │ │
        │ │ ┌─────────────────────┐ │ │
        │ │ │                     │ │ │
        ▼ ▼ ▼                     ▼ ▼ ▼
   ┌─────────┐               ┌──────────┐
   │  SG90   │               │  DHT22   │
   │  Servo  │               │ (modül)  │
   │         │               │          │
   │ Kahve→GND│               │  - →GND  │
   │ Kırm→VIN │               │  + →3.3V │
   │ Turn→D18 │               │ OUT→GPIO4│
   └─────────┘               └──────────┘
```

### Bağlantı Adım Adım

**Adım 1 — Güç barları**
Breadboard'un kenarındaki kırmızı ve mavi şeritleri güç hattı olarak kullan.
- ESP32'nin **3.3V** pinini breadboard'un üst kırmızı şeridine bağla
- ESP32'nin **VIN (5V)** pinini breadboard'un alt kırmızı şeridine bağla (ayrı tut)
- ESP32'nin iki **GND** pinini de mavi şeride bağla (DHT ve servo için ortak GND)

**Adım 2 — DHT22**
- DHT22 modülünü breadboard'a 3 pin yatay olacak şekilde yerleştir
- VCC pinini üst kırmızı şeride (3.3V) bağla
- DATA pinini ESP32 GPIO 4'e bağla
- GND pinini mavi şeride bağla
- Eğer 3 bacaklı çıplak DHT22 kullanıyorsan: VCC ile DATA arasına 10kΩ direnç koy (pull-up). Modül versiyonunda zaten var, ekstra direnç gerekmez

**Adım 3 — SG90 Servo**
- Servo kablosunu breadboard'a uzatmak için 3 adet erkek-dişi jumper kullan
- Kırmızı kablo → alt kırmızı şerit (VIN/5V) — **3.3V'a bağlama, servo çalışmaz**
- Kahverengi kablo → mavi şerit (GND)
- Turuncu/sarı kablo → ESP32 GPIO 18

**Adım 4 — Kontrol**
- Hiçbir kablo gevşek olmamalı
- DHT22 ve servo'nun VCC pinleri **birbirine bağlanmamalı** (DHT 3.3V, servo 5V)
- GND hattı ortak olmak zorunda

> ⚠️ **Önemli:** SG90 çalışırken anlık 250-300mA çekebilir. Sadece USB ile besliyorsan ESP32 reset atabilir. Eğer böyle olursa: USB'yi PC yerine 2A'lik telefon şarjına tak veya servoyu ayrı bir 5V kaynaktan besle (GND ortak kalsın).

---

## 2. Arduino IDE Kurulumu

### 2.1 ESP32 Board Desteği

1. **Arduino IDE 2.x** indir ve kur ([arduino.cc/en/software](https://www.arduino.cc/en/software))
2. `File → Preferences → Additional Boards Manager URLs` alanına şunu ekle:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. `Tools → Board → Boards Manager` aç, "esp32" ara, **esp32 by Espressif Systems** yükle
4. `Tools → Board → ESP32 Arduino → DOIT ESP32 DEVKIT V1` seç

### 2.2 Kütüphane Kurulumu

`Tools → Manage Libraries` üzerinden şunları yükle:

| Kütüphane | Yazar | Açıklama |
|---|---|---|
| **DHT sensor library** | Adafruit | DHT22 okuma |
| **Adafruit Unified Sensor** | Adafruit | DHT'nin bağımlılığı |
| **ArduinoJson** | Benoit Blanchon | Supabase JSON ayrıştırma (v7.x) |
| **ESP32Servo** | Kevin Harrington | ESP32 için servo (standart Servo.h çalışmaz!) |

### 2.3 USB Sürücüsü

ESP32 DevKit V1 kartında genelde **CP2102** veya **CH340** USB-Serial çipi olur. Windows kullanıyorsan:
- CP2102 için: [silabs.com](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers) sürücüsünü yükle
- CH340 için: [wch-ic.com](https://www.wch-ic.com/downloads/CH341SER_EXE.html) sürücüsünü yükle

Mac/Linux'ta genelde otomatik tanınır.

### 2.4 Port Seçimi

ESP32'yi USB ile PC'ye tak, `Tools → Port` menüsünden çıkan COM portunu seç (Windows'ta COM3, COM4 vb.; Mac'te `/dev/cu.SLAB_USBtoUART` veya `/dev/cu.usbserial-*`).

---

## 3. Firmware Yükleme

### 3.1 Yapılandırma

Aşağıdaki `sera_firmware.ino` dosyasını Arduino IDE'de aç. En üstteki konfigürasyon bölümünü kendi bilgilerinle doldur:

```cpp
const char* WIFI_SSID = "MODEM_ADIN";
const char* WIFI_PASSWORD = "MODEM_SIFRESI";
const char* SUPABASE_URL = "https://xxxxxxx.supabase.co";
const char* SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5..."; // anon key
```

**Supabase anahtarını nereden alacaksın:**
1. Supabase Dashboard → projeni aç
2. `Project Settings → API` sekmesi
3. `Project URL` → `SUPABASE_URL`'e koy
4. `Project API keys → anon public` → `SUPABASE_KEY`'e koy

### 3.2 Yükleme

1. `Tools → Board` = DOIT ESP32 DEVKIT V1
2. `Tools → Upload Speed` = 921600
3. `Tools → Port` = doğru COM portu
4. Sağ üstteki **→** (Upload) butonuna bas
5. "Connecting......" yazısı çıkınca ESP32'nin üzerindeki **BOOT** butonunu basılı tut (bazı kartlarda gerekli, bazılarında değil)
6. Yükleme bitince **EN/RST** butonuna bas (reset)

### 3.3 Çalıştığını Doğrulama

`Tools → Serial Monitor` aç, baud rate'i **115200** yap. Şu çıktıları görmelisin:

```
=== Sera 2.0 ESP32 Başlatılıyor ===
WiFi'a bağlanılıyor...
Bağlandı! IP: 192.168.1.42
T: 24.3°C  H: 58.2%  (ham: 24.5 / 58.0)
Kontrol: auto=0, speed=0, manual=0
Veri gönderildi ✓
```

---

## 4. Çalışma Mantığı

Firmware şu döngüyü çalıştırır:

| Periyot | İş |
|---|---|
| 5 sn | DHT22'den ham veri oku, son 5 okumanın hareketli ortalamasını al |
| 3 sn | Supabase'den `fan_speed`, `auto_mode`, `status` çek; servoyu güncelle |
| 10 sn | Hareketli ortalama verisini Supabase `measurements` tablosuna yaz |
| sürekli | WiFi koparsa otomatik bağlan |

**Servo açısı çevirimi:** Fan hızı 0-100 → Servo açısı 0-180°. Yani %50 hız = 90°, %100 = 180°.

**Otomatik mod:** Frontend'deki bulanık mantık motoru `fan_speed` değerini hesaplayıp Supabase'e yazar, ESP32 sadece o değeri okuyup servoya uygular. Yani fuzzy logic frontend tarafında çalışıyor — ESP32 "aptal" actuator gibi davranıyor. Bu mimari, hesabı debug etmeyi kolaylaştırır ve ESP32 yükünü düşürür.

**Manuel mod:** `auto_mode=false` ise frontend'in `status` boolean'ı ve manuel olarak girilen `fan_speed` kullanılır. Status off ise servo 0'a çekilir.

---

## 5. Sorun Giderme

| Sorun | Çözüm |
|---|---|
| Upload "Failed to connect to ESP32" | BOOT butonunu basılı tut, sonra Upload'a bas, sonra bırak |
| `Tools → Port` boş | USB sürücüsünü yükle (CP2102 veya CH340), kabloyu değiştir (data kablosu olmalı, sadece şarj değil) |
| DHT22'den NaN okuma | Pin doğru mu (GPIO 4)? 3.3V'a bağlı mı? Pull-up dirençi modülde yoksa eklendi mi? |
| Servo titreşiyor / hareket etmiyor | VIN'e (5V) bağlı mı? GND ortak mı? Eğer USB'den güç yetmiyorsa harici 5V kaynak |
| Sürekli reset atıyor | Servo 5V'tan çok akım çekiyor — harici güç kaynağına geç |
| WiFi bağlanamıyor | SSID/şifre doğru mu? 2.4GHz mi (ESP32 5GHz desteklemez)? |
| Supabase 401 hatası | anon key doğru mu? URL'de "https://" var mı? |
| Supabase 404 hatası | `measurements` ve `device_controls` tabloları oluşturulmuş mu? (Bkz. Part 2) |

---

## 6. Sunum İçin Notlar

Hocaya/jüriye anlatırken vurgulanacak noktalar:

1. **Neden frontend'de fuzzy logic?** — Hesap karmaşık ve görsel debug gerektiriyor; React tarafında üyelik fonksiyonlarını grafikle göstermek daha öğretici. ESP32 sadece WiFi+sensör+aktuatör görevini yapıyor.
2. **Neden servo, neden fan değil?** — Bu bir demo prototipi; gerçek bir serada bu pinden çıkan PWM sinyali bir motor sürücüye gidip büyük fanı çalıştırır. Servo "fan hızı göstergesi" olarak konsepti fiziksel olarak gösteriyor.
3. **Neden hareketli ortalama?** — DHT22'nin gürültüsünü filtrelemek, ani spike'ların kararlara yansımasını engellemek için.
4. **Auto-reconnect ne işe yarıyor?** — WiFi kopsa bile sistem 10sn içinde tekrar bağlanır, sera 7/24 çalışacaksa kritik.
