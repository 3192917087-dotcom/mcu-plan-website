const VERIFIED_AT = '2026-10-23';

const articles = [
  { filename: 'WLWJ202605024', authors: ['姚江云', '张洪瑞', '李福儒', '高佳硕', '马博宇'], title: '基于STM32的物联网太阳能快递收派机器人设计', journal: '物联网技术', year: 2026, volume: '16', issue: '05', pages: '99-103+107', doi: '10.16667/j.issn.2095-1302.2026.05.023', direction: '机器人与物联网', topics: 'STM32 智能小车 机器人 物联网 太阳能 快递' },
  { filename: 'GYKJ202601058', authors: ['庄庠序', '江志晃', '李圳然', '陈境锐', '陈裕海', '王鑫'], title: '基于STM32和物联网的智能输液监控系统设计', journal: '工业控制计算机', year: 2026, volume: '39', issue: '01', pages: '140-142', direction: '健康监测与物联网', topics: 'STM32 智能输液 医疗监测 物联网 远程监控' },
  { filename: 'ZXLJ202524016', authors: ['程艳', '朱晓明'], title: '基于STM32单片机与阿里云物联网的智能家居实时监控系统设计分析', journal: '科技资讯', year: 2025, volume: '23', issue: '24', pages: '55-58', doi: '10.16661/j.cnki.1672-3791.2503-5042-0418', direction: '智能家居与物联网', topics: 'STM32 单片机 智能家居 阿里云 物联网 实时监控' },
  { filename: 'QCDQ202512016', authors: ['杨甜甜', '何柳', '刘予涵', '崔耀丹', '李法勇'], title: '物联网架构下的STM32智能充电桩实时监控与管理', journal: '汽车电器', year: 2025, issue: '12', pages: '45-47', doi: '10.13273/j.cnki.qcdq.2025.12.012', direction: '能源控制与物联网', topics: 'STM32 智能充电桩 物联网 能源管理 实时监控' },
  { filename: 'WLWJ202522021', authors: ['刘子博', '蔡昌友'], title: '物联网技术在智能消防领域的应用：STM32消防小车的开发与测试', journal: '物联网技术', year: 2025, volume: '15', issue: '22', pages: '87-92', doi: '10.16667/j.issn.2095-1302.2025.22.020', direction: '消防安全与物联网', topics: 'STM32 消防小车 智能消防 物联网 环境监测' },
  { filename: 'NJJL202511035', authors: ['李磊磊', '王帅', '彭铜', '陈炼', '韩佩汶', '谢守勇'], title: '基于STM32的物联网烟叶烤房环境参数监测系统设计', journal: '中国农机装备', year: 2025, issue: '11', pages: '128-132', direction: '农业监测与物联网', topics: 'STM32 烟叶烤房 温湿度 环境监测 物联网' },
  { filename: 'SHDJ202505008', authors: ['刘红', '王林林', '孔令举'], title: '基于STM32与物联网技术的防洪大坝安全监测系统', journal: '上海电机学院学报', year: 2025, volume: '28', issue: '05', pages: '295-299+305', direction: '安全监测与物联网', topics: 'STM32 防洪大坝 安全监测 物联网 传感器' },
  { filename: 'DZHN202515005', authors: ['于是然', '练渊杰', '王睿清', '肖敏', '奚峥皓'], title: '基于STM32的农业补光物联网系统设计', journal: '智慧农业导刊', year: 2025, volume: '5', issue: '15', pages: '19-22+28', doi: '10.20028/j.zhnydk.2025.15.005', direction: '智慧农业与物联网', topics: 'STM32 农业补光 光照监测 智慧农业 物联网' },
  { filename: 'NYLG202504006', authors: ['陈华敏', '余汪洋'], title: '基于物联网和STM32远程控制的智能宠物喂养系统设计', journal: '南阳理工学院学报', year: 2025, volume: '17', issue: '04', pages: '35-41', doi: '10.16827/j.cnki.41-1404/z.2025.04.006', direction: '智能家居与物联网', topics: 'STM32 宠物喂养 远程控制 物联网 智能家居' },
  { filename: 'DZJS202507065', authors: ['吴疆', '李翠花', '谭植壬', '段惠敏', '周泽华'], title: '基于STM32的物联网家居控制系统设计', journal: '电子技术', year: 2025, volume: '54', issue: '07', pages: '174-175', direction: '智能家居与物联网', topics: 'STM32 物联网 智能家居 家居控制' },
  { filename: 'WLWJ202510031', authors: ['隋玉果', '温佳良', '张允', '陈思竹'], title: '基于STM32微控制器的物联网乡村智能电子锁', journal: '物联网技术', year: 2025, volume: '15', issue: '10', pages: '131-136', doi: '10.16667/j.issn.2095-1302.2025.10.029', direction: '智能门锁与物联网', topics: 'STM32 微控制器 智能电子锁 物联网 安防' },
  { filename: 'ZDHT202508077', authors: ['王靓'], title: '基于STM32的智慧农业物联网网关设计研究', journal: '自动化应用', year: 2025, volume: '66', issue: '08', pages: '279-281+285', doi: '10.19769/j.zdhy.2025.08.077', direction: '智慧农业与物联网', topics: 'STM32 物联网网关 智慧农业 数据采集 无线通信' },
  { filename: 'CYCX202420042', authors: ['秦顾艺'], title: '基于STM32的物联网设备低功耗设计与优化', journal: '产业创新研究', year: 2024, issue: '20', pages: '130-132', direction: '嵌入式与物联网', topics: 'STM32 物联网设备 低功耗 嵌入式' },
  { filename: 'ANHE202420037', authors: ['雷广坤', '郝传柱', '王庆吉'], title: '基于STM32G474和物联网的养鸡场环境监测系统研究', journal: '现代农业科技', year: 2024, issue: '20', pages: '147-150', direction: '农业监测与物联网', topics: 'STM32G474 养鸡场 环境监测 物联网 温湿度' },
];

export const CNKI_REFERENCE_LIBRARY = Object.freeze(articles.map(article => {
  const { filename, authors, title, journal, year, volume = '', issue, pages, doi = '', direction, topics } = article;
  const publication = volume ? `${year}, ${volume}(${issue}): ${pages}` : `${year}(${issue}): ${pages}`;
  const citedAuthors = authors.length > 3 ? `${authors.slice(0, 3).join(', ')}, 等` : authors.join(', ');
  return Object.freeze({
    id: `cnki-${filename.toLowerCase()}`,
    type: '期刊论文[J]',
    direction,
    language: '中文',
    year,
    authors: authors.join(', '),
    title,
    source: journal,
    publication,
    volume,
    issue,
    pages,
    volumeNotPublished: !volume,
    identifier: doi,
    formatted: `${citedAuthors}. ${title}[J]. ${journal}, ${publication}.${doi ? ` DOI:${doi}.` : ''}`,
    url: `https://www.cnki.com.cn/Article/CJFDTOTAL-${filename}.htm`,
    verification: `中国知网新版题录页核验，${VERIFIED_AT}`,
    citationCount: 0,
    topics,
  });
}));
