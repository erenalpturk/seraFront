# PART 2: seraFront Frontend — Claude Code Görev Spesifikasyonu

> Bu dosya doğrudan Claude Code'a yapıştırılmak üzere hazırlanmıştır.
> Repo: https://github.com/erenalpturk/seraFront
> Stack: React 19 + Vite + Mantine v8 + Supabase + Recharts

---

## 🎯 Bağlam ve Hedef

Mevcut `seraFront` repo'su bir DHT11/22 dashboard'u olarak çalışıyor: Supabase Realtime üzerinden ölçüm akışı alıyor, VPD ve bitki sağlık skoru hesaplıyor, fan'ı boolean (on/off) ile kontrol ediyor. 

**Eksik kritik özellik:** Bulanık mantık (fuzzy logic) motoru ve kademeli fan hızı kontrolü. Donanım tarafında SG90 servo motor `fan_speed` (0-100) değerine göre 0-180° dönecek. Frontend, otomatik modda bu fan hızını **bulanık mantık ile** hesaplayıp Supabase'e yazmalı.

Donanım: ESP12-E **değil** ESP32 kullanılıyor (UI'da geçen yerleri güncelle).

---

## 📋 Görevler (Sırayla Yap)

### Görev 1 — Veritabanı Şeması Güncellemesi

**Dosya:** Yeni dosya oluştur: `migrations/001_add_fan_speed.sql`

**İçerik:**

```sql
-- device_controls tablosuna fan_speed kolonu ekle
ALTER TABLE device_controls
  ADD COLUMN IF NOT EXISTS fan_speed INTEGER DEFAULT 0 
  CHECK (fan_speed BETWEEN 0 AND 100);

-- Mevcut kaydı 0 değeriyle güncelle
UPDATE device_controls SET fan_speed = 0 WHERE device_name = 'led_fan';
```

**Not:** Kullanıcı bu SQL'i Supabase Dashboard'un `SQL Editor` bölümünden manuel olarak çalıştıracak. Sen sadece dosyayı oluştur ve README'ye nasıl çalıştırılacağı bilgisini ekle.

---

### Görev 2 — Bulanık Mantık Motorunu Oluştur

**Dosya:** Yeni dosya: `src/fuzzyLogic.js`

**Tasarım kararları:**
- **Giriş değişkenleri:** Sıcaklık (T), Bağıl Nem (RH)
- **Çıkış değişkeni:** Fan hızı (0-100)
- **Üyelik fonksiyonları:** Üçgensel ve trapez (basitlik için)
- **Defuzzifikasyon:** Ağırlıklı ortalama (centroid'in basitleştirilmiş hali, eğitim amaçlı net)
- **Kural sayısı:** 9 (3 sıcaklık × 3 nem)

**Tam dosya içeriği:**

```javascript
// src/fuzzyLogic.js
// Bulanık Mantık Motoru — Sera Fan Kontrolü
// Mamdani tabanlı, ağırlıklı ortalama (weighted average) defuzzifikasyon

// ============ ÜYELİK FONKSİYONLARI ============
// Yardımcı: Üçgensel üyelik fonksiyonu
// x: giriş, a-b-c: üçgenin sol-tepe-sağ noktaları
function triangular(x, a, b, c) {
  if (x <= a || x >= c) return 0;
  if (x === b) return 1;
  if (x < b) return (x - a) / (b - a);
  return (c - x) / (c - b);
}

// Yardımcı: Trapez üyelik fonksiyonu (uçlardaki sınırsız kümeler için)
// x: giriş, a-b-c-d: trapezin köşeleri (a<=b<=c<=d), uç kümeler için a=b veya c=d
function trapezoidal(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  if (x < b) return (x - a) / (b - a);
  return (d - x) / (d - c);
}

// ============ SICAKLIK KÜMELERİ ============
// Soğuk:  -∞..16..22..22  (trapez, 16°C altı tam üye)
// İdeal:  18..24..30        (üçgen)
// Sıcak:  26..32..∞..∞      (trapez, 32°C üstü tam üye)
export function tempMembership(T) {
  return {
    cold:  trapezoidal(T, -100, -100, 16, 22),
    ideal: triangular(T, 18, 24, 30),
    hot:   trapezoidal(T, 26, 32, 100, 100),
  };
}

// ============ NEM KÜMELERİ ============
// Kuru:  -∞..30..50..50
// İdeal: 40..60..80
// Nemli: 70..85..∞..∞
export function humidityMembership(RH) {
  return {
    dry:   trapezoidal(RH, -100, -100, 30, 50),
    ideal: triangular(RH, 40, 60, 80),
    humid: trapezoidal(RH, 70, 85, 200, 200),
  };
}

// ============ ÇIKIŞ KÜMELERİ (Fan Hızı Singleton Değerleri) ============
// Ağırlıklı ortalama defuzzifikasyon için her dilsel değişkenin temsili sayısal değeri
const FAN_SPEED_LEVELS = {
  off:    10,
  low:    30,
  medium: 55,
  high:   80,
  max:    95,
};

// ============ KURAL TABANI ============
// (T_kümesi, RH_kümesi) → çıkış kümesi
// Tarımsal mantık:
//   - Soğuk hava: fan az çalışsın (bitki ısı kaybetmesin)
//   - Sıcak hava: fan çalışsın (özellikle nem yüksekse mantar riski var)
//   - Yüksek nem: havalandırma şart (mantar riski)
const RULES = [
  // [tempSet, humSet, outputSet, açıklama]
  ['cold',  'dry',   'off',    'Soğuk + Kuru → Kapalı'],
  ['cold',  'ideal', 'off',    'Soğuk + İdeal → Kapalı'],
  ['cold',  'humid', 'low',    'Soğuk + Nemli → Düşük (mantar önleme)'],
  ['ideal', 'dry',   'off',    'İdeal + Kuru → Kapalı'],
  ['ideal', 'ideal', 'low',    'İdeal + İdeal → Düşük (hava sirkülasyonu)'],
  ['ideal', 'humid', 'medium', 'İdeal + Nemli → Orta'],
  ['hot',   'dry',   'medium', 'Sıcak + Kuru → Orta (bitki kurumasın)'],
  ['hot',   'ideal', 'high',   'Sıcak + İdeal → Yüksek'],
  ['hot',   'humid', 'max',    'Sıcak + Nemli → Maksimum (kritik)'],
];

// ============ ANA FONKSİYON ============
/**
 * Fuzzy logic ile fan hızı hesapla
 * @param {number} T - Sıcaklık (°C)
 * @param {number} RH - Bağıl nem (%)
 * @returns {object} { fanSpeed, activeRules, memberships }
 */
export function computeFanSpeed(T, RH) {
  const tMem = tempMembership(T);
  const hMem = humidityMembership(RH);

  // Her kuralın ateşleme gücü = min(T_üyeliği, RH_üyeliği)  (Mamdani AND = min)
  const activeRules = RULES.map(([tSet, hSet, outSet, desc]) => ({
    tSet, hSet, outSet, desc,
    strength: Math.min(tMem[tSet], hMem[hSet]),
    outputValue: FAN_SPEED_LEVELS[outSet],
  }));

  // Ağırlıklı ortalama defuzzifikasyon:
  //   fanSpeed = Σ(strength_i × output_i) / Σ(strength_i)
  let numerator = 0;
  let denominator = 0;
  for (const rule of activeRules) {
    numerator += rule.strength * rule.outputValue;
    denominator += rule.strength;
  }

  const fanSpeed = denominator === 0 ? 0 : Math.round(numerator / denominator);

  return {
    fanSpeed: Math.max(0, Math.min(100, fanSpeed)),
    activeRules: activeRules.filter(r => r.strength > 0),
    memberships: { temperature: tMem, humidity: hMem },
  };
}

// ============ DİLSEL ETİKETLER ============
// UI'da göstermek için en yüksek üyelikli kümeyi döndür
export function getDominantLabel(memberships) {
  const t = memberships.temperature;
  const h = memberships.humidity;
  const tLabel = Object.entries(t).reduce((a, b) => a[1] > b[1] ? a : b)[0];
  const hLabel = Object.entries(h).reduce((a, b) => a[1] > b[1] ? a : b)[0];
  const labels = {
    cold: 'Soğuk', ideal: 'İdeal', hot: 'Sıcak',
    dry: 'Kuru', humid: 'Nemli',
  };
  return { temperature: labels[tLabel], humidity: labels[hLabel] };
}
```

**Test (manuel doğrulama):**
- `computeFanSpeed(35, 90)` → fanSpeed ≈ 95 (sıcak + nemli → max)
- `computeFanSpeed(22, 60)` → fanSpeed ≈ 30 (ideal + ideal → low)
- `computeFanSpeed(10, 40)` → fanSpeed ≈ 10 (soğuk + kuru → off)

---

### Görev 3 — App.jsx Güncellemeleri

**Dosya:** `src/App.jsx` (mevcut dosyayı düzenle)

#### 3.1 — Import satırlarına ekle

```javascript
import { computeFanSpeed, getDominantLabel } from './fuzzyLogic';
```

Mantine importlarına `Tooltip` ekle (üyelik fonksiyonu göstergesi için):
```javascript
import {
  Container, Grid, Paper, Text, Title, Group, Badge, RingProgress,
  Center, ThemeIcon, Stack, Loader, Alert, SimpleGrid, Progress,
  Tooltip  // YENİ
} from '@mantine/core';
```

#### 3.2 — Header'daki "ESP12-E" referansını ESP32 yap

`<Badge size="xl" variant="dot" color="green" p="lg">Sistem Aktif (ESP12-E Online)</Badge>` satırını şununla değiştir:

```javascript
<Badge size="xl" variant="dot" color="green" p="lg">Sistem Aktif (ESP32 Online)</Badge>
```

#### 3.3 — controls state'inde fan_speed ekle

```javascript
const [controls, setControls] = useState({ 
  auto_mode: false, 
  threshold_humidity: 75, 
  status: false,
  fan_speed: 0  // YENİ
});
```

#### 3.4 — Başlangıç state'ini Supabase'den çek (controls'ün tamamını al)

Mevcut `getInitialStatus` fonksiyonunu şununla değiştir:

```javascript
useEffect(() => {
  const getInitialControls = async () => {
    const { data } = await supabase
      .from('device_controls')
      .select('auto_mode, status, threshold_humidity, fan_speed')
      .eq('device_name', 'led_fan')
      .single();
    if (data) setControls(data);
  };
  getInitialControls();
}, []);
```

#### 3.5 — Fuzzy hesabını yapan ve Supabase'e yazan effect ekle

`fetchInitialData` useEffect'inin **altına** yeni bir effect ekle. Bu effect: ölçüm değiştiğinde ve `auto_mode` açıkken, fan hızını yeniden hesaplayıp Supabase'e yazar.

```javascript
// Bulanık mantık → fan hızı hesabı (sadece otomatik mod açıkken)
useEffect(() => {
  if (!controls.auto_mode) return;
  if (!measurements.length) return;

  const last = measurements[measurements.length - 1];
  if (!last || last.temperature == null || last.humidity == null) return;

  const result = computeFanSpeed(last.temperature, last.humidity);
  
  // Eğer hesaplanan değer mevcut fan_speed'den farklıysa güncelle
  if (Math.abs(result.fanSpeed - controls.fan_speed) >= 2) {
    updateDb({ fan_speed: result.fanSpeed });
  }
}, [measurements, controls.auto_mode]);
```

**Not:** `2` birim threshold ile gereksiz Supabase yazımlarını azalttık. Aksi halde her ölçümde 1-2 birimlik dalgalanmalar yazılır.

#### 3.6 — Otomasyon Ayarları panelini güncelle

Mevcut `Otomasyon Ayarları` `<Paper>` bloğunu şununla değiştir:

```javascript
<Paper p="xl" radius="md" withBorder bg="dark.7">
  <Stack>
    <Group justify="space-between">
      <Text fw={700} size="lg">Otomasyon Ayarları</Text>
      <IconPlant color="green" />
    </Group>

    {/* Otomatik Mod Toggle */}
    <Group justify="space-between" bg="dark.6" p="md" style={{ borderRadius: '8px' }}>
      <div>
        <Text fw={600}>Otomatik Mod (Bulanık Mantık)</Text>
        <Text size="xs" c="dimmed">Fan hızı T ve RH'ye göre fuzzy logic ile belirlenir.</Text>
      </div>
      <Switch
        checked={controls.auto_mode}
        onChange={(e) => updateDb({ auto_mode: e.currentTarget.checked })}
        color="green" size="md"
      />
    </Group>

    {/* Manuel Mod: 0-100 slider + on/off switch */}
    <Collapse in={!controls.auto_mode}>
      <Stack p="xs" gap="sm">
        <Group justify="space-between">
          <Text size="sm">Manuel Fan Durumu</Text>
          <Switch
            checked={controls.status}
            onChange={(e) => updateDb({ status: e.currentTarget.checked })}
            color="orange"
          />
        </Group>
        <Box>
          <Text size="sm" mb="xs">Manuel Fan Hızı: %{controls.fan_speed}</Text>
          <Slider
            value={controls.fan_speed}
            onChangeEnd={(val) => updateDb({ fan_speed: val })}
            marks={[{ value: 0 }, { value: 50 }, { value: 100 }]}
            disabled={!controls.status}
            color="orange"
          />
        </Box>
      </Stack>
    </Collapse>

    {/* Otomatik Mod: Mevcut fan hızı + dilsel etiket göstergesi */}
    <Collapse in={controls.auto_mode}>
      <AutoModeIndicator 
        measurements={measurements} 
        fanSpeed={controls.fan_speed} 
      />
    </Collapse>
  </Stack>
</Paper>
```

#### 3.7 — Yeni component: AutoModeIndicator

`MetricCard` component'inin yanına yeni bir component ekle (App component'inin dışında, dosyanın altında):

```javascript
function AutoModeIndicator({ measurements, fanSpeed }) {
  if (!measurements.length) return null;
  const last = measurements[measurements.length - 1];
  if (!last || last.temperature == null) return null;

  const result = computeFanSpeed(last.temperature, last.humidity);
  const labels = getDominantLabel(result.memberships);

  return (
    <Stack gap="sm" p="xs">
      <Group justify="space-between" bg="dark.6" p="md" style={{ borderRadius: '8px' }}>
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Mevcut Fan Hızı</Text>
          <Text fw={900} size="2rem" c="green">%{fanSpeed}</Text>
        </div>
        <Stack gap={2} align="flex-end">
          <Badge color="orange" variant="light">T: {labels.temperature}</Badge>
          <Badge color="blue" variant="light">RH: {labels.humidity}</Badge>
        </Stack>
      </Group>
      <Progress value={fanSpeed} color="green" size="lg" radius="md" />
      <Text size="xs" c="dimmed" ta="center">
        Aktif kural sayısı: {result.activeRules.length} / 9
      </Text>
    </Stack>
  );
}
```

#### 3.8 — Alt bilgide proje versiyonunu güncelle

```javascript
<Text size="sm" c="dimmed">Proje: Sera 2.0 — Bulanık Mantık Tabanlı Kontrol</Text>
```

---

### Görev 4 — Bulanık Mantık Görselleştirme Paneli (Bonus, Sunum İçin Şart)

**Dosya:** Yeni dosya: `src/components/FuzzyVisualization.jsx`

Bu panel üç şey gösterir:
1. Üyelik fonksiyonlarının grafiği (sıcaklık ve nem için)
2. Mevcut ölçümün hangi kümelere ne kadar üye olduğu (dikey çizgi göstergesi)
3. Hangi kuralın ateşlendiği

**Dosya içeriği:**

```javascript
// src/components/FuzzyVisualization.jsx
import { Paper, Text, Stack, Group, Badge, SimpleGrid } from '@mantine/core';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
         ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { tempMembership, humidityMembership, computeFanSpeed } from '../fuzzyLogic';

// Bir aralıkta üyelik fonksiyonlarının değerlerini hesapla (grafik için)
function generateMembershipData(min, max, step, memberFn) {
  const data = [];
  for (let x = min; x <= max; x += step) {
    const m = memberFn(x);
    data.push({ x: Math.round(x * 10) / 10, ...m });
  }
  return data;
}

export default function FuzzyVisualization({ temperature, humidity }) {
  const tempData = generateMembershipData(0, 40, 0.5, tempMembership);
  const humData = generateMembershipData(0, 100, 1, humidityMembership);
  const result = computeFanSpeed(temperature, humidity);

  return (
    <Paper p="xl" radius="md" withBorder bg="dark.7">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={700} size="lg">Bulanık Mantık Analizi</Text>
          <Badge color="green" variant="light">
            Hesaplanan Fan: %{result.fanSpeed}
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {/* SICAKLIK ÜYELİK GRAFİĞİ */}
          <div>
            <Text size="sm" c="dimmed" mb="xs">Sıcaklık Üyelik Fonksiyonları</Text>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={tempData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="x" stroke="#999" 
                       label={{ value: '°C', position: 'insideBottomRight', offset: -5 }} />
                <YAxis stroke="#999" domain={[0, 1]} />
                <Tooltip contentStyle={{ backgroundColor: '#222', border: 'none' }} />
                <Legend />
                <Line type="monotone" dataKey="cold" stroke="#228be6" 
                      name="Soğuk" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="ideal" stroke="#40c057" 
                      name="İdeal" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="hot" stroke="#fa5252" 
                      name="Sıcak" dot={false} strokeWidth={2} />
                <ReferenceLine x={temperature} stroke="#fff" strokeDasharray="3 3" 
                               label={{ value: `${temperature}°C`, fill: '#fff', fontSize: 11 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* NEM ÜYELİK GRAFİĞİ */}
          <div>
            <Text size="sm" c="dimmed" mb="xs">Nem Üyelik Fonksiyonları</Text>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={humData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="x" stroke="#999" 
                       label={{ value: '%RH', position: 'insideBottomRight', offset: -5 }} />
                <YAxis stroke="#999" domain={[0, 1]} />
                <Tooltip contentStyle={{ backgroundColor: '#222', border: 'none' }} />
                <Legend />
                <Line type="monotone" dataKey="dry" stroke="#fab005" 
                      name="Kuru" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="ideal" stroke="#40c057" 
                      name="İdeal" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="humid" stroke="#228be6" 
                      name="Nemli" dot={false} strokeWidth={2} />
                <ReferenceLine x={humidity} stroke="#fff" strokeDasharray="3 3" 
                               label={{ value: `${humidity}%`, fill: '#fff', fontSize: 11 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SimpleGrid>

        {/* AKTİF KURALLAR */}
        <div>
          <Text size="sm" c="dimmed" mb="xs">
            Aktif Kurallar ({result.activeRules.length} / 9)
          </Text>
          <Stack gap={4}>
            {result.activeRules.map((rule, i) => (
              <Group key={i} justify="space-between" bg="dark.6" p="xs" 
                     style={{ borderRadius: '4px' }}>
                <Text size="xs">{rule.desc}</Text>
                <Badge size="sm" variant="light" color="green">
                  güç: {(rule.strength * 100).toFixed(0)}%
                </Badge>
              </Group>
            ))}
          </Stack>
        </div>
      </Stack>
    </Paper>
  );
}
```

**App.jsx'e entegrasyon:**

İmportlara ekle:
```javascript
import FuzzyVisualization from './components/FuzzyVisualization';
```

Grafik Grid'inin **altına** yeni bir bölüm olarak ekle (ALT BİLGİ Paper'ının üstüne):

```javascript
{measurements.length > 0 && (
  <div style={{ marginBottom: '1.5rem' }}>
    <FuzzyVisualization 
      temperature={current.temperature} 
      humidity={current.humidity} 
    />
  </div>
)}
```

---

### Görev 5 — README Güncelleme

**Dosya:** `README.md`

Mevcut Vite boilerplate README'sini şu içerikle değiştir:

```markdown
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
```

---

## ✅ Kabul Kriterleri

1. `npm run dev` hatasız çalışıyor
2. Veritabanına `fan_speed` kolonu eklenmiş, mevcut kayıt 0 değeri ile
3. Header'da "ESP32 Online" yazıyor
4. Otomatik mod açıkken her yeni ölçümde `fan_speed` Supabase'e güncelleniyor (Supabase Dashboard'tan kontrol edilebilir)
5. Manuel modda slider ile 0-100 arası fan hızı ayarlanabiliyor
6. Bulanık Mantık Analizi paneli üyelik grafiklerini ve aktif kuralları gösteriyor
7. Test değerleri ile doğrulama:
   - T=35°C, RH=90% → fan_speed ≈ 90-95
   - T=22°C, RH=60% → fan_speed ≈ 25-35
   - T=10°C, RH=40% → fan_speed ≈ 10-15

---

## 🧪 Manuel Test Senaryosu

1. Supabase Dashboard'tan `measurements` tablosuna manuel bir kayıt ekle: `temperature=32, humidity=85`
2. Frontend'de 5 saniye içinde:
   - Üst kartlarda T ve RH güncellenmiş olmalı
   - VPD kritik uyarısı çıkmalı (VPD > 1.6 olabilir)
   - Bulanık Mantık panelinde "Sıcak" ve "Nemli" badge'leri görünmeli
   - "Sıcak + Nemli → Maksimum" kuralı %100 güçle aktif olmalı
   - Fan hızı %90+ olmalı
3. Manuel moda geç, slider'ı %50'ye al → Supabase'de `fan_speed=50` olmalı

---

## 📝 Notlar

- `updateDb` fonksiyonu `device_controls` tablosundaki ilgili kaydı günceller. Mevcut kod doğru çalışıyor, dokunmaya gerek yok.
- Realtime subscription mevcut, fan_speed değişimi de otomatik gelir.
- Yumuşak geçiş (fan hızı ani değişmesin) ESP32 firmware tarafında zaten var (her 3 sn'de max 5 derece). Frontend tarafında ek bir debouncing gerekmez.
