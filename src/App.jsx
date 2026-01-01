import { useEffect, useState, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { Switch, Slider, Collapse, Box } from '@mantine/core'; // Yeni bileşenler
import {
  Container, Grid, Paper, Text, Title, Group, Badge, RingProgress,
  Center, ThemeIcon, Stack, Loader, Alert, SimpleGrid, Progress
} from '@mantine/core';
import {
  IconTemperature, IconDroplet, IconGauge, IconAlertTriangle,
  IconPlant, IconWind, IconActivity
} from '@tabler/icons-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from 'recharts';
import dayjs from 'dayjs';

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
  const [fanActive, setFanActive] = useState(false);
  const [controls, setControls] = useState({ auto_mode: false, threshold_humidity: 75, status: false });

  const fetchControls = async () => {
    const { data } = await supabase.from('device_controls').select('*').eq('device_name', 'led_fan').single();
    if (data) setControls(data);
  };

  // Güncelleme fonksiyonu
  const updateDb = async (newValues) => {
    setControls({ ...controls, ...newValues });
    await supabase.from('device_controls').update(newValues).eq('device_name', 'led_fan');
  };
  useEffect(() => {
    const getInitialStatus = async () => {
      const { data } = await supabase
        .from('device_controls')
        .select('status')
        .eq('device_name', 'led_fan')
        .single();
      if (data) setFanActive(data.status);
    };
    getInitialStatus();
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

  const current = measurements[measurements.length - 1] || { temperature: 0, humidity: 0 };
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
            <IconPlant size={40} /> SERA AKILLI TAKİP SİSTEMİ
          </Title>
          <Text c="dimmed">IoT Tabanlı Gerçek Zamanlı Bitki Sağlığı Analizi</Text>
        </div>
        <Badge size="xl" variant="dot" color="green" p="lg">Sistem Aktif (ESP12-E Online)</Badge>
      </Group>

      {/* KRİTİK UYARI PANELİ */}
      {vpd > 1.6 && (
        <Alert icon={<IconAlertTriangle size="1rem" />} title="Kritik Uyarı!" color="red" mb="xl">
          Hava çok kuru! Bitkiler su kaybediyor, acil nemlendirme önerilir.
        </Alert>
      )}

      {/* ANA METRİKLER */}
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

            <Group justify="space-between" bg="dark.6" p="md" style={{ borderRadius: '8px' }}>
              <div>
                <Text fw={600}>Otomatik Mod</Text>
                <Text size="xs" c="dimmed">Sistem verilere göre karar verir.</Text>
              </div>
              <Switch
                checked={controls.auto_mode}
                onChange={(e) => updateDb({ auto_mode: e.currentTarget.checked })}
                color="green" size="md"
              />
            </Group>

            {/* Manuel Kontrol (Sadece Otomatik Mod Kapalıyken Aktif) */}
            <Collapse in={!controls.auto_mode}>
              <Group justify="space-between" p="xs">
                <Text size="sm">Manuel Fan Kontrolü</Text>
                <Switch
                  checked={controls.status}
                  onChange={(e) => updateDb({ status: e.currentTarget.checked })}
                  color="orange"
                />
              </Group>
            </Collapse>

            {/* Eşik Ayarı (Sadece Otomatik Mod Açıkken Anlamlı) */}
            <Collapse in={controls.auto_mode}>
              <Box p="xs">
                <Text size="sm" mb="xs">Nem Eşik Değeri: %{controls.threshold_humidity}</Text>
                <Slider
                  value={controls.threshold_humidity}
                  onChangeEnd={(val) => updateDb({ threshold_humidity: val })}
                  marks={[{ value: 40 }, { value: 60 }, { value: 80 }]}
                  label={(val) => `%${val}`}
                />
                <Text size="xs" c="dimmed" mt="sm">
                  Nem bu değerin üzerine çıkarsa fan otomatik olarak çalışacaktır.
                </Text>
              </Box>
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
          <Text size="sm" c="dimmed">Proje: Akıllı Sera İzleme v2.0</Text>
          <Text size="sm" c="dimmed">Son Veri: {dayjs(current.created_at).format('HH:mm:ss')}</Text>
        </Group>
      </Paper>
    </Container>
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