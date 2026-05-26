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
