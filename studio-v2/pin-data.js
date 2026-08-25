const STM32_GPIO = [
  'PA0','PA1','PA2','PA3','PA4','PA5','PA6','PA7','PA8','PA9','PA10','PA11','PA12','PA15',
  'PB0','PB1','PB3','PB4','PB5','PB6','PB7','PB8','PB9','PB10','PB11','PB12','PB13','PB14','PB15','PC13','PC14','PC15',
];

const STC_GPIO = [
  'P0.0','P0.1','P0.2','P0.3','P0.4','P0.5','P0.6','P0.7',
  'P1.0','P1.1','P1.2','P1.3','P1.4','P1.5','P1.6','P1.7',
  'P2.0','P2.1','P2.2','P2.3','P2.4','P2.5','P2.6','P2.7',
  'P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P3.7',
];

const ESP32_GPIO = [
  'GPIO2','GPIO4','GPIO5','GPIO12','GPIO13','GPIO14','GPIO15','GPIO16','GPIO17','GPIO18','GPIO19',
  'GPIO21','GPIO22','GPIO23','GPIO25','GPIO26','GPIO27','GPIO32','GPIO33','GPIO34','GPIO35',
];

const ARDUINO_GPIO = ['D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','D12','D13','A0','A1','A2','A3','A4','A5'];

const FAMILIES = Object.freeze({
  stm32f103: {
    pins: STM32_GPIO,
    reserved: ['PA13', 'PA14'],
    capabilities: {
      // STM32F103 的 I2C2 使用 PB10/PB11；不能只列 I2C1 的默认复用脚。
      i2c_scl: ['PB6','PB8','PB10'],
      i2c_sda: ['PB7','PB9','PB11'],
      uart_tx: ['PA2','PA9','PB10'],
      uart_rx: ['PA3','PA10','PB11'],
      spi_sck: ['PA5','PB3','PB13'],
      spi_miso: ['PA6','PB4','PB14'],
      spi_mosi: ['PA7','PB5','PB15'],
      adc: ['PA0','PA1','PA2','PA3','PA4','PA5','PA6','PA7','PB0','PB1'],
      pwm: ['PA0','PA1','PA2','PA3','PA6','PA7','PA8','PA9','PA10','PA11','PA15','PB0','PB1','PB3','PB4','PB5','PB6','PB7','PB8','PB9','PB10','PB11'],
    },
  },
  stm32: { pins: STM32_GPIO, reserved: ['PA13', 'PA14'], capabilities: {} },
  stc: {
    pins: STC_GPIO,
    reserved: [],
    capabilities: {
      uart_tx: ['P3.1'], uart_rx: ['P3.0'], interrupt: ['P3.2','P3.3'],
    },
  },
  esp32: {
    pins: ESP32_GPIO,
    reserved: ['GPIO6','GPIO7','GPIO8','GPIO9','GPIO10','GPIO11'],
    inputOnly: ['GPIO34','GPIO35'],
    capabilities: {
      i2c_scl: ['GPIO22','GPIO18','GPIO19'], i2c_sda: ['GPIO21','GPIO23','GPIO19'],
      uart_tx: ['GPIO17','GPIO1','GPIO25'], uart_rx: ['GPIO16','GPIO3','GPIO26'],
      spi_sck: ['GPIO18','GPIO14'], spi_miso: ['GPIO19','GPIO12'], spi_mosi: ['GPIO23','GPIO13'],
      adc: ['GPIO32','GPIO33','GPIO34','GPIO35','GPIO25','GPIO26','GPIO27'],
    },
  },
  arduino: {
    pins: ARDUINO_GPIO,
    reserved: [],
    capabilities: {
      i2c_scl: ['A5'], i2c_sda: ['A4'], uart_tx: ['D1'], uart_rx: ['D0'],
      spi_sck: ['D13'], spi_miso: ['D12'], spi_mosi: ['D11'], adc: ['A0','A1','A2','A3','A4','A5'],
      pwm: ['D3','D5','D6','D9','D10','D11'],
    },
  },
  generic: { pins: [], reserved: [], capabilities: {} },
});

export function controllerFamily(controller = '') {
  const value = String(controller).toLowerCase();
  if (/stm32f103(?:c8t6|cbt6|rbt6)?/.test(value)) return 'stm32f103';
  if (/stm32/.test(value)) return 'stm32';
  if (/stc|at89|89c5/.test(value)) return 'stc';
  if (/esp32/.test(value)) return 'esp32';
  if (/arduino|atmega328/.test(value)) return 'arduino';
  return 'generic';
}

export function signalCapability(signal = '', interfaceType = '') {
  const value = `${interfaceType} ${signal}`.toLowerCase().replace(/[\\/\-]/g, '_');
  if (/i2c.*(?:scl|时钟)|(?:scl|时钟).*i2c/.test(value)) return 'i2c_scl';
  if (/i2c.*(?:sda|数据)|(?:sda|数据).*i2c/.test(value)) return 'i2c_sda';
  if (/(?:uart|usart|串口).*(?:tx|发送)|(?:tx|发送).*(?:uart|usart|串口)/.test(value)) return 'uart_tx';
  if (/(?:uart|usart|串口).*(?:rx|接收)|(?:rx|接收).*(?:uart|usart|串口)/.test(value)) return 'uart_rx';
  if (/spi.*(?:sck|clk|时钟)|(?:sck|clk|时钟).*spi/.test(value)) return 'spi_sck';
  if (/spi.*miso|miso.*spi/.test(value)) return 'spi_miso';
  if (/spi.*mosi|mosi.*spi/.test(value)) return 'spi_mosi';
  if (/adc|模拟|analog/.test(value)) return 'adc';
  if (/pwm|舵机|调光|调速/.test(value)) return 'pwm';
  if (/interrupt|exti|中断|irq/.test(value)) return 'interrupt';
  return 'gpio';
}

export function compatiblePins(controller, signal, interfaceType = '') {
  const family = FAMILIES[controllerFamily(controller)] || FAMILIES.generic;
  const capability = signalCapability(signal, interfaceType);
  const exact = family.capabilities[capability];
  const base = exact?.length ? exact : family.pins;
  const outputSignal = /输出|ctrl|control|pwm|tx|mosi|sck|scl|cs|rst|en|控制|发送|时钟/i.test(`${signal} ${interfaceType}`);
  return base.filter(pin => !family.reserved?.includes(pin) && !(outputSignal && family.inputOnly?.includes(pin)));
}

export function pinIsCompatible(controller, pin, signal, interfaceType = '') {
  if (!pin || pin === '待确认') return true;
  if (controllerFamily(controller) === 'generic') return true;
  return compatiblePins(controller, signal, interfaceType).includes(String(pin).toUpperCase());
}

export function validateMappings(controller, mappings = []) {
  const issues = [];
  const pinGroups = new Map();
  mappings.forEach(mapping => {
    const pin = String(mapping.pin || '').toUpperCase();
    if (!pin || pin === '待确认') {
      issues.push({ id: mapping.id, type: 'missing', message: `${mapping.device} 的 ${mapping.signal} 尚未选择引脚` });
      return;
    }
    if (mapping.source !== 'schematic' && !pinIsCompatible(controller, pin, mapping.signal, mapping.interfaceType)) {
      issues.push({ id: mapping.id, type: 'incompatible', message: `${mapping.device} 的 ${mapping.signal} 与 ${pin} 不兼容` });
    }
    if (!pinGroups.has(pin)) pinGroups.set(pin, []);
    pinGroups.get(pin).push(mapping);
  });
  pinGroups.forEach((items, pin) => {
    if (items.length < 2) return;
    const sameBus = items.every(item => item.shareAllowed && item.busGroup && item.busGroup === items[0].busGroup && item.signal === items[0].signal);
    if (!sameBus) items.forEach(item => issues.push({ id: item.id, type: 'conflict', message: `${pin} 被多个不允许共用的信号占用` }));
  });
  return issues;
}

export function allPins(controller) {
  return [...(FAMILIES[controllerFamily(controller)]?.pins || [])];
}
