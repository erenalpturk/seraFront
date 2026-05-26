/*
 * Sera 2.0 — ESP32 Firmware
 * 
 * Bulanık Mantık Tabanlı Akıllı Sera Kontrol Sistemi
 * 
 * Donanım:
 *   - ESP32 DevKit V1
 *   - DHT22 (sıcaklık + nem) → GPIO 4
 *   - SG90 Servo (fan temsili)  → GPIO 18
 * 
 * Mimari:
 *   - DHT22'den 5 sn'de bir ölçüm al, hareketli ortalama uygula
 *   - 10 sn'de bir Supabase'e POST (measurements tablosu)
 *   - 3 sn'de bir Supabase'den fan_speed, auto_mode, status çek
 *   - Servo'yu fan_speed (0-100) → açı (0-180°) olarak konumla
 *   - WiFi koparsa otomatik bağlan
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <ESP32Servo.h>

// =================== KONFIGÜRASYON ===================
// !! Bu kısımları kendi bilgilerinle doldur !!

const char* WIFI_SSID     = "Alpren";
const char* WIFI_PASSWORD = "alperen2";

const char* SUPABASE_URL  = "https://dhpviwzhehzbcuynfxcv.supabase.co";
const char* SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRocHZpd3poZWh6YmN1eW5meGN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwODIzOTQsImV4cCI6MjA4MjY1ODM5NH0.Nx6Qd7e2-qbnW7jndiUlS9tnVAGG3w7xD1F5IrZdFWs";  // anon public key

const char* DEVICE_NAME   = "led_fan";  // device_controls tablosundaki kayıt

// =================== PIN TANIMLARI ===================
#define DHT_PIN    4
#define DHT_TYPE    DHT22
#define SERVO_PIN   18

// =================== ZAMANLAMA (ms) ===================
const unsigned long SENSOR_READ_INTERVAL   = 5000;   // 5 sn
const unsigned long CONTROL_FETCH_INTERVAL = 3000;   // 3 sn
const unsigned long UPLOAD_INTERVAL        = 10000;  // 10 sn

// =================== HAREKETLİ ORTALAMA ===================
#define MA_SIZE 5
float tempBuffer[MA_SIZE] = {0};
float humBuffer[MA_SIZE]  = {0};
int   bufferIndex   = 0;
bool  bufferFilled  = false;

// =================== GLOBAL DURUM ===================
DHT dht(DHT_PIN, DHT_TYPE);
Servo fanServo;

float currentTemp     = 0;
float currentHumidity = 0;

int  currentFanSpeed = 0;     // 0-100, frontend'den gelen
bool autoMode        = false;
bool manualStatus    = false;

unsigned long lastSensorRead   = 0;
unsigned long lastControlFetch = 0;
unsigned long lastUpload       = 0;

int currentServoAngle = 0;  // Yumuşak geçiş için son uygulanan açı

// =================== SETUP ===================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Sera 2.0 ESP32 Başlatılıyor ===");

  // DHT22 başlat
  dht.begin();

  // Servo başlat (ESP32Servo kütüphanesi PWM kanalı kullanır)
  ESP32PWM::allocateTimer(0);
  fanServo.setPeriodHertz(50);           // SG90 standart 50Hz PWM
  fanServo.attach(SERVO_PIN, 500, 2400); // 500us-2400us pulse aralığı
  fanServo.write(0);                     // Başlangıçta kapalı

  // WiFi
  connectWiFi();
  Serial.println("Sistem hazır, döngü başlıyor.\n");
}

// =================== ANA DÖNGÜ ===================
void loop() {
  unsigned long now = millis();

  // WiFi sağlık kontrolü
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠ WiFi koptu, yeniden bağlanılıyor...");
    connectWiFi();
  }

  // Sensör okuma
  if (now - lastSensorRead > SENSOR_READ_INTERVAL) {
    lastSensorRead = now;
    readSensor();
  }

  // Kontrol verisi çekme + servo güncelleme
  if (now - lastControlFetch > CONTROL_FETCH_INTERVAL) {
    lastControlFetch = now;
    fetchControls();
    applyServoPosition();
  }

  // Veri yükleme
  if (now - lastUpload > UPLOAD_INTERVAL) {
    lastUpload = now;
    if (bufferFilled || bufferIndex > 0) {
      uploadMeasurement();
    }
  }
}

// =================== WiFi ===================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi'a bağlanılıyor");

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\n✓ Bağlandı. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n✗ Bağlantı başarısız. 10sn sonra tekrar.");
    delay(10000);
  }
}

// =================== DHT22 OKUMA ===================
void readSensor() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t) || isnan(h)) {
    Serial.println("✗ DHT22 okuma hatası (NaN)");
    return;
  }

  // Hareketli ortalama buffer'a ekle
  tempBuffer[bufferIndex] = t;
  humBuffer[bufferIndex]  = h;
  bufferIndex = (bufferIndex + 1) % MA_SIZE;
  if (bufferIndex == 0) bufferFilled = true;

  // Ortalama hesabı
  int count = bufferFilled ? MA_SIZE : bufferIndex;
  if (count == 0) count = 1;

  float tSum = 0, hSum = 0;
  for (int i = 0; i < count; i++) {
    tSum += tempBuffer[i];
    hSum += humBuffer[i];
  }
  currentTemp     = tSum / count;
  currentHumidity = hSum / count;

  Serial.printf("📊 T: %.1f°C  H: %.1f%%  (ham: %.1f / %.1f)\n",
                currentTemp, currentHumidity, t, h);
}

// =================== SUPABASE: KONTROL ÇEK ===================
void fetchControls() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SUPABASE_URL) +
               "/rest/v1/device_controls?device_name=eq." + DEVICE_NAME +
               "&select=fan_speed,auto_mode,status";

  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err && doc.is<JsonArray>() && doc.size() > 0) {
      JsonObject obj = doc[0];
      currentFanSpeed = obj["fan_speed"] | 0;
      autoMode        = obj["auto_mode"] | false;
      manualStatus    = obj["status"]    | false;
      Serial.printf("🎛  Kontrol: auto=%d, speed=%d%%, manual=%d\n",
                    autoMode, currentFanSpeed, manualStatus);
    }
  } else {
    Serial.printf("✗ Kontrol HTTP hata: %d\n", code);
  }
  http.end();
}

// =================== SERVO UYGULA ===================
void applyServoPosition() {
  int targetSpeed;

  if (autoMode) {
    // Otomatik mod: frontend'in fuzzy logic ile hesapladığı değeri kullan
    targetSpeed = currentFanSpeed;
  } else {
    // Manuel mod: status off ise 0, on ise kullanıcının verdiği fan_speed
    targetSpeed = manualStatus ? currentFanSpeed : 0;
  }

  targetSpeed = constrain(targetSpeed, 0, 100);
  int targetAngle = map(targetSpeed, 0, 100, 0, 180);

  // Yumuşak geçiş (her seferinde max 5 derece) — servoyu zorlamamak için
  if (targetAngle > currentServoAngle) {
    currentServoAngle = min(currentServoAngle + 5, targetAngle);
  } else if (targetAngle < currentServoAngle) {
    currentServoAngle = max(currentServoAngle - 5, targetAngle);
  }

  fanServo.write(currentServoAngle);
}

// =================== SUPABASE: ÖLÇÜM YÜKLE ===================
void uploadMeasurement() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/measurements";

  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<128> doc;
  doc["temperature"] = round(currentTemp     * 10) / 10.0;
  doc["humidity"]    = round(currentHumidity * 10) / 10.0;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code == 201 || code == 200 || code == 204) {
    Serial.println("☁ Veri gönderildi ✓");
  } else {
    Serial.printf("✗ Upload hata: %d — %s\n", code, body.c_str());
  }
  http.end();
}
