// src/components/FuzzyVisualization.jsx
import { Fragment } from 'react';
import { Paper, Text, Stack, Group, Badge, SimpleGrid, Box, Tooltip as MTooltip } from '@mantine/core';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
         ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { tempMembership, humidityMembership, computeFanSpeed, getDominantLabel } from '../fuzzyLogic';

// ============ YARDIMCI ============
function generateMembershipData(min, max, step, memberFn) {
  const data = [];
  for (let x = min; x <= max; x += step) {
    const m = memberFn(x);
    data.push({ x: Math.round(x * 10) / 10, ...m });
  }
  return data;
}

// Fan hızı → çıkış kümesi etiketi (renk için)
const OUTPUT_COLORS = {
  off:    '#495057',
  low:    '#228be6',
  medium: '#40c057',
  high:   '#fab005',
  max:    '#fa5252',
};
const OUTPUT_LABELS = {
  off: 'Kapalı', low: 'Düşük', medium: 'Orta', high: 'Yüksek', max: 'Maks',
};

// ============ ANIMASYONLU FAN ============
function AnimatedFan({ fanSpeed }) {
  // fanSpeed (0-100) → rotation duration (s). Yüksek hız = kısa süre.
  // %0 → durur, %100 → 0.3s/tur
  const duration = fanSpeed > 0 ? (6 / (fanSpeed / 100 + 0.1)) : 0;
  const animation = fanSpeed > 0 ? `fuzzyFanSpin ${duration}s linear infinite` : 'none';

  return (
    <Box style={{
      width: 120, height: 120, position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <style>{`
        @keyframes fuzzyFanSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      <svg width="120" height="120" viewBox="0 0 100 100" style={{ animation }}>
        <defs>
          <radialGradient id="fanGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#40c057" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#1e7d32" stopOpacity="0.5" />
          </radialGradient>
        </defs>
        {/* 4 fan kanadı */}
        {[0, 90, 180, 270].map((rot) => (
          <path
            key={rot}
            d="M50,50 Q60,20 50,10 Q40,20 50,50 Z"
            fill="url(#fanGrad)"
            stroke="#2f9e44"
            strokeWidth="1"
            transform={`rotate(${rot} 50 50)`}
          />
        ))}
        {/* Merkez göbek */}
        <circle cx="50" cy="50" r="8" fill="#212529" stroke="#40c057" strokeWidth="2" />
      </svg>
    </Box>
  );
}

// ============ SERVO YARIM DAİRE GAUGE (0-180°) ============
function ServoGauge({ angle }) {
  // Yarım daire: -90° (sol/0°) → +90° (sağ/180°)
  const rad = ((angle - 90) * Math.PI) / 180;
  const cx = 100, cy = 100, r = 80;
  const needleX = cx + r * 0.85 * Math.cos(rad);
  const needleY = cy + r * 0.85 * Math.sin(rad);

  // Renkli arc segmentleri (0-60° yeşil, 60-120° sarı, 120-180° kırmızı)
  // Yarım daire path: M(cx-r,cy) A r,r 0 0,1 (cx+r,cy)
  const arcSeg = (startA, endA, color) => {
    const s = ((startA - 90) * Math.PI) / 180;
    const e = ((endA - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(s);
    const y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cy + r * Math.sin(e);
    return <path d={`M${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2}`} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" />;
  };

  return (
    <Box style={{ width: 200, height: 130, position: 'relative' }}>
      <svg width="200" height="130" viewBox="0 0 200 110">
        {arcSeg(0, 60, '#40c057')}
        {arcSeg(60, 120, '#fab005')}
        {arcSeg(120, 180, '#fa5252')}
        {/* Skala işaretleri */}
        {[0, 45, 90, 135, 180].map((tick) => {
          const tr = ((tick - 90) * Math.PI) / 180;
          const x1 = cx + (r - 14) * Math.cos(tr);
          const y1 = cy + (r - 14) * Math.sin(tr);
          const x2 = cx + (r + 4) * Math.cos(tr);
          const y2 = cy + (r + 4) * Math.sin(tr);
          const tx = cx + (r - 28) * Math.cos(tr);
          const ty = cy + (r - 28) * Math.sin(tr);
          return (
            <g key={tick}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#666" strokeWidth="1" />
              <text x={tx} y={ty} fill="#adb5bd" fontSize="9" textAnchor="middle" dominantBaseline="middle">{tick}°</text>
            </g>
          );
        })}
        {/* İbre — geçişli animasyon için CSS transition */}
        <line
          x1={cx} y1={cy} x2={needleX} y2={needleY}
          stroke="#fff" strokeWidth="3" strokeLinecap="round"
          style={{ transition: 'all 0.5s ease-out' }}
        />
        <circle cx={cx} cy={cy} r="6" fill="#fff" />
      </svg>
      <Text ta="center" fw={900} size="xl" mt={-6}>{angle}°</Text>
    </Box>
  );
}

// ============ KURAL MATRİSİ (3x3 HEATMAP) ============
function RuleMatrix({ activeRules }) {
  const tKeys = ['cold', 'ideal', 'hot'];
  const hKeys = ['dry', 'ideal', 'humid'];
  const tLabels = { cold: 'Soğuk', ideal: 'İdeal', hot: 'Sıcak' };
  const hLabels = { dry: 'Kuru', ideal: 'İdeal', humid: 'Nemli' };

  // Kural çıkış haritası (tSet + hSet → outSet) — fuzzyLogic.js'teki RULES ile aynı
  const RULE_OUTPUTS = {
    'cold-dry': 'off', 'cold-ideal': 'off', 'cold-humid': 'low',
    'ideal-dry': 'off', 'ideal-ideal': 'low', 'ideal-humid': 'medium',
    'hot-dry': 'medium', 'hot-ideal': 'high', 'hot-humid': 'max',
  };

  // Aktif kural gücünü hızlı bulmak için index
  const strengthMap = {};
  activeRules.forEach(r => { strengthMap[`${r.tSet}-${r.hSet}`] = r.strength; });

  return (
    <Box>
      <Text size="sm" c="dimmed" mb="xs">3×3 Kural Matrisi (canlı ateşleme)</Text>
      <Box style={{ display: 'grid', gridTemplateColumns: '60px repeat(3, 1fr)', gap: 4 }}>
        {/* Sol-üst boş köşe */}
        <Box />
        {hKeys.map(h => (
          <Text key={h} size="xs" ta="center" c="dimmed" fw={700} tt="uppercase">{hLabels[h]}</Text>
        ))}
        {tKeys.map(t => (
          <Fragment key={t}>
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ alignSelf: 'center' }}>{tLabels[t]}</Text>
            {hKeys.map(h => {
              const key = `${t}-${h}`;
              const outSet = RULE_OUTPUTS[key];
              const strength = strengthMap[key] || 0;
              const color = OUTPUT_COLORS[outSet];
              return (
                <MTooltip key={key} label={`${tLabels[t]} + ${hLabels[h]} → ${OUTPUT_LABELS[outSet]} (güç: ${(strength * 100).toFixed(0)}%)`}>
                  <Box
                    style={{
                      background: color,
                      opacity: 0.15 + strength * 0.85,
                      borderRadius: 6,
                      padding: '12px 8px',
                      textAlign: 'center',
                      border: strength > 0 ? '2px solid #fff' : '1px solid #444',
                      transition: 'all 0.3s',
                      boxShadow: strength > 0.3 ? `0 0 12px ${color}` : 'none',
                    }}
                  >
                    <Text size="xs" fw={700} c="white">{OUTPUT_LABELS[outSet]}</Text>
                    <Text size="10px" c="white" style={{ opacity: 0.85 }}>{(strength * 100).toFixed(0)}%</Text>
                  </Box>
                </MTooltip>
              );
            })}
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}

// ============ DEFUZZ AKIŞ DİYAGRAMI ============
function DefuzzFlow({ temperature, humidity, activeRules, fanSpeed, labels }) {
  const steps = [
    {
      title: 'Girdi',
      content: (
        <>
          <Text size="sm" c="orange" fw={700}>T: {temperature}°C</Text>
          <Text size="sm" c="blue" fw={700}>RH: {humidity}%</Text>
        </>
      ),
      color: '#868e96',
    },
    {
      title: 'Bulanıklaştırma',
      content: (
        <>
          <Badge size="xs" color="orange" variant="light">{labels.temperature}</Badge>
          <Badge size="xs" color="blue" variant="light" mt={2}>{labels.humidity}</Badge>
        </>
      ),
      color: '#fd7e14',
    },
    {
      title: 'Kural Çıkarımı',
      content: (
        <>
          <Text size="lg" fw={900} c="white">{activeRules.length}</Text>
          <Text size="10px" c="dimmed">/ 9 kural aktif</Text>
        </>
      ),
      color: '#40c057',
    },
    {
      title: 'Ağırlıklı Ort.',
      content: (
        <>
          <Text size="10px" c="dimmed">Σ(güç × çıkış)</Text>
          <Text size="10px" c="dimmed">÷ Σ(güç)</Text>
        </>
      ),
      color: '#228be6',
    },
    {
      title: 'Fan Hızı',
      content: (
        <>
          <Text size="xl" fw={900} c="green">%{fanSpeed}</Text>
        </>
      ),
      color: '#fab005',
    },
  ];

  return (
    <Box>
      <Text size="sm" c="dimmed" mb="xs">Defuzzifikasyon Akışı</Text>
      <Group gap={4} align="stretch" wrap="nowrap" style={{ overflowX: 'auto' }}>
        {steps.map((s, i) => (
          <Fragment key={s.title}>
            <Box
              style={{
                flex: '1 1 0',
                minWidth: 100,
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${s.color}`,
                borderRadius: 8,
                padding: '10px 8px',
                textAlign: 'center',
              }}
            >
              <Text size="10px" c="dimmed" tt="uppercase" fw={700} mb={4}>{s.title}</Text>
              {s.content}
            </Box>
            {i < steps.length - 1 && (
              <Box style={{ display: 'flex', alignItems: 'center', color: '#666', fontSize: 18 }}>→</Box>
            )}
          </Fragment>
        ))}
      </Group>
    </Box>
  );
}

// ============ ANA BİLEŞEN ============
export default function FuzzyVisualization({ temperature, humidity, isOnline = true, timestamp }) {
  const tempData = generateMembershipData(0, 40, 0.5, tempMembership);
  const humData = generateMembershipData(0, 100, 1, humidityMembership);
  const result = computeFanSpeed(temperature, humidity);
  const labels = getDominantLabel(result.memberships);
  const servoAngle = Math.round((result.fanSpeed / 100) * 180);

  return (
    <Paper
      p="xl"
      radius="md"
      withBorder
      style={{
        background: 'linear-gradient(135deg, #0f1923 0%, #1a2332 100%)',
        borderColor: '#40c057',
        borderWidth: 2,
        boxShadow: '0 0 30px rgba(64, 192, 87, 0.15)',
      }}
    >
      <Stack gap="lg">
        {/* BAŞLIK */}
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={900} size="xl" c="green.4">
              🧠 Bulanık Mantık Kontrol Merkezi
            </Text>
            <Text size="xs" c="dimmed">Mamdani çıkarımı · Ağırlıklı ortalama defuzzifikasyon · {result.activeRules.length}/9 aktif kural</Text>
          </div>
          <Group gap="xs">
            {timestamp && (
              <Badge size="lg" color="gray" variant="light">
                {dayjs(timestamp).format('HH:mm:ss')}
              </Badge>
            )}
            <Badge size="lg" color={isOnline ? 'green' : 'red'} variant="filled">
              {isOnline ? 'CANLI' : 'ÇEVRİMDIŞI'}
            </Badge>
          </Group>
        </Group>

        {/* HERO ÜST BAND: Fan + Fan Hızı + Servo Gauge + Etiketler */}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
          {/* Animasyonlu Fan */}
          <Paper p="md" radius="md" bg="dark.8" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb="xs">Fan Çıkışı</Text>
            <AnimatedFan fanSpeed={result.fanSpeed} />
          </Paper>

          {/* Büyük Fan Hızı */}
          <Paper p="md" radius="md" bg="dark.8" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Hesaplanan Hız</Text>
            <Text fw={900} c="green" style={{ fontSize: '4rem', lineHeight: 1 }}>%{result.fanSpeed}</Text>
            <Text size="xs" c="dimmed" mt={4}>fuzzy çıkışı</Text>
          </Paper>

          {/* Servo Gauge */}
          <Paper p="md" radius="md" bg="dark.8" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb="xs">Servo Açısı</Text>
            <ServoGauge angle={servoAngle} />
          </Paper>

          {/* Dilsel Etiketler */}
          <Paper p="md" radius="md" bg="dark.8" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Dilsel Durum</Text>
            <Group gap="xs">
              <Badge size="xl" color="orange" variant="light" style={{ flex: 1, padding: '12px 8px' }}>
                T: {labels.temperature}
              </Badge>
            </Group>
            <Group gap="xs">
              <Badge size="xl" color="blue" variant="light" style={{ flex: 1, padding: '12px 8px' }}>
                RH: {labels.humidity}
              </Badge>
            </Group>
          </Paper>
        </SimpleGrid>

        {/* DEFUZZ AKIŞ */}
        <DefuzzFlow
          temperature={temperature}
          humidity={humidity}
          activeRules={result.activeRules}
          fanSpeed={result.fanSpeed}
          labels={labels}
        />

        {/* KURAL MATRİSİ + ÜYELİK GRAFİKLERİ */}
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <RuleMatrix activeRules={result.activeRules} />

          <div>
            <Text size="sm" c="dimmed" mb="xs">Üyelik Fonksiyonları</Text>
            <Stack gap={4}>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={tempData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="x" stroke="#999" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#999" domain={[0, 1]} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#222', border: 'none', fontSize: 11 }} />
                  <Line type="monotone" dataKey="cold" stroke="#228be6" name="Soğuk" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="ideal" stroke="#40c057" name="İdeal" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="hot" stroke="#fa5252" name="Sıcak" dot={false} strokeWidth={2} />
                  <ReferenceLine x={temperature} stroke="#fff" strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
              <Text size="10px" c="dimmed" ta="center">Sıcaklık ({temperature}°C)</Text>

              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={humData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="x" stroke="#999" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#999" domain={[0, 1]} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#222', border: 'none', fontSize: 11 }} />
                  <Line type="monotone" dataKey="dry" stroke="#fab005" name="Kuru" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="ideal" stroke="#40c057" name="İdeal" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="humid" stroke="#228be6" name="Nemli" dot={false} strokeWidth={2} />
                  <ReferenceLine x={humidity} stroke="#fff" strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
              <Text size="10px" c="dimmed" ta="center">Nem ({humidity}%)</Text>
            </Stack>
          </div>
        </SimpleGrid>

        {/* AKTİF KURALLAR LİSTESİ */}
        <div>
          <Text size="sm" c="dimmed" mb="xs">Aktif Kurallar</Text>
          <Stack gap={4}>
            {result.activeRules.map((rule, i) => (
              <Group key={i} justify="space-between" bg="dark.6" p="xs" style={{ borderRadius: 6, borderLeft: `4px solid ${OUTPUT_COLORS[rule.outSet]}` }}>
                <Text size="xs">{rule.desc}</Text>
                <Badge size="sm" variant="light" style={{ backgroundColor: OUTPUT_COLORS[rule.outSet], color: 'white' }}>
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
