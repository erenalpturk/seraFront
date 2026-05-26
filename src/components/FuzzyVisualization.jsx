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
