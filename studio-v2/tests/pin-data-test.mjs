import assert from 'node:assert/strict';
import { allPins, compatiblePins, controllerFamily, pinIsCompatible, validateMappings } from '../pin-data.js';

assert.equal(controllerFamily('STM32F103C8T6'), 'stm32f103');
assert.deepEqual(compatiblePins('STM32F103C8T6', 'SCL', 'I2C'), ['PB6', 'PB8', 'PB10']);
assert.deepEqual(compatiblePins('STM32F103C8T6', 'SDA', 'I2C'), ['PB7', 'PB9', 'PB11']);

assert.equal(controllerFamily('Arduino UNO R3'), 'arduino');
assert.ok(allPins('Arduino UNO R3').includes('D0'));
assert.deepEqual(compatiblePins('Arduino UNO R3', 'TX', 'UART'), ['D1']);
assert.deepEqual(compatiblePins('Arduino UNO R3', 'RX', 'UART'), ['D0']);

assert.equal(controllerFamily('ESP32-WROOM-32'), 'esp32');
assert.ok(allPins('ESP32-WROOM-32').includes('GPIO1'));
assert.ok(compatiblePins('ESP32-WROOM-32', 'TX', 'UART').includes('GPIO1'));
assert.ok(compatiblePins('ESP32-WROOM-32', 'RX', 'UART').includes('GPIO3'));
assert.ok(!compatiblePins('ESP32-WROOM-32', 'CTRL', 'GPIO').includes('GPIO34'));

assert.equal(controllerFamily('STM32F407ZGT6'), 'stm32f407zg');
assert.ok(allPins('STM32F407ZGT6').includes('PG15'));
assert.equal(controllerFamily('STM32F407VET6'), 'stm32f407ve');
assert.ok(!allPins('STM32F407VET6').includes('PG15'));
assert.equal(controllerFamily('STM32H743IIT6'), 'stm32');
assert.deepEqual(allPins('STM32H743IIT6'), []);
assert.equal(pinIsCompatible('STM32H743IIT6', 'PB8', 'SCL', 'I2C'), true);

assert.equal(controllerFamily('STC89C52RC'), 'stc');
assert.deepEqual(compatiblePins('STC89C52RC', 'TX', 'UART'), ['P3.1']);
assert.ok(compatiblePins('STC89C52RC', 'SCL', 'I2C').includes('P1.0'));

assert.equal(controllerFamily('Raspberry Pi Pico RP2040'), 'rp2040');
assert.ok(compatiblePins('Raspberry Pi Pico RP2040', 'SDA', 'I2C').includes('GP0'));
assert.ok(compatiblePins('Raspberry Pi Pico RP2040', 'ADC', 'ADC').includes('GP28'));

const sharedI2c = validateMappings('Arduino UNO', [
  { id: '1', device: 'OLED', signal: 'SCL', interfaceType: 'I2C', pin: 'A5', busGroup: 'I2C', shareAllowed: true },
  { id: '2', device: 'BH1750', signal: 'SCL', interfaceType: 'I2C', pin: 'A5', busGroup: 'I2C', shareAllowed: true },
]);
assert.deepEqual(sharedI2c, []);

console.log(JSON.stringify({ families: ['STM32F103', 'STM32F407ZG', 'STM32F407VE', 'STC51', 'Arduino UNO', 'ESP32', 'RP2040'], status: 'ok' }));
