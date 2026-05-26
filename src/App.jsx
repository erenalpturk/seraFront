import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { Switch, Slider, Collapse, Box } from '@mantine/core'; // Yeni bileşenler
import {
  Container, Grid, Paper, Text, Title, Group, Badge, RingProgress,
  Center, ThemeIcon, Stack, Loader, Alert, SimpleGrid, Progress
} from '@mantine/core';
import {
  IconTemperature, IconDroplet, IconGauge, IconAlertTriangle,
  IconPlant, IconWind, IconActivity, IconClock, IconPlugConnectedX
} from '@tabler/icons-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from 'recharts';
import dayjs from 'dayjs';
import { computeFanSpeed, getDominantLabel } from './fuzzyLogic';
import FuzzyVisualization from './components/FuzzyVisualization';

// ESP32, UPLOAD_INTERVAL = 10sn ile veri gönderir. 3x toleransla 30sn'yi geçerse offline kabul edilir.
const ESP_OFFLINE_THRESHOLD_MS = 30000;

// --- GELİŞMİŞ HESAPLAMA MOTORU ---

const GreenhouseEngine = {
  // VPD Hesaplama (Kilopascal)
  getVPD: (T, RH) => {
    const svp = 0.61078 * Math.exp((17.27 * T) / (T + 237.3));
    const vpd = svp * (1 - RH / 100);
    return vpd.toFixed(2);
  },

  // Mutlak Nem (g/m3)
  getAbsoluteHumidity: (T, RH) => {
    const ah = (6.112 * Math.exp((17.67 * T) / (T + 243.5)) * RH * 2.1674) / (273.15 + T);
    return ah.toFixed(2);
  },

  // Bitki Sağlık Skoru (0 - 100)
  getGrowthScore: (T, RH, vpd) => {
    let score = 100;
    if (T < 18 || T > 30) score -= 20;
    if (RH < 40 || RH > 80) score -= 20;
    if (vpd < 0.5 || vpd > 1.5) score -= 30;
    return Math.max(score, 10);
  },

  // Durum Belirleyici
  getStatus: (vpd) => {
    if (vpd < 0.4) return { label: 'Yüksek Nem Riski (Mantar)', color: 'blue' };
    if (vpd >= 0.4 && vpd <= 0.8) return { label: 'Büyüme Başlangıcı', color: 'cyan' };
    if (vpd > 0.8 && vpd <= 1.2) return { label: 'İdeal Koşullar', color: 'green' };
    if (vpd > 1.2 && vpd <= 1.6) return { label: 'Hızlı Transpirasyon', color: 'yellow' };
    return { label: 'Kritik Su Kaybı (Stres)', color: 'red' };
  }
};

function App() {
  const [measurements, setMeasurements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [controls, setControls] = useState({
    auto_mode: false,
    status: false,
    fan_speed: 0, // YENİ: kademeli fan hızı (0-100)
  });
  const [sliderValue, setSliderValue] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const updateDb = async (newValues) => {
    setControls({ ...controls, ...newValues });
    await supabase.from('device_controls').update(newValues).eq('device_name', 'led_fan');
  };

  useEffect(() => {
    const getInitialControls = async () => {
      const { data } = await supabase
        .from('device_controls')
        .select('auto_mode, status, fan_speed')
        .eq('device_name', 'led_fan')
        .single();
      if (data) setControls(data);
    };
    getInitialControls();
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      const { data } = await supabase
        .from('measurements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (data) setMeasurements(data.reverse());
      setLoading(false);
    };

    fetchInitialData();

    // 2. REALTIME ABONELİĞİ (Kritik Kısım)
    const channel = supabase
      .channel('db-changes') // Kanal adı rastgele olabilir
      .on(
        'postgres_changes',
        {
          event: 'INSERT', // Sadece yeni eklenen verileri dinle
          schema: 'public',
          table: 'measurements',
        },
        (payload) => {
          console.log('Yeni veri yakalandı!', payload.new);
          // Yeni gelen veriyi mevcut listeye ekle
          setMeasurements((prev) => {
            const updatedList = [...prev, payload.new];
            // Liste çok uzamasın diye son 50 tanesini tut
            return updatedList.slice(-50);
          });
        }
      )
      .subscribe((status) => {
        console.log('Realtime bağlantı durumu:', status);
      });

    // 3. Cleanup: Sayfa kapandığında aboneliği bitir
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // fan_speed dış kaynaktan (DB initial fetch / auto mode write) değişince slider'ı senkronla
  useEffect(() => {
    setSliderValue(controls.fan_speed);
  }, [controls.fan_speed]);

  // Bulanık mantık → fan hızı hesabı (sadece otomatik mod açıkken)
  useEffect(() => {
    if (!controls.auto_mode) return;
    if (!measurements.length) return;

    const last = measurements[measurements.length - 1];
    if (!last || last.temperature == null || last.humidity == null) return;

    const result = computeFanSpeed(last.temperature, last.humidity);

    // Eğer hesaplanan değer mevcut fan_speed'den farklıysa güncelle
    // (2 birim threshold ile gereksiz Supabase yazımlarını azaltıyoruz)
    if (Math.abs(result.fanSpeed - controls.fan_speed) >= 2) {
      updateDb({ fan_speed: result.fanSpeed });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurements, controls.auto_mode]);

  const current = measurements[measurements.length - 1] || { temperature: 0, humidity: 0 };
  const lastMeasurementMs = current.created_at ? new Date(current.created_at).getTime() : null;
  const isEspOnline = lastMeasurementMs !== null && (now - lastMeasurementMs) < ESP_OFFLINE_THRESHOLD_MS;
  const offlineForSec = lastMeasurementMs !== null ? Math.floor((now - lastMeasurementMs) / 1000) : null;
  const vpd = GreenhouseEngine.getVPD(current.temperature, current.humidity);
  const ah = GreenhouseEngine.getAbsoluteHumidity(current.temperature, current.humidity);
  const score = GreenhouseEngine.getGrowthScore(current.temperature, current.humidity, vpd);
  const status = GreenhouseEngine.getStatus(vpd);

  if (loading) return <Center h="100vh"><Loader size="xl" color="green" /></Center>;

  return (
    <Container size="xl" py="xl" bg="#0a0a0a" style={{ minHeight: '100vh', color: 'white' }}>

      {/* HEADER */}
      <Group justify="space-between" mb="xl">
        <div>
          <Title order={1} c="green.5" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="greenhouse.png" alt="Greenhouse" style={{ width: '40px', height: '40px' }} /> Sera Akıllı Takip Sistemi
          </Title>
          <Text c="dimmed">IoT Tabanlı Gerçek Zamanlı Bitki Sağlığı Analizi</Text>
        </div>
        <Badge
          size="xl"
          variant="dot"
          color={isEspOnline ? 'green' : 'red'}
          p="lg"
        >
          {isEspOnline ? 'Sistem Aktif (ESP32 Online)' : 'ESP32 Çevrimdışı'}
        </Badge>
      </Group>

      {/* ESP OFFLINE UYARISI */}
      {!isEspOnline && (
        <Alert icon={<IconPlugConnectedX size="1rem" />} title="ESP32 Bağlantısı Yok" color="red" mb="xl">
          {lastMeasurementMs === null
            ? 'Henüz hiçbir ölçüm verisi alınmadı. ESP32\'nin çalıştığını ve WiFi\'a bağlandığını kontrol edin.'
            : `Son ölçümün üzerinden ${offlineForSec} sn geçti (eşik ${ESP_OFFLINE_THRESHOLD_MS / 1000} sn). Gösterilen değerler güncel olmayabilir.`}
        </Alert>
      )}

      {/* KRİTİK UYARI PANELİ */}
      {isEspOnline && vpd > 1.6 && (
        <Alert icon={<IconAlertTriangle size="1rem" />} title="Kritik Uyarı!" color="red" mb="xl">
          Hava çok kuru! Bitkiler su kaybediyor, acil nemlendirme önerilir.
        </Alert>
      )}

      {/* BULANIK MANTIK KONTROL MERKEZİ — HERO */}
      {measurements.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <FuzzyVisualization
            temperature={current.temperature}
            humidity={current.humidity}
            isOnline={isEspOnline}
            timestamp={current.created_at}
          />
        </div>
      )}

      {/* ANA METRİKLER */}
      <Group justify="flex-end" mb="xs">
        <Paper
          py={4}
          px={12}
          radius="xl"
          bg="rgba(255, 255, 255, 0.05)"
          style={{
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <IconClock size={14} color="#adb5bd" />
          <Text size="xs" c="dimmed" fw={600}>
            {current.created_at ? dayjs(current.created_at).format('HH:mm') : '--:--'}
          </Text>
        </Paper>
      </Group>
      <SimpleGrid cols={{ base: 1, md: 3 }} mb="xl">
        <MetricCard label="Sıcaklık" value={current.temperature} unit="°C" color="orange" icon={<IconTemperature size={32} />} />
        <MetricCard label="Nem" value={current.humidity} unit="%" color="blue" icon={<IconDroplet size={32} />} />
        <MetricCard label="VPD (Buhar Basıncı)" value={vpd} unit=" kPa" color={status.color} icon={<IconGauge size={32} />} />
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
                  <Group justify="space-between" mb="xs">
                    <Text size="sm">Manuel Fan Hızı: %{sliderValue}</Text>
                    <Text size="sm" c="dimmed">Servo Açısı: {Math.round((sliderValue / 100) * 180)}°</Text>
                  </Group>
                  <Slider
                    value={sliderValue}
                    onChange={setSliderValue}
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
      </SimpleGrid>

      <Grid mb="xl">
        {/* SOL KOLON: ANALİZLER */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack>
            <Paper p="xl" radius="md" withBorder bg="dark.7">
              <Text fw={700} mb="xs">Bitki Sağlık Skoru</Text>
              <Group justify="center">
                <RingProgress
                  size={160} thickness={16} roundCaps
                  sections={[{ value: score, color: status.color }]}
                  label={<Center><Text fw={900} size="xl">{score}%</Text></Center>}
                />
              </Group>
              <Text ta="center" mt="sm" fw={700} c={status.color}>{status.label}</Text>
            </Paper>

            <Paper p="xl" radius="md" withBorder bg="dark.7">
              <Group justify="space-between" mb="xs">
                <Text fw={700}>Mutlak Nem (g/m³)</Text>
                <IconWind c="cyan" />
              </Group>
              <Text size="h2" fw={900}>{ah} g/m³</Text>
              <Text size="xs" c="dimmed">1 metreküp havadaki gerçek su ağırlığı.</Text>
            </Paper>
          </Stack>
        </Grid.Col>

        {/* SAĞ KOLON: GRAFİKLER */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Paper p="xl" radius="md" withBorder bg="dark.7" h="100%">
            <Text fw={700} mb="xl">Sıcaklık ve Nem Geçmişi</Text>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={measurements}>
                <defs>
                  <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fd7e14" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#fd7e14" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="created_at" tickFormatter={t => dayjs(t).format('HH:mm')} />
                <YAxis stroke="#999" />
                <Tooltip contentStyle={{ backgroundColor: '#222' }} />
                <Area type="monotone" dataKey="temperature" stroke="#fd7e14" fillOpacity={1} fill="url(#colorTemp)" />
                <Area type="monotone" dataKey="humidity" stroke="#228be6" fillOpacity={0.1} fill="#228be6" />
              </AreaChart>
            </ResponsiveContainer>
          </Paper>
        </Grid.Col>
      </Grid>

      {/* ALT BİLGİ */}
      <Paper p="md" withBorder bg="dark.8">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">Proje: Sera 2.0 — Bulanık Mantık Tabanlı Kontrol</Text>
          <Text size="sm" c="dimmed">Son Veri: {dayjs(current.created_at).format('HH:mm:ss')}</Text>
        </Group>
      </Paper>
    </Container>
  );
}

function AutoModeIndicator({ measurements, fanSpeed }) {
  if (!measurements.length) return null;
  const last = measurements[measurements.length - 1];
  if (!last || last.temperature == null) return null;

  const result = computeFanSpeed(last.temperature, last.humidity);
  const labels = getDominantLabel(result.memberships);
  const servoAngle = Math.round((fanSpeed / 100) * 180);

  return (
    <Stack gap="sm" p="xs">
      <Group justify="space-between" bg="dark.6" p="md" style={{ borderRadius: '8px' }} align="center">
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Fan Hızı</Text>
          <Text fw={900} size="2rem" c="green">%{fanSpeed}</Text>
        </Stack>
        <Stack gap={2} align="center">
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Servo Açısı</Text>
          <Text fw={900} size="2rem" c="cyan">{servoAngle}°</Text>
        </Stack>
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

function MetricCard({ label, value, unit, color, icon }) {
  return (
    <Paper p="xl" radius="md" withBorder bg="dark.7" style={{ borderLeft: `6px solid var(--mantine-color-${color}-6)` }}>
      <Group justify="space-between">
        <Stack gap={0}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
          <Text fw={900} size="3rem">{value}<small style={{ fontSize: '1rem' }}>{unit}</small></Text>
        </Stack>
        <ThemeIcon size={50} radius="md" color={color} variant="light">{icon}</ThemeIcon>
      </Group>
    </Paper>
  );
}

export default App;