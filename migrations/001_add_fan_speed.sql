-- device_controls tablosuna fan_speed kolonu ekle
ALTER TABLE device_controls
  ADD COLUMN IF NOT EXISTS fan_speed INTEGER DEFAULT 0
  CHECK (fan_speed BETWEEN 0 AND 100);

-- Mevcut kaydı 0 değeriyle güncelle
UPDATE device_controls SET fan_speed = 0 WHERE device_name = 'led_fan';
