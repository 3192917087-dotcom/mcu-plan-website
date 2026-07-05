/* ============================================================
 * device-library.js (v3)
 * 器件库：基于 v2 devices-v2.txt 整理
 * 来源：56 个历史方案扫描整合
 * 规则：AI 生成方案时优先从这里选，没有再自由发挥
 * ============================================================ */

const DeviceLibrary = (() => {
  const CATEGORIES = [
    {
      name: '传感器',
      sub: [
        {
          name: '温度传感器',
          items: [
            { name: 'DS18B20', desc: '单总线 · 防水版可选' },
            { name: 'DHT11', desc: '温湿度 · 入门级' },
            { name: 'DHT22', desc: '温湿度 · 精度更高' },
          ],
        },
        {
          name: '气体传感器',
          items: [
            { name: 'MQ-2', desc: '烟雾 · 可燃气体' },
            { name: 'MQ-3', desc: '酒精 · 酒后检测' },
            { name: 'MQ-5', desc: '燃气 · 厨房安全' },
            { name: 'MQ-7', desc: '一氧化碳 · 煤气中毒' },
            { name: 'MQ-9', desc: '煤气 · 室内污染' },
            { name: 'MQ-135', desc: '空气质量 · 氨气/苯' },
          ],
        },
        {
          name: '光学传感器',
          items: [
            { name: 'GL5528', desc: '光敏电阻 · 光照检测' },
            { name: 'TCS34725', desc: '颜色识别 · RGB' },
            { name: 'GP2Y1014AU', desc: '粉尘 · PM2.5' },
            { name: 'S12SD', desc: '红外线强度' },
          ],
        },
        {
          name: '距离/测距',
          items: [
            { name: 'HC-SR04', desc: '超声波 · 测距 2-400cm' },
          ],
        },
        {
          name: '人体感应',
          items: [
            { name: 'HC-SR501', desc: '红外热释电 · 学生项目首选 · ¥3-5' },
            { name: 'HLK-LD2410', desc: '24GHz 毫米波雷达 · 人体存在/微动/静止' },
          ],
        },
        {
          name: '生物识别',
          items: [
            { name: 'MAX30102', desc: '心率+血氧 · I2C' },
            { name: 'RC522', desc: 'RFID 读卡 · 13.56MHz' },
            { name: 'ITR20001', desc: '红外反射 · 循迹/避障' },
            { name: 'AS608', desc: '指纹识别 · 串口' },
          ],
        },
        {
          name: '浊度传感器',
          items: [
            { name: 'LM393', desc: '声音光度 · 模拟信号' },
            { name: 'TDS', desc: '水浊 · 总溶解固' },
            { name: 'TS-300B', desc: '浊度 · 水清洁度' },
            { name: 'ZJ-S201C', desc: '霍尔水流 · 流量计' },
          ],
        },
        {
          name: '称重/压力',
          items: [
            { name: 'HX711', desc: '称重 · 24位 ADC' },
          ],
        },
        {
          name: '液位/水位',
          items: [
            { name: 'TP508', desc: '电阻式水位 · 学生项目首选' },
          ],
        },
        {
          name: '运动传感器',
          items: [
            { name: 'MPU6050', desc: '六轴 · 加速度+陀螺仪' },
            { name: 'SW-520D', desc: '倾倒开关 · 跌倒/震动' },
            { name: 'SW-18010', desc: '倾倒 · 高灵敏度' },
            { name: 'PulseSensor', desc: '心率 · 模拟信号' },
          ],
        },
      ],
    },
    {
      name: '执行机构',
      sub: [
        {
          name: '执行器',
          items: [
            { name: 'SG90', desc: '舵机 · 9g 小扭矩' },
            { name: '蜂鸣器', desc: '有源 · 提示音' },
            { name: 'LED', desc: '指示灯 · 红绿黄' },
            { name: '5V 继电器', desc: '单路 · 通用' },
            { name: '继电器+水泵', desc: '抽水/排水' },
            { name: '继电器+风扇', desc: '散热/通风' },
            { name: '继电器+加热片', desc: '加热' },
            { name: '步进电机', desc: '精确角度' },
            { name: '电磁锁', desc: '门锁控制' },
            { name: '按键', desc: '独立按钮 · 输入' },
            { name: '4x4 矩阵键盘', desc: '密码输入' },
          ],
        },
      ],
    },
    {
      name: '通信',
      sub: [
        {
          name: '无线通信',
          items: [
            { name: 'HC-05', desc: '蓝牙 · 短距离' },
            { name: 'ESP-01S', desc: 'WiFi · 需联网' },
            { name: 'NRF24L01', desc: '2.4G · 点对点' },
          ],
        },
        {
          name: '通信模块',
          items: [
            { name: 'SIM7600', desc: '4G 全网通 · 支持短信/通话/GPS' },
          ],
        },
        {
          name: '定位模块',
          items: [
            { name: 'NEO-6M', desc: 'GPS · 室外定位' },
            { name: 'NEO-7M', desc: 'GPS · 精度更高' },
          ],
        },
        {
          name: '声模块',
          items: [
            { name: 'LM2904', desc: '声音检测 · 模拟' },
            { name: 'ASRPRO', desc: '语音识别 · 离线词条' },
            { name: 'JQ8900', desc: '语音播放 · MP3 模块' },
          ],
        },
      ],
    },
    {
      name: '主控',
      sub: [
        {
          name: '主控芯片',
          items: [
            { name: 'STM32F103C8T6', desc: 'ARM 32位 · 性能强 · 项目主力' },
            { name: 'STC89C52', desc: '51 内核 · 简单项目' },
            { name: 'Arduino Uno', desc: 'AVR 8位 · 容易上手' },
            { name: 'ESP32', desc: '自带 WiFi+蓝牙 · 物联网项目' },
          ],
        },
      ],
    },
    {
      name: '电源/显示',
      sub: [
        {
          name: '稳压芯片',
          items: [
            { name: 'AMS1117-5', desc: '5V 稳压 · 12V 转 5V' },
            { name: 'AMS1117-3.3', desc: '3.3V 稳压 · 主控供电' },
          ],
        },
        {
          name: '显示器',
          items: [
            { name: 'OLED 0.96寸', desc: 'I2C 接口 · 推荐' },
            { name: 'LCD1602', desc: '字符显示 · 简单项目' },
          ],
        },
        {
          name: '存储芯片',
          items: [
            { name: 'AT24C02', desc: 'EEPROM · 掉电保存密码' },
            { name: 'DS1302', desc: '时钟 · 带电池' },
          ],
        },
      ],
    },
    {
      name: '电机驱动',
      sub: [
        {
          name: '驱动',
          items: [
            { name: 'TB6612', desc: '双路直流 · PWM 调节' },
            { name: 'L298N', desc: '双路直流 · 大电流' },
            { name: 'L2003N', desc: '步进电机驱动' },
          ],
        },
      ],
    },
  ];

  function getAll() {
    const all = [];
    CATEGORIES.forEach(cat => {
      cat.sub.forEach(sub => {
        sub.items.forEach(item => {
          all.push({ ...item, category: cat.name, subcategory: sub.name });
        });
      });
    });
    return all;
  }

  function getText() {
    let lines = ['# 器件库（v3）', '# 来源：56 个历史方案扫描整合', ''];
    CATEGORIES.forEach(cat => {
      lines.push(`## ${cat.name}`);
      cat.sub.forEach(sub => {
        lines.push(`### ${sub.name}`);
        sub.items.forEach(item => {
          lines.push(`- ${item.name}（${item.desc}）`);
        });
        lines.push('');
      });
    });
    return lines.join('\n');
  }

  function find(name) {
    for (const cat of CATEGORIES) {
      for (const sub of cat.sub) {
        for (const item of sub.items) {
          if (item.name === name || item.name.includes(name) || name.includes(item.name)) {
            return { ...item, category: cat.name, subcategory: sub.name };
          }
        }
      }
    }
    return null;
  }

  return {
    CATEGORIES,
    getAll,
    getText,
    find,
  };
})();

window.DeviceLibrary = DeviceLibrary;
export default DeviceLibrary;