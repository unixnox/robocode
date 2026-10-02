// Names the compiler knows about. The runtime (src/runtime/arduinoApi.ts) must
// provide every function, object and class listed here; tests/runtime.test.ts checks this.

/** Type codes: i32 u32 i16 u16 u8 i8(int8_t) c(char) i64 f(float/double) b(bool) s(String/char*) v(void) any obj */
export type Kind = 'i32' | 'u32' | 'i16' | 'u16' | 'u8' | 'i8' | 'c' | 'i64' | 'f' | 'b' | 's' | 'v' | 'any' | 'obj';

/** Result type of a builtin method or field: a Kind, or 'obj:ClassName' for objects. */
export type RetKind = Kind | `obj:${string}`;

export interface FnInfo { ret: Kind; yields?: boolean; cls?: string }

export const FUNCTIONS: Record<string, FnInfo> = {
  pinMode: { ret: 'v' },
  digitalWrite: { ret: 'v' },
  digitalRead: { ret: 'i32' },
  analogRead: { ret: 'i32' },
  analogReadMilliVolts: { ret: 'i32' },
  analogWrite: { ret: 'v' },
  analogReadResolution: { ret: 'v' },
  analogSetAttenuation: { ret: 'v' },
  ledcSetup: { ret: 'u32' },
  ledcAttachPin: { ret: 'v' },
  ledcAttach: { ret: 'b' },
  ledcAttachChannel: { ret: 'b' },
  ledcDetach: { ret: 'b' },
  ledcDetachPin: { ret: 'v' },
  ledcWrite: { ret: 'v' },
  ledcWriteTone: { ret: 'u32' },
  ledcRead: { ret: 'u32' },
  tone: { ret: 'v' },
  noTone: { ret: 'v' },
  pulseIn: { ret: 'u32', yields: true },
  pulseInLong: { ret: 'u32', yields: true },
  millis: { ret: 'u32' },
  micros: { ret: 'u32' },
  delay: { ret: 'v', yields: true },
  delayMicroseconds: { ret: 'v', yields: true },
  yield: { ret: 'v', yields: true },
  attachInterrupt: { ret: 'v' },
  detachInterrupt: { ret: 'v' },
  digitalPinToInterrupt: { ret: 'i32' },
  interrupts: { ret: 'v' },
  noInterrupts: { ret: 'v' },
  touchRead: { ret: 'u16' },
  hallRead: { ret: 'i32' },
  temperatureRead: { ret: 'f' },
  esp_random: { ret: 'u32' },
  // math
  abs: { ret: 'any' }, min: { ret: 'any' }, max: { ret: 'any' }, constrain: { ret: 'any' },
  map: { ret: 'i32' },
  pow: { ret: 'f' }, sqrt: { ret: 'f' }, sq: { ret: 'any' }, sin: { ret: 'f' }, cos: { ret: 'f' }, tan: { ret: 'f' },
  asin: { ret: 'f' }, acos: { ret: 'f' }, atan: { ret: 'f' }, atan2: { ret: 'f' },
  floor: { ret: 'f' }, ceil: { ret: 'f' }, round: { ret: 'f' }, fabs: { ret: 'f' }, fmod: { ret: 'f' },
  log: { ret: 'f' }, log10: { ret: 'f' }, exp: { ret: 'f' }, isnan: { ret: 'b' }, isinf: { ret: 'b' },
  random: { ret: 'i32' }, randomSeed: { ret: 'v' },
  radians: { ret: 'f' }, degrees: { ret: 'f' },
  bitRead: { ret: 'i32' }, bitSet: { ret: 'i32' }, bitClear: { ret: 'i32' }, bitWrite: { ret: 'i32' }, bit: { ret: 'u32' },
  highByte: { ret: 'u8' }, lowByte: { ret: 'u8' },
  isDigit: { ret: 'b' }, isAlpha: { ret: 'b' }, isAlphaNumeric: { ret: 'b' }, isSpace: { ret: 'b' },
  isUpperCase: { ret: 'b' }, isLowerCase: { ret: 'b' }, isPunct: { ret: 'b' },
  toUpperCase: { ret: 'c' }, toLowerCase: { ret: 'c' },
  atoi: { ret: 'i32' }, atol: { ret: 'i32' }, atof: { ret: 'f' },
  strlen: { ret: 'u32' }, strcmp: { ret: 'i32' },
  dtostrf: { ret: 's' },
  shiftOut: { ret: 'v' },
  shiftIn: { ret: 'u8' },
  getProtocolString: { ret: 's' },
};

/** Methods per builtin class, with return kinds. Unlisted methods are compile errors. */
export const CLASSES: Record<string, Record<string, RetKind>> = {
  HardwareSerial: {
    begin: 'v', end: 'v', print: 'u32', println: 'u32', printf: 'u32', write: 'u32', flush: 'v',
    available: 'i32', read: 'i32', peek: 'i32', readString: 's', readStringUntil: 's',
    parseInt: 'i32', parseFloat: 'f', setTimeout: 'v', availableForWrite: 'i32',
  },
  TwoWire: {
    begin: 'b', setClock: 'v', beginTransmission: 'v', endTransmission: 'u8',
    write: 'u32', read: 'i32', available: 'i32', requestFrom: 'u8', peek: 'i32',
  },
  WiFiClass: {
    begin: 'i32', status: 'i32', localIP: 'obj:IPAddress', mode: 'b', disconnect: 'b', RSSI: 'i32',
    macAddress: 's', SSID: 's', isConnected: 'b', setAutoReconnect: 'b', reconnect: 'b',
    softAP: 'b', softAPIP: 'obj:IPAddress', scanNetworks: 'i32', getHostname: 's', setHostname: 'b',
  },
  EspClass: {
    restart: 'v', getFreeHeap: 'u32', getChipModel: 's', getCpuFreqMHz: 'u32', getChipCores: 'u8',
    getFlashChipSize: 'u32', getEfuseMac: 'i64',
  },
  ESP32PWM: { allocateTimer: 'v' },
  IPAddress: { toString: 's' as RetKind },
  DHT: {
    begin: 'v', readTemperature: 'f', readHumidity: 'f', computeHeatIndex: 'f',
    convertCtoF: 'f', convertFtoC: 'f', read: 'b',
  },
  Servo: {
    attach: 'i32', detach: 'v', write: 'v', writeMicroseconds: 'v', read: 'i32',
    readMicroseconds: 'i32', attached: 'b', setPeriodHertz: 'v',
  },
  Adafruit_SSD1306: {
    begin: 'b', display: 'v', clearDisplay: 'v', invertDisplay: 'v', dim: 'v',
    drawPixel: 'v', getPixel: 'b', drawLine: 'v', drawFastHLine: 'v', drawFastVLine: 'v',
    drawRect: 'v', fillRect: 'v', fillScreen: 'v', drawCircle: 'v', fillCircle: 'v',
    drawRoundRect: 'v', fillRoundRect: 'v', drawTriangle: 'v', fillTriangle: 'v',
    drawBitmap: 'v', drawChar: 'v',
    setTextSize: 'v', setTextColor: 'v', setCursor: 'v', setTextWrap: 'v', setRotation: 'v',
    cp437: 'v', print: 'u32', println: 'u32', printf: 'u32', write: 'u32',
    width: 'i16', height: 'i16', getCursorX: 'i16', getCursorY: 'i16', getRotation: 'u8',
    startscrollright: 'v', startscrollleft: 'v', stopscroll: 'v',
  },
  LiquidCrystal_I2C: {
    init: 'v', begin: 'v', clear: 'v', home: 'v', setCursor: 'v', print: 'u32', println: 'u32',
    printf: 'u32', write: 'u32',
    backlight: 'v', noBacklight: 'v', setBacklight: 'v', display: 'v', noDisplay: 'v',
    cursor: 'v', noCursor: 'v', blink: 'v', noBlink: 'v', createChar: 'v',
    scrollDisplayLeft: 'v', scrollDisplayRight: 'v', leftToRight: 'v', rightToLeft: 'v',
    autoscroll: 'v', noAutoscroll: 'v',
  },
  // ---- 1-Wire: DS18B20
  OneWire: { reset: 'u8', reset_search: 'v' },
  DallasTemperature: {
    begin: 'v', requestTemperatures: 'v', getTempCByIndex: 'f', getTempFByIndex: 'f', getDeviceCount: 'u8',
    getDS18Count: 'u8', setResolution: 'v', getResolution: 'u8', setWaitForConversion: 'v', isConversionComplete: 'b',
    isParasitePowerMode: 'b', toFahrenheit: 'f',
  },
  // ---- MPU6050 (Adafruit_MPU6050)
  Adafruit_MPU6050: {
    begin: 'b', getEvent: 'b', setAccelerometerRange: 'v', getAccelerometerRange: 'i32', setGyroRange: 'v',
    getGyroRange: 'i32', setFilterBandwidth: 'v', getFilterBandwidth: 'i32', setSampleRateDivisor: 'v',
    enableSleep: 'b', enableCycle: 'b', reset: 'v', setMotionDetectionThreshold: 'v', setMotionDetectionDuration: 'v',
    setInterruptPinLatch: 'v', setInterruptPinPolarity: 'v', setMotionInterrupt: 'v', getMotionInterruptStatus: 'b',
  },
  sensors_event_t: {},
  sensors_vec_t: {},
  // ---- IRremote (4.x global objects + legacy API)
  IRrecv: {
    begin: 'v', enableIRIn: 'v', decode: 'b', resume: 'v', printIRResultShort: 'v', printIRSendUsage: 'v',
    start: 'v', stop: 'v', isIdle: 'b', available: 'b',
  },
  IRsend: { begin: 'v', sendNEC: 'v', sendNECRaw: 'v', sendSony: 'v', sendRC5: 'v', sendSamsung: 'v' },
  IRData: {},
  decode_results: {},
  // ---- SD card
  SDFS: {
    begin: 'b', end: 'v', open: 'obj:File', exists: 'b', remove: 'b', mkdir: 'b', rmdir: 'b', rename: 'b',
    cardType: 'u8', cardSize: 'i64', totalBytes: 'i64', usedBytes: 'i64',
  },
  File: {
    name: 's', path: 's', size: 'u32', available: 'i32', read: 'i32', peek: 'i32', readString: 's',
    readStringUntil: 's', print: 'u32', println: 'u32', printf: 'u32', write: 'u32', flush: 'v', close: 'v',
    seek: 'b', position: 'u32', isDirectory: 'b', openNextFile: 'obj:File', rewindDirectory: 'v', getLastWrite: 'u32',
    parseInt: 'i32', parseFloat: 'f',
  },
  SPIClass: { begin: 'v', end: 'v', setFrequency: 'v', beginTransaction: 'v', endTransaction: 'v', transfer: 'u8' },
  // ---- DS1302 RTC (Makuna "Rtc by Makuna" and virtuabotixRTC)
  ThreeWire: {},
  RtcDS1302: {
    Begin: 'v', GetIsWriteProtected: 'b', SetIsWriteProtected: 'v', GetIsRunning: 'b', SetIsRunning: 'v',
    IsDateTimeValid: 'b', GetDateTime: 'obj:RtcDateTime', SetDateTime: 'v', LastError: 'u8',
  },
  RtcDateTime: {
    Year: 'u16', Month: 'u8', Day: 'u8', Hour: 'u8', Minute: 'u8', Second: 'u8', DayOfWeek: 'u8',
    TotalSeconds: 'u32', TotalSeconds64: 'i64', Unix32Time: 'u32', Unix64Time: 'i64', IsValid: 'b',
  },
  virtuabotixRTC: { setDS1302Time: 'v', updateTime: 'v' },
};

/** Data members of builtin classes (struct-like library types). */
export const FIELDS: Record<string, Record<string, RetKind>> = {
  sensors_event_t: {
    acceleration: 'obj:sensors_vec_t', gyro: 'obj:sensors_vec_t', magnetic: 'obj:sensors_vec_t', orientation: 'obj:sensors_vec_t',
    temperature: 'f', timestamp: 'i32',
  },
  sensors_vec_t: { x: 'f', y: 'f', z: 'f', roll: 'f', pitch: 'f', heading: 'f' },
  IRrecv: { decodedIRData: 'obj:IRData' },
  IRData: { protocol: 'i32', address: 'u16', command: 'u16', decodedRawData: 'u32', numberOfBits: 'u16', flags: 'u8', extra: 'u16' },
  decode_results: { value: 'u32', decode_type: 'i32', bits: 'i32', address: 'u16', command: 'u16' },
  virtuabotixRTC: {
    seconds: 'i32', minutes: 'i32', hours: 'i32', dayofweek: 'i32', dayofmonth: 'i32', month: 'i32', year: 'i32',
  },
};

/** Global objects provided by the runtime. */
export const OBJECTS: Record<string, string> = {
  Serial: 'HardwareSerial',
  Serial1: 'HardwareSerial',
  Serial2: 'HardwareSerial',
  Wire: 'TwoWire',
  WiFi: 'WiFiClass',
  ESP: 'EspClass',
  ESP32PWM: 'ESP32PWM',
  IrReceiver: 'IRrecv',
  IrSender: 'IRsend',
  SD: 'SDFS',
  SPI: 'SPIClass',
};

/** Constants and their (numeric) values. */
export const CONSTANTS: Record<string, [number | string, Kind]> = {
  HIGH: [1, 'i32'], LOW: [0, 'i32'],
  INPUT: [1, 'i32'], OUTPUT: [3, 'i32'], INPUT_PULLUP: [5, 'i32'], INPUT_PULLDOWN: [9, 'i32'],
  RISING: [1, 'i32'], FALLING: [2, 'i32'], CHANGE: [3, 'i32'], ONLOW: [4, 'i32'], ONHIGH: [5, 'i32'],
  LED_BUILTIN: [2, 'i32'],
  A0: [36, 'i32'], A3: [39, 'i32'], A4: [32, 'i32'], A5: [33, 'i32'], A6: [34, 'i32'], A7: [35, 'i32'],
  A10: [4, 'i32'], A11: [0, 'i32'], A12: [2, 'i32'], A13: [15, 'i32'], A14: [13, 'i32'], A15: [12, 'i32'],
  A16: [14, 'i32'], A17: [27, 'i32'], A18: [25, 'i32'], A19: [26, 'i32'],
  T0: [4, 'i32'], T1: [0, 'i32'], T2: [2, 'i32'], T3: [15, 'i32'], T4: [13, 'i32'], T5: [12, 'i32'],
  T6: [14, 'i32'], T7: [27, 'i32'], T8: [33, 'i32'], T9: [32, 'i32'],
  DAC1: [25, 'i32'], DAC2: [26, 'i32'], SDA: [21, 'i32'], SCL: [22, 'i32'],
  TX: [1, 'i32'], RX: [3, 'i32'],
  DEC: [10, 'i32'], HEX: [16, 'i32'], OCT: [8, 'i32'], BIN: [2, 'i32'],
  PI: [Math.PI, 'f'], HALF_PI: [Math.PI / 2, 'f'], TWO_PI: [Math.PI * 2, 'f'],
  DEG_TO_RAD: [Math.PI / 180, 'f'], RAD_TO_DEG: [180 / Math.PI, 'f'], EULER: [Math.E, 'f'],
  M_PI: [Math.PI, 'f'],
  LSBFIRST: [0, 'i32'], MSBFIRST: [1, 'i32'],
  DHT11: [11, 'i32'], DHT12: [12, 'i32'], DHT21: [21, 'i32'], DHT22: [22, 'i32'], AM2301: [21, 'i32'],
  SSD1306_SWITCHCAPVCC: [2, 'i32'], SSD1306_EXTERNALVCC: [1, 'i32'],
  SSD1306_WHITE: [1, 'i32'], SSD1306_BLACK: [0, 'i32'], SSD1306_INVERSE: [2, 'i32'],
  WHITE: [1, 'i32'], BLACK: [0, 'i32'], INVERSE: [2, 'i32'],
  WL_IDLE_STATUS: [0, 'i32'], WL_NO_SSID_AVAIL: [1, 'i32'], WL_SCAN_COMPLETED: [2, 'i32'],
  WL_CONNECTED: [3, 'i32'], WL_CONNECT_FAILED: [4, 'i32'], WL_CONNECTION_LOST: [5, 'i32'],
  WL_DISCONNECTED: [6, 'i32'],
  WIFI_STA: [1, 'i32'], WIFI_AP: [2, 'i32'], WIFI_AP_STA: [3, 'i32'], WIFI_OFF: [0, 'i32'],
  ADC_0db: [0, 'i32'], ADC_2_5db: [1, 'i32'], ADC_6db: [2, 'i32'], ADC_11db: [3, 'i32'],
  RAND_MAX: [2147483647, 'i32'],
  INT_MAX: [2147483647, 'i32'], INT_MIN: [-2147483648, 'i32'], UINT_MAX: [4294967295, 'u32'],
  NAN: [NaN, 'f'], INFINITY: [Infinity, 'f'],
  SS: [5, 'i32'], MOSI: [23, 'i32'], MISO: [19, 'i32'], SCK: [18, 'i32'],
  // DallasTemperature
  DEVICE_DISCONNECTED_C: [-127, 'f'], DEVICE_DISCONNECTED_F: [-196.6, 'f'],
  // Adafruit_MPU6050
  MPU6050_RANGE_2_G: [0, 'i32'], MPU6050_RANGE_4_G: [1, 'i32'], MPU6050_RANGE_8_G: [2, 'i32'], MPU6050_RANGE_16_G: [3, 'i32'],
  MPU6050_RANGE_250_DEG: [0, 'i32'], MPU6050_RANGE_500_DEG: [1, 'i32'], MPU6050_RANGE_1000_DEG: [2, 'i32'],
  MPU6050_RANGE_2000_DEG: [3, 'i32'],
  MPU6050_BAND_260_HZ: [0, 'i32'], MPU6050_BAND_184_HZ: [1, 'i32'], MPU6050_BAND_94_HZ: [2, 'i32'], MPU6050_BAND_44_HZ: [3, 'i32'],
  MPU6050_BAND_21_HZ: [4, 'i32'], MPU6050_BAND_10_HZ: [5, 'i32'], MPU6050_BAND_5_HZ: [6, 'i32'],
  MPU6050_I2CADDR_DEFAULT: [0x68, 'i32'],
  // IRremote
  ENABLE_LED_FEEDBACK: [1, 'b'], DISABLE_LED_FEEDBACK: [0, 'b'], USE_DEFAULT_FEEDBACK_LED_PIN: [0, 'i32'],
  UNKNOWN: [0, 'i32'], NEC: [8, 'i32'], NEC2: [9, 'i32'], SONY: [23, 'i32'], RC5: [17, 'i32'], SAMSUNG: [20, 'i32'],
  IRDATA_FLAGS_IS_REPEAT: [1, 'i32'], IRDATA_FLAGS_IS_AUTO_REPEAT: [2, 'i32'], REPEAT: [0xffffffff, 'u32'],
  // SD
  FILE_READ: ['r', 's'], FILE_WRITE: ['w', 's'], FILE_APPEND: ['a', 's'],
  CARD_NONE: [0, 'i32'], CARD_MMC: [1, 'i32'], CARD_SD: [2, 'i32'], CARD_SDHC: [3, 'i32'], CARD_UNKNOWN: [4, 'i32'],
};

/** Libraries (header names) the simulator knows; others produce a warning. */
export const KNOWN_HEADERS = [
  'Arduino.h', 'WiFi.h', 'Wire.h', 'SPI.h', 'DHT.h', 'DHT_U.h', 'Adafruit_Sensor.h', 'ESP32Servo.h', 'Servo.h',
  'Adafruit_GFX.h', 'Adafruit_SSD1306.h', 'LiquidCrystal_I2C.h', 'math.h', 'stdio.h', 'stdlib.h', 'string.h',
  'OneWire.h', 'DallasTemperature.h', 'Adafruit_MPU6050.h', 'IRremote.h', 'IRremote.hpp',
  'SD.h', 'FS.h', 'SPI.h', 'ThreeWire.h', 'RtcDS1302.h', 'virtuabotixRTC.h',
];
