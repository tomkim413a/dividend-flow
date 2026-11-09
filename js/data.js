/* ============================================================
 * data.js —— 股息流 · 数据层（全游戏唯一数据源）
 *
 * 数据域一览：
 *   1. 基础工具与主题色（pick/shuffle/money/COLORS）
 *   2. 职业 PROFESSIONS（月薪 / 储蓄 / 负债结构 = 平衡锚点）
 *   3. 行情中心 STOCKS（红利股吃息 + 成长股波动）与行情规则说明
 *   4. 棋盘 BOARD（24 格布局 / 格型定义 / 图例描述）
 *   5. 买房事件 HOUSES（买房 = 大额支出陷阱，机会藏在股票格里）
 *   6. 意外支出 DOODADS（小额/大额两池，按收入比例动态计费）
 *   7. 规则说明 RULES（设置页速览与图例文案）
 *   8. 全局参数与策略 TUNING / AI_POLICY / TIMING（engine 直接消费）
 *   9. 战绩存档 Stats（localStorage 跨局累计：胜场 / 破产 / 平均出圈回合）
 *
 * ⚠️ 数值约束：
 *   职业支出、24 格分布、股票 base/div/vol、房价与月供、意外比例
 *   均由单人/多人模拟校准过，改动任一处需重跑平衡回归脚本。
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 1. 基础工具与主题色
   * ============================================================ */
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function money(n) {
    const neg = n < 0;
    const v = Math.abs(n);
    const hasCent = Math.abs(v - Math.round(v)) > 0.004;
    const str = hasCent
      ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(v).toLocaleString('en-US');
    return (neg ? '-$' : '$') + str;
  }
  const COLORS = ['#f5b73e', '#3ddc97', '#4d9fff', '#ff6b6b', '#b48bff', '#ff8fd0', '#2fd6c2', '#ffa94d'];

  /* 随机昵称：设置页里玩家【没填名字】时由这里自动取名，取代原来的“玩家1 / 玩家2”。
     取法 = 前缀 + 后缀随机组合（20×20 = 400 种），传入 taken 已用过的名字做去重；
     极端情况下组合全被占用时，用「后缀 + 递增序号」兜底，保证一定不重名。 */
  const NICK_A = ['稳健', '激进', '佛系', '硬核', '躺平', '摸鱼', '抄底', '满仓', '定投', '打新',
    '价值', '趋势', '梭哈', '长期', '复利', '股息', '红利', '杠杆', '空仓', '加仓'];
  const NICK_B = ['老张', '小李', '老王', '阿强', '阿珍', '大熊', '牛哥', '喵酱', '阿福', '小美',
    '大鹏', '老陈', '阿豪', '小豆', '铁柱', '翠花', '小满', '大牛', '阿May', '老K'];
  function randName(taken) {
    const used = new Set(Array.isArray(taken) ? taken : []);
    // 优先用「还没被别人占用过的后缀」，同局几家的名字听起来更有区分度
    const free = NICK_B.filter(b => !NICK_A.some(a => used.has(a + b)));
    const B = free.length ? free : NICK_B;
    for (let i = 0; i < 80; i++) {
      const n = pick(NICK_A) + pick(B);
      if (!used.has(n)) return n;
    }
    const b = pick(B);                      // 兜底：组合被占满时加序号
    let k = 2;
    while (used.has(b + k)) k++;
    return b + k;
  }

  /* ============================================================
   * 2. 职业 PROFESSIONS（平衡版）
   * 平衡设计：各职业「净结余/工资」比值接近(≈0.53)，储蓄≈1个月净结余。
   * 高薪职业并非“收入高就飞”，而是背着大额房贷/车贷/学贷等高月供
   * （如医生贷 52 万买房），赚得多花得也多，把出圈速度拉回同一区间。
   * expenseLines: 每月固定支出；
   *   debt=true 且带 principal 表示可全额还清的负债（还清后月供归零）。
   * ============================================================ */
  const PROFESSIONS = [
    { id: 'cleaner', name: '清洁工',   icon: '🧹', salary: 1600,  savings: 900,  childCost: 130,
      expenseLines: [
        { label: '所得税',       m: 80 },
        { label: '房租',         m: 300 },
        { label: '车贷',         m: 100,  debt: true, principal: 3600 },
        { label: '信用卡账单',   m: 60,   debt: true, principal: 1800 },
        { label: '日常生活开销', m: 210 }] },
    { id: 'secretary', name: '秘书',     icon: '💼', salary: 2500,  savings: 1350, childCost: 150,
      expenseLines: [
        { label: '所得税',       m: 150 },
        { label: '房租',         m: 480 },
        { label: '车贷',         m: 120,  debt: true, principal: 4500 },
        { label: '信用卡账单',   m: 100,  debt: true, principal: 2600 },
        { label: '日常生活开销', m: 325 }] },
    { id: 'trucker', name: '卡车司机', icon: '🚚', salary: 2800, savings: 1500, childCost: 150,
      expenseLines: [
        { label: '所得税',       m: 170 },
        { label: '房租',         m: 460 },
        { label: '卡车贷款',     m: 260,  debt: true, principal: 9800 },
        { label: '信用卡账单',   m: 110,  debt: true, principal: 3000 },
        { label: '日常生活开销', m: 316 }] },
    { id: 'nurse', name: '护士',     icon: '🩺', salary: 3400,  savings: 1800, childCost: 180,
      expenseLines: [
        { label: '所得税',       m: 190 },
        { label: '房贷',         m: 400,  debt: true, principal: 82000 },
        { label: '车贷',         m: 150,  debt: true, principal: 5500 },
        { label: '信用卡账单',   m: 100,  debt: true, principal: 2500 },
        { label: '助学贷款',     m: 130,  debt: true, principal: 5200 },
        { label: '日常生活开销', m: 620 }] },
    { id: 'teacher', name: '中学教师', icon: '📚', salary: 3600, savings: 1900, childCost: 190,
      expenseLines: [
        { label: '所得税',       m: 220 },
        { label: '房租',         m: 540 },
        { label: '车贷',         m: 160,  debt: true, principal: 6000 },
        { label: '信用卡账单',   m: 120,  debt: true, principal: 3200 },
        { label: '助学贷款',     m: 100,  debt: true, principal: 4000 },
        { label: '日常生活开销', m: 552 }] },
    { id: 'police', name: '警察',     icon: '👮', salary: 3800,  savings: 2000, childCost: 200,
      expenseLines: [
        { label: '所得税',       m: 240 },
        { label: '房贷',         m: 430,  debt: true, principal: 96000 },
        { label: '车贷',         m: 180,  debt: true, principal: 6400 },
        { label: '信用卡账单',   m: 110,  debt: true, principal: 2800 },
        { label: '日常生活开销', m: 800 }] },
    { id: 'mechanic', name: '机械师',   icon: '🔧', salary: 4500,  savings: 2400, childCost: 220,
      expenseLines: [
        { label: '所得税',       m: 280 },
        { label: '房贷',         m: 500,  debt: true, principal: 102000 },
        { label: '车贷',         m: 220,  debt: true, principal: 7800 },
        { label: '信用卡账单',   m: 130,  debt: true, principal: 3300 },
        { label: '助学贷款',     m: 120,  debt: true, principal: 5000 },
        { label: '日常生活开销', m: 830 }] },
    { id: 'chef', name: '主厨',     icon: '🍳', salary: 4600,  savings: 2400, childCost: 240,
      expenseLines: [
        { label: '所得税',       m: 290 },
        { label: '房贷',         m: 520,  debt: true, principal: 104000 },
        { label: '车贷',         m: 200,  debt: true, principal: 7600 },
        { label: '信用卡账单',   m: 150,  debt: true, principal: 4000 },
        { label: '日常生活开销', m: 1002 }] },
    { id: 'engineer', name: '工程师',   icon: '👷', salary: 5200,  savings: 2800, childCost: 260,
      expenseLines: [
        { label: '所得税',       m: 350 },
        { label: '房贷',         m: 600,  debt: true, principal: 115000 },
        { label: '车贷',         m: 270,  debt: true, principal: 9500 },
        { label: '信用卡账单',   m: 150,  debt: true, principal: 3800 },
        { label: '日常生活开销', m: 1035 }] },
    { id: 'accountant', name: '会计', icon: '🧮', salary: 6000, savings: 3200, childCost: 320,
      expenseLines: [
        { label: '所得税',       m: 400 },
        { label: '房贷',         m: 680,  debt: true, principal: 136000 },
        { label: '车贷',         m: 260,  debt: true, principal: 10000 },
        { label: '信用卡账单',   m: 170,  debt: true, principal: 5000 },
        { label: '助学贷款',     m: 130,  debt: true, principal: 6000 },
        { label: '日常生活开销', m: 1180 }] },
    { id: 'lawyer', name: '律师',     icon: '⚖️', salary: 7500,  savings: 4000, childCost: 360,
      expenseLines: [
        { label: '所得税',       m: 560 },
        { label: '房贷·高档公寓', m: 1100, debt: true, principal: 260000 },
        { label: '车贷·豪华轿车', m: 420,  debt: true, principal: 20000 },
        { label: '信用卡账单',   m: 300,  debt: true, principal: 9500 },
        { label: '助学贷款',     m: 230,  debt: true, principal: 14000 },
        { label: '日常生活开销', m: 915 }] },
    { id: 'doctor', name: '医生',     icon: '👨‍⚕️', salary: 13200, savings: 7000, childCost: 620,
      expenseLines: [
        { label: '所得税',       m: 1180 },
        { label: '房贷·独栋别墅', m: 2450, debt: true, principal: 520000 },
        { label: '车贷·豪华SUV',  m: 640,  debt: true, principal: 30000 },
        { label: '信用卡账单',   m: 500,  debt: true, principal: 16000 },
        { label: '助学贷款·医学院', m: 280, debt: true, principal: 18000 },
        { label: '日常生活开销', m: 1150 }] }
  ];

  /* ============================================================
   * 3. 行情中心 STOCKS
   *
   * 行情模型：
   *   每次有人掷骰 → 全市场按 vol 随机小幅波动一次；
   *   约 4 成概率出现一只成长股的“利好/利空”大新闻（振幅 16%~40%）。
   *
   * 字段说明：
   *   cat  : 'div'=红利股（稳定+每月分红）  'grw'=成长股（无息、大起大落）
   *   base : 发行参考价，开盘价在 base±10% 内随机
   *   div  : 每股每月股息（仅红利股 >0）
   *   vol  : 每掷一次骰的单期波动幅度。div 约 0.016~0.022（单期均值约 1.4%），
   *          grw 约 0.130~0.160（叠加“大新闻”后单期均值约 5%~7%）。
   *   ⚠️ 报价是整数元，1 元即最小变动单位：红利股基价因此刻意设在 52~88 档
   *      （1 元 ≈ 1.1%~1.9%），才能做到“每期基本都在涨跌，但均值 <2%”；
   *      若基价过低（如 15~40），TUNING.stallChance 的“至少动 1 元”保底会把
   *      单期波动推到 3%~7%。div 与 base 等比例缩放，股息收益率不受影响。
   *   sector / blurb：板块与一句话介绍（行情条 tooltip、图例文案备用）
   * ⚠️ base/div/vol 为平衡关键，勿随意改动。
   * ============================================================ */
  const STOCKS = [
    /* ---------- 红利股：稳中有息，买股=每月吃股息 ---------- */
    { sym: 'CBNK', name: '城市银行',   icon: '🏦', cat: 'div', base: 58, div: 4.23, vol: 0.018,
      sector: '银行',   blurb: '牌照壁垒稳固，分红雷打不动' },
    { sym: 'PWRU', name: '联合电力',   icon: '⚡', cat: 'div', base: 72, div: 5.28, vol: 0.018,
      sector: '公用事业', blurb: '民生刚需，电价最稳' },
    { sym: 'FDRS', name: '幸福食品',   icon: '🍞', cat: 'div', base: 52, div: 3.81, vol: 0.018,
      sector: '必选消费', blurb: '大众品牌，增长平缓' },
    { sym: 'ENEO', name: '海油能源',   icon: '🛢️', cat: 'div', base: 88, div: 6.38, vol: 0.022,
      sector: '能源',   blurb: '股息高但受大宗商品价格牵动' },
    { sym: 'MEDB', name: '蓝盾医疗',   icon: '💊', cat: 'div', base: 62, div: 4.53, vol: 0.016,
      sector: '医药',   blurb: '老龄化长线刚需' },
    { sym: 'INSG', name: '国人保险',   icon: '🛡️', cat: 'div', base: 78, div: 5.67, vol: 0.020,
      sector: '保险',   blurb: '负债端成本波动影响利润' },
    { sym: 'TLCA', name: '光速电信',   icon: '📶', cat: 'div', base: 52, div: 3.76, vol: 0.016,
      sector: '通信',   blurb: '重资产投入期，分红温和' },
    { sym: 'WATR', name: '清源水务',   icon: '💧', cat: 'div', base: 56, div: 4.07, vol: 0.016,
      sector: '公用事业', blurb: '区域水务特许经营，现金流如自来水般稳定' },
    { sym: 'WHSL', name: '通衢仓储REIT', icon: '📦', cat: 'div', base: 66, div: 4.83, vol: 0.020,
      sector: '物流地产', blurb: '收租型资产，租金与空置率周期波动' },
    /* ---------- 成长股：无分红，大起大落，低买高卖博差价 ---------- */
    { sym: 'CHIP', name: '硅智芯片',   icon: '🖥️', cat: 'grw', base: 80, div: 0, vol: 0.135,
      sector: '半导体', blurb: '国产替代情绪风口' },
    { sym: 'SPCE', name: '星辰航天',   icon: '🚀', cat: 'grw', base: 60, div: 0, vol: 0.145,
      sector: '航天',   blurb: '订单周期长，题材驱动为主' },
    { sym: 'FUSN', name: '日核聚变',   icon: '☀️', cat: 'grw', base: 45, div: 0, vol: 0.160,
      sector: '新能源', blurb: '概念先行，落地遥远' },
    { sym: 'NWEG', name: '绿动新能源', icon: '🌿', cat: 'grw', base: 35, div: 0, vol: 0.130,
      sector: '新能源', blurb: '产能过剩，价格战激烈' },
    { sym: 'NETX', name: '云端互联',   icon: '🌐', cat: 'grw', base: 50, div: 0, vol: 0.140,
      sector: '互联网', blurb: '盈利兑现参差不齐' },
    { sym: 'RBOT', name: '灵动机器人', icon: '🤖', cat: 'grw', base: 70, div: 0, vol: 0.145,
      sector: '机器人', blurb: '人形机器人预期炒作' },
    { sym: 'AUTO', name: '驭光智驾',   icon: '🚗', cat: 'grw', base: 40, div: 0, vol: 0.160,
      sector: '智能汽车', blurb: '智驾法规与事故风险并存' },
    { sym: 'AGRI', name: '智慧农业',   icon: '🌾', cat: 'grw', base: 32, div: 0, vol: 0.140,
      sector: '农业科技', blurb: '无人农场概念，订单落地前先讲故事' },
    { sym: 'GAME', name: '星际游戏',   icon: '👾', cat: 'grw', base: 48, div: 0, vol: 0.155,
      sector: '游戏传媒', blurb: '爆款决定生死，流水大起大落' }
  ];

  // 股息年化参考收益率（per 股：月股息×12 ÷ 参考价）
  function divYield(st) { return st.div > 0 ? (st.div * 12) / st.base : 0; }

  // 行情条分组标签（渲染/图例共用；cls 对应 style.css 中的标签配色类）
  const MARKET_GROUPS = [
    { cat: 'div', icon: '💰', label: '红利股 · 稳定月息', desc: '持有即按月收股息，价格有涨有跌但幅度温和', cls: 'grp-div' },
    { cat: 'grw', icon: '🚀', label: '成长股 · 大起大落', desc: '不派息，靠暴涨暴跌低买高卖', cls: 'grp-grw' }
  ];

  /* ============================================================
   * 4. 棋盘 BOARD —— 仓鼠圈（24 格环形扇区，模仿实体现金流棋盘）
   *
   * 物理布局 HAMSTER_RING：整圈 360° 等分为 24 个【扇形】格子（每格 15°），
   *   0 号格在 12 点方向（💵 结算日 = 起点），顺时针推进，
   *   走满 24 格回到起点闭环；正中央留出圆形区域给信息板。
   *   渲染层按「盘直径 + 扇环内外半径比例」等比放大，格子的可用宽度
   *   随盘径一起变大；格内文字再反向旋转一次，于是【扇形格子 + 水平可读
   *   文字】同时成立，不必像老式棋盘那样歪着头看径向文字。
   *
   * HAMSTER_LAYOUT：仅用格型代号，可一眼看清分布；
   * TYPE_INFO ：格型 → 图标/名称/短标签 hint/样式类/图例描述；
   * HAMSTER_BOARD ：把两者合成带 idx 的完整格数组（引擎/渲染遍历它）；
   * HAMSTER_RING  ：idx → 扇区中心角 ang 与起止角 a0/a1（度，0=12 点方向，顺时针）；
   * SECTOR_DEG：单格占角（360/24 = 15°）；
   * ARC       ：扇环几何比例（内外半径相对盘半径、格子留缝），调“环的胖瘦”只改这里；
   * PIECE_SHAPES：玩家可选的棋子形状（clip-path 裁剪路径，渲染层直接用）。
   *
   * 分布（平衡关键，改布局需重跑回归）：
   *   💵 结算日×1 · 💰 红利格×7 · 🚀 成长格×7 · 🛍️ 意外×4
   *   🧾 交税×2 · 🛑 失业×1 · 🕊️ 慈善×2
   * ============================================================ */
  const HAMSTER_LAYOUT = [
    'payday', 'divS',   'doodad', 'grwS',   'charity', 'divS',
    'grwS',   'doodad', 'divS',   'jobless', 'grwS',   'tax',
    'divS',   'doodad', 'grwS',   'charity', 'divS',   'tax',
    'grwS',   'doodad', 'divS',   'grwS',    'divS',   'grwS'
  ];

  const TYPE_INFO = {
    payday:  { ic: '💵', name: '银行结算日', cls: 'payday', hint: '结算现金流',
      desc: '每经过一次，结算“工资+被动收入−支出”；若被动收入已超过支出，当场胜出' },
    // 注：买房卡没有独立格子，就是在这两个股票格里按 TUNING.houseChance 的概率翻出来的，
    //     desc 里向玩家明示这点（棋盘 hover 提示与设置页图例都用它）。
    divS:    { ic: '💰', name: '红利股', cls: 'stockD', hint: '买股吃月息',
      desc: '翻开红利股机会卡：按现价买入，每持 1 股每月领取股息；偶尔（约 15%）改翻 🏠买房卡' },
    grwS:    { ic: '🚀', name: '成长股', cls: 'stockG', hint: '低买高卖',
      desc: '翻开成长股机会卡：无股息，低买高卖博暴利；偶尔（约 15%）改翻 🏠买房卡' },
    doodad:  { ic: '🛍️', name: '意外支出', cls: 'doodad', hint: '多为小额',
      desc: '随机一次性意外支出：96% 是 50~300 元的小额（按现金流比例计费）；约 4% 抽到 400 元起步的大额灾难' },
    tax:     { ic: '🧾', name: '交税', cls: 'tax', hint: '≤ 总资产 1%',
      desc: '按（工资＋被动收入）×6% 缴所得税，且封顶为你总资产（现金＋股票市值）的 1%' },
    jobless: { ic: '🛑', name: '失业', cls: 'bad', hint: '停一回合',
      desc: '失去工资：生活费缺口一半由存款垫付，并跳过下一回合' },
    charity: { ic: '🕊️', name: '慈善', cls: 'charity', hint: '捐款换下回合双骰',
      desc: '自愿捐款，可获得一次掷两颗骰子的机会（留到【下一回合】轮到自己时才兑现，本回合不追加掷骰）' }
  };

  const HAMSTER_BOARD = HAMSTER_LAYOUT.map((t, i) => Object.assign({ idx: i, type: t }, TYPE_INFO[t]));
  const HAMSTER_SIZE = HAMSTER_BOARD.length;

  /* 扇环几何：24 格 = 360°/24 = 15° 一格，顺时针从 12 点方向出发 */
  const SECTOR_DEG = 360 / HAMSTER_SIZE;
  const ARC = {
    outRatio: 0.985,   // 扇环外半径 = 盘半径 × 该值（留出盘边）
    inRatio: 0.545,    // 扇环内半径 = 盘半径 × 该值（正中央圆形信息板的半径）
    gapRatio: 0.90     // 每格实占角 = 15° × 该值，其余留作格间缝
  };
  const HAMSTER_RING = HAMSTER_BOARD.map((cl, i) => {
    const ang = i * SECTOR_DEG;
    return { idx: i, ang, a0: ang - SECTOR_DEG / 2, a1: ang + SECTOR_DEG / 2 };
  });

  /* 棋子形状：玩家在设置页可自选；渲染层用 clip-path 直接套用。
   * 所有路径都以“元素自身盒子”为坐标系（百分比），因此可任意缩放。 */
  const PIECE_SHAPES = [
    { k: 'disc',    name: '圆盘', path: 'circle(50% at 50% 50%)' },
    { k: 'square',  name: '方块', path: 'inset(0 round 26%)' },
    { k: 'diamond', name: '菱形', path: 'polygon(50% 0,100% 50%,50% 100%,0 50%)' },
    { k: 'tri',     name: '三角', path: 'polygon(50% 2%,98% 94%,2% 94%)' },
    { k: 'hex',     name: '六角', path: 'polygon(25% 2%,75% 2%,100% 50%,75% 98%,25% 98%,0 50%)' },
    { k: 'star',    name: '星形', path: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)' },
    { k: 'shield',  name: '盾牌', path: 'polygon(50% 0,100% 16%,100% 60%,50% 100%,0 60%,0 16%)' }
  ];

  /* ============================================================
   * 5. 买房事件 HOUSES
   * 买房=“大额支出陷阱”：支付首付 down + 永久新增月供 m，
   * 不产生任何被动收入，反而抬高月支出、拖慢出圈。
   * principal = 剩余贷款本金（买房后可被全额还清以去掉月供）；
   * m 约按年化 6% 估算：m ≈ principal × 6% / 12。
   * ⚠️ 房价门槛（down）直接影响买房陷阱的触发对象，改动需回归。
   * ============================================================ */
  const HOUSES = [
    { name: '县城集资小房', icon: '🏚️', down: 4000,  m: 150,  principal: 30000,
      desc: '便宜、离公司远、不好转手，买了更像负担' },
    { name: '旧城区小公寓', icon: '🏢', down: 8000,  m: 300,  principal: 60000,
      desc: '刚需上车盘：通勤远、配套旧，但月供咬咬牙尚可承担' },
    { name: '近郊联排别墅', icon: '🏘️', down: 20000, m: 800,  principal: 160000,
      desc: '面积大、离市中心远，自住性价比一般，首付不低' },
    { name: '学区老破小',   icon: '🏫', down: 26000, m: 900,  principal: 180000,
      desc: '只为学位买单，溢价高，出租回报率低' },
    { name: '市中心观景平层', icon: '🏬', down: 50000, m: 1800, principal: 360000,
      desc: '地段金贵，首付与月供都很沉重' },
    { name: '海边度假豪宅', icon: '🏰', down: 120000, m: 4000, principal: 800000,
      desc: '梦想之屋，也最能拖慢出圈——买它请三思' }
  ];

  /* ============================================================
   * 6. 意外支出 DOODADS
   * 计费：金额 = max(doodadFloor, 当月净现金流 × r)。
   * 按玩家收入水平动态计费：同样的“意外”对不同收入的家庭
   * 相对压力一致，避免固定金额拖垮低收入者、却对高薪无关痛痒。
   *
   * ⚠️ 分两池，保证“>300 元的大额意外”概率严格受控（需求：≤5%）：
   *   · small 池（默认）：绝大多数，金额硬性封顶 doodadSmallCap(300)，绝不越界；
   *   · big   池（big:true）：仅 doodadBigChance(4%) 概率抽中，金额不低于
   *     doodadBigFloor(400) → 因此“支出 > 300 元”的概率 == 4%。
   * 判池函数 pickDoodad 见下方导出。
   * ============================================================ */
  const DOODADS = [
    /* ---- 小额池：占比 96%，50~300 元，金额轻、不伤筋动骨 ---- */
    { name: '停车罚单',       icon: '🅿️', r: 0.03, desc: '路边随手一停就中了' },
    { name: '外卖超支',       icon: '🛵', r: 0.04, desc: '这个月外卖点太多了' },
    { name: '家庭聚餐',       icon: '🍽️', r: 0.05, desc: '全家下馆子犒劳一顿' },
    { name: '被朋友借钱',     icon: '🤝', r: 0.05, desc: '老同学开口，有借无还' },
    { name: '礼品人情',       icon: '🎁', r: 0.06, desc: '红白喜事随份子' },
    { name: '演唱会门票',     icon: '🎤', r: 0.07, desc: '偶像巡演，咬牙买下最贵档' },
    { name: '游戏皮肤礼包',   icon: '🎮', r: 0.07, desc: '限量皮肤，错过就绝版' },
    { name: '健身房年卡',     icon: '🏋️', r: 0.08, desc: '冲动办卡，去不了几次' },
    { name: '新手机分期补款', icon: '📱', r: 0.09, desc: '追新款的尾款账单' },
    { name: '宠物美容护理',   icon: '✂️', r: 0.09, desc: '毛孩子剪毛洗澡一条龙' },
    { name: '旅行团定金',     icon: '🧳', r: 0.10, desc: '临时起意订了个旅行团' },
    { name: '宠物急诊',       icon: '🐶', r: 0.11, desc: '毛孩子生病进医院' },
    { name: '医疗门诊费',     icon: '🏥', r: 0.11, desc: '挂号、检查、开药' },
    { name: '家具换新',       icon: '🛋️', r: 0.12, desc: '沙发衣柜集体服役到期' },

    /* ---- 大额池：4% 概率，400 元起步（一定 >300），才是真“灾” ---- */
    { name: '房屋漏水翻修',   icon: '🏚️', r: 0.30, big: true, desc: '楼上漏水，天花板重做' },
    { name: '汽车大修',       icon: '🚗', r: 0.35, big: true, desc: '变速箱罢工，只能进厂' },
    { name: '住院手术',       icon: '🏥', r: 0.45, big: true, desc: '一场手术，账单最狠' }
  ];

  // 抽一张意外卡：先按 doodadBigChance 决定「大额 / 小额」池，再在该池内等概率抽一张。
  // 这样“支出 > doodadSmallCap(300)”的概率恒等于 doodadBigChance，不受职业收入影响。
  function pickDoodad() {
    const big = Math.random() < TUNING.doodadBigChance;
    return pick(DOODADS.filter(d => !!d.big === big));
  }

  /* ============================================================
   * 7. 规则说明 RULES
   * 结构：{ lead: 条目关键词, body: 说明正文 }，
   * 由设置页“游戏规则速览”列表逐条渲染（见 render.js renderRules）。
   * ============================================================ */
  const RULES = [
    { lead: '目标', body: '让「股息被动收入 ＞ 每月总支出」。走到💵银行结算日完成结算时，若已满足即胜出。' },
    { lead: '行情', body: '顶部实时行情条：每股下方是近 14 次行情的迷你走势图。每次有人掷骰全市场波动一次：红利股价格也会随行情涨跌（幅度温和，明显小于成长股），成长股则大涨大跌；异动会顶部播报并高亮该股。' },
    { lead: '买入', body: '踩到 💰红利股 / 🚀成长股 格翻卡，按当前市价买入该股，多少股随意。红利股每持 1 股每月自动产生股息（被动收入）。' },
    { lead: '卖出', body: '自己回合掷骰前可随时在「我的持仓」里按现价卖出任意股票，落袋为安。' },
    { lead: '买房', body: '棋盘上【没有专门的买房格】：踩到 💰红利股 / 🚀成长股 格时，偶尔（约 15%）会翻到 🏠买房卡，日志与弹窗都会标明触发在哪一格。买房是大额支出：付首付＋永久增加月供，不产生任何收入，反而拖慢出圈。' },
    { lead: '其它格', body: '🛍️意外支出（多为 50~300 元的小额，仅约 4% 概率是 400 元起步的大额；扣款前会弹窗告知，点「确定」生效）、🧾交税（按收入 6% 计，且不超过你总资产的 1%，同样弹窗确认）、🛑失业会停一回合（被动收入越充足越不怕失业）、🕊️慈善捐钱换一次双骰（攒到【下一回合】轮到自己时才兑现，本回合不立刻再掷）。' },
    { lead: '破产', body: '现金不足以支付时触发破产保护：真人玩家会弹出对话框，由你自己决定卖哪只股票、卖多少股（按当前市价成交，电脑 AI 则由电脑自动变卖）；若卖光仍资不抵债则被淘汰出局，其余玩家继续争夺最后的幸存者。' },
    { lead: '提示', body: '也可全额还清车贷/房贷/卡贷来降低月支出；红利股息是出圈的钥匙，成长股是快速翻身的杠杆。' }
  ];

  /* ============================================================
   * 8. 全局参数与策略（engine.js 直接消费的“规则旋钮”）
   *
   * TUNING    —— 玩法参数：行情/买房/意外/税收/失业/慈善的概率与比率
   * AI_POLICY —— 电脑玩家交易与决策偏好
   * TIMING    —— 走格动画与 AI 节奏（纯表现层）
   * ⚠️ 数值与原 engine.js 硬编码完全一致；调整任一项都会影响
   *    对局节奏与平衡，需重跑回归脚本确认各职业胜率/回合数。
   * ============================================================ */

  // 8.1 玩法参数（原 hard-code 于 engine.js）
  const TUNING = {
    marketInitJitter: 0.10,   // 开盘价在 base±10% 内随机
    marketHistLen: 14,        // 每只股保留近 N 次行情价格，供行情条迷你走势图
    stallChance: 0.15,        // 单期“横盘不动”的概率；其余情况价位不动时至少挪 1 元（防低价股长期呆滞）
    flashMin: 0.08,           // 单次行情波动 ≥8% 视为显著异动：无大新闻时顶部播报领涨/领跌
    newsChance: 0.42,         // 每次掷骰后，出现一只成长股“大新闻”的概率
    boomChance: 0.60,         // 大新闻中利好（涨）的占比，其余为利空
    boomAmpMin: 0.16,         // 大新闻最小振幅
    boomAmpMax: 0.40,         // 大新闻最大振幅
    houseChance: 0.15,        // 踩中股票格时翻到买房卡的概率（须与 TYPE_INFO 里宣传的“约15%”同步）
    doodadFloor: 50,          // 意外支出金额下限（小额也不再动辄 80+）
    doodadSmallCap: 300,      // 小额意外硬性封顶：小额池金额永远 ≤ 该值
    doodadBigChance: 0.04,    // 抽到「大额意外」的概率（须 ≤5%，即“支出 > doodadSmallCap”的概率）
    doodadBigFloor: 400,      // 大额意外金额下限：保证一定 > doodadSmallCap(300)
    taxRate: 0.06,            // 交税额 =（工资＋被动收入）× taxRate，再与“总资产×taxAssetRate”取小
    taxAssetRate: 0.01,       // 税负上限：不超过玩家总资产（现金＋股票市值）的 1%
    taxFloor: 30,             // 交税额下限
    joblessCover: 0.50,       // 失业：生活费缺口中由存款垫付的比例
    charityRate: 0.10,        // 慈善捐款额 = 净现金流 × charityRate
    charityFloor: 50          // 慈善捐款额下限
  };

  // 8.2 AI 决策偏好（原 hard-code 于 engine.js autoChoose/aiSellWinners）
  const AI_POLICY = {
    sellGain: 1.80,           // 成长股现价 ≥ 成本 × sellGain 时逢高止盈
    divKeepRatio: 0.50,       // 买红利股时留约半月支出做现金垫
    divKeepFloor: 400,        // 红利股现金垫下限
    grwCashMinSalary: 2.50,   // 现金 > 月薪 × 该值 才小仓位试水成长股
    grwBudgetRatio: 0.25,     // 试水成长股动用现金的比例
    grwMaxShares: 200,        // 单笔成长股买入股数上限
    charityCashPad: 300,      // 捐款后仍至少保留的现金
    charityDonateProb: 0.55,  // AI 慈善捐款概率

    // —— 激进型 AI（AI 数 ≥ 2 时保证至少一个）：更爱成长股、现金垫更薄、止盈目标更高
    divKeepRatioAggr: 0.25,       // 买红利股时留的现金垫（更薄 → 买更多）
    grwCashPadAggr: 400,          // 激进 AI 买成长股时保留的现金垫（按绝对值而非月薪 → 门槛低、买得频繁）
    grwBudgetRatioAggr: 0.45,     // 买成长股动用现金的比例（更高）
    grwMaxSharesAggr: 400,        // 单笔成长股买入上限（更高）
    sellGainAggr: 2.20            // 止盈目标更高（拿更久博更大收益）
  };

  // 8.3 表现层节奏（原 hard-code 于 engine.js WALK_CFG / drive）
  // ⚠️ 纯表现层节奏，不参与任何规则计算：批量平衡模拟会把它们整体归零（fast 模式），
  //    因此调整这些数值【不会】改变胜率 / 回合数 / 经济数值。
  // 2026-11-09 卡顿优化：旧值（1200/2000/160~600/900/700）实测零网络下
  //    平均每手要空等约 3.9~4.2 秒、4 人一圈近 16 秒，玩家会误以为「卡死」。
  // 2026-11-09 二次调整：压到「标准」档后玩家反馈 AI 一瞬间走完、看不清每一步，
  //    因此改为多档可选，默认「舒缓」（比基准慢 1.8 倍，仍远快于旧版）。
  //    engine.js 持有 TIMING 的对象引用，改属性即时生效；服务端每个房间各有
  //    一份 vm 上下文，applySpeed 只影响该房间，不会串到其他对局。
  // 2026-11-09 三次调整（玩家要求）：取消「极快」档、把「标准」改名为「快速」，
  //    只剩三档；另外给【联机】单独放慢真人节奏并加落格停留，单机一律不动（见 ONLINE_TIMING）。
  const TIMING_BASE = {
    walkHold: 320,    // 掷骰后停顿（ms），再开始逐格行走
    walkTotal: 900,   // 单次掷骰走完全程的基准时长（ms）
    walkStepMin: 90,  // 单步最小停留（ms）
    walkStepMax: 220, // 单步最大停留（ms）
    aiRollMs: 320,    // AI 掷骰前的“思考”时长（ms）
    aiChooseMs: 260   // AI 翻卡做决策的延迟（ms）
  };

  /* 三档 AI 速度（key 保持兼容：旧的 localStorage 存档 / 房间档位写 fast 会被
     normSpeed 安全回落到 relaxed；normal 只改中文名，不换 key）。 */
  const SPEED_PRESETS = [
    { key: 'slow',    label: '🤖 慢速 · 看清每一步', scale: 3.0, note: 'AI 每格约 0.3–0.7 秒，AI 每手约 5 秒' },
    { key: 'relaxed', label: '🤖 舒缓 · 推荐',       scale: 1.8, note: 'AI 每格约 0.2–0.4 秒，AI 每手约 3 秒' },
    { key: 'normal',  label: '🤖 快速',              scale: 1.0, note: 'AI 每格约 0.1–0.2 秒，AI 每手约 1.7 秒' }
  ];
  const DEFAULT_SPEED = 'relaxed';

  /* 真人玩家节奏（单机默认值）：与 AI 档位完全解耦的固定值。
     档位只改电脑玩家的出手与走格；真人掷骰、走格、操作都不受任何影响，
     也不会被动画拖慢（玩家自己的思考时间本来就完全自由）。
     放在 TIMING 内部是为了让批量模拟的「把数字字段整体归零」逻辑一并覆盖它。 */
  const HUMAN_TIMING = {
    humanWalkHold: 320,
    humanWalkTotal: 900,
    humanWalkStepMin: 90,
    humanWalkStepMax: 220
  };

  /* ★ 仅联机（网络版）生效的表现层节奏 —— 2026-11-09 玩家要求：
       1. 棋子落到最后一格后先停 ~500 ms 再弹事件，避免「还没看清棋位就弹窗」；
       2. 真人每格放慢到 220–280 ms（下限 220 / 上限 280）。
     这两项【绝不作用于单机】：浏览器直接加载 data.js 时 TIMING 保持
     onlineMode=false / landDelayMs=0，engine.js 的 landDelayFor() 原样沿用旧 stepMs，
     行为与本次改动前完全一致。只有服务端 engineHost.js 托管引擎时调用
     applyOnlineTiming() 才切换 —— 这就是「只改网络版、单人版只取消极快模式」的隔离点。
     applySpeed() 只遍历 TIMING_BASE，房间内改 AI 档位不会冲掉这几个值。 */
  const ONLINE_TIMING = {
    humanWalkStepMin: 220,
    humanWalkStepMax: 280,
    landDelayMs: 500
  };
  const TIMING = Object.assign({}, TIMING_BASE, HUMAN_TIMING,
    { speed: DEFAULT_SPEED, onlineMode: false, landDelayMs: 0 });

  function normSpeed(k) {
    return SPEED_PRESETS.some(p => p.key === k) ? k : DEFAULT_SPEED;
  }
  function speedInfo(k) {
    return SPEED_PRESETS.find(p => p.key === normSpeed(k));
  }
  /** 应用速度档位：只改 TIMING 的数值属性（speed 是字符串标记，供 UI/诊断读取）。
   *  引擎与服务端 vm 都持有同一对象引用，因此运行中调整下一手立即生效。 */
  function applySpeed(k) {
    const p = speedInfo(k);
    Object.keys(TIMING_BASE).forEach(f => {
      TIMING[f] = Math.max(40, Math.round(TIMING_BASE[f] * p.scale));
    });
    TIMING.speed = p.key;
    return p.key;
  }
  applySpeed(DEFAULT_SPEED);

  /** 切到联机（网络版）节奏：仅由 server/engineHost.js 在 vm 上下文里调用一次。
   *  之后房间改档走 applySpeed()，只动 TIMING_BASE 的 6 个 AI 字段，
   *  不会把 onlineMode / landDelayMs / humanWalkStepMin/Max 冲回单机值。 */
  function applyOnlineTiming() {
    Object.keys(ONLINE_TIMING).forEach(f => { TIMING[f] = ONLINE_TIMING[f]; });
    TIMING.onlineMode = true;
    return TIMING;
  }

  /* ============================================================
   * 9. 战绩存档 Stats —— 跨局累计（localStorage 持久化）
   *
   * 设计：每局结束时由 engine 调用 Stats.record({ turn, players })，
   * players 直接复用 engine 的 standings() 结果（含 name/ai/outcome）。
   *
   * 口径说明：
   *   wins      —— 财务自由 + 最后幸存者，都算“赢”
   *   avgWinTurns —— 仅统计“胜出那一局”的回合数，衡量出圈速度
   *   bankrupt  —— 被淘汰出局次数
   * 存储不可用时（隐私模式 / Node 无 DOM）自动降级为内存存储，
   * 因此本模块可被无头回归脚本直接调用。
   * ============================================================ */
  const STATS_KEY = 'dividendflow.stats.v1';
  const memStore = {};
  const store = (() => {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        const probe = '__cf_probe__';
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        return localStorage;
      }
    } catch (e) { /* 隐私模式等写入失败：退回内存存储 */ }
    return {
      getItem: k => (k in memStore ? memStore[k] : null),
      setItem: (k, v) => { memStore[k] = String(v); },
      removeItem: k => { delete memStore[k]; }
    };
  })();

  function blankStats() { return { v: 1, games: 0, turnsSum: 0, updated: 0, players: {} }; }
  function blankRow(name, ai) {
    return { name, ai: !!ai, games: 0, wins: 0, freedom: 0, last: 0, bankrupt: 0, winTurnsSum: 0, winTurnsCount: 0 };
  }
  function loadStats() {
    try {
      const raw = store.getItem(STATS_KEY);
      if (!raw) return blankStats();
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || !d.players) return blankStats();
      return Object.assign(blankStats(), d);
    } catch (e) { return blankStats(); }
  }
  function saveStats(d) {
    d.updated = Date.now();
    try { store.setItem(STATS_KEY, JSON.stringify(d)); } catch (e) { /* 写满/禁用时忽略 */ }
    return d;
  }

  // 一局结束后累计：按玩家名归并（同名视为同一人，含 AI）
  function recordGame(res) {
    const d = loadStats();
    if (!res || !res.players || !res.players.length) return d;
    const turn = res.turn || 0;
    d.games++; d.turnsSum += turn;
    res.players.forEach(r => {
      const name = String(r.name || '未命名');
      const row = d.players[name] || (d.players[name] = blankRow(name, r.ai));
      row.ai = !!r.ai; row.name = name; row.games++;
      const won = r.outcome === 'freedom' || r.outcome === 'lastStanding';
      if (r.outcome === 'freedom') { row.wins++; row.freedom++; }
      else if (r.outcome === 'lastStanding') { row.wins++; row.last++; }
      else if (r.outcome === 'bankrupt') { row.bankrupt++; }
      if (won) { row.winTurnsSum += turn; row.winTurnsCount++; }
    });
    return saveStats(d);
  }

  // 排行榜：胜场 → 胜率 → 出圈更快 → 出场更多
  function statRows() {
    const d = loadStats();
    const inf = v => (v == null ? Infinity : v);
    return Object.keys(d.players).map(k => {
      const r = d.players[k];
      return Object.assign({}, r, {
        winRate: r.games ? r.wins / r.games : 0,
        bankruptRate: r.games ? r.bankrupt / r.games : 0,
        avgWinTurns: r.winTurnsCount ? r.winTurnsSum / r.winTurnsCount : null
      });
    }).sort((a, b) =>
      b.wins - a.wins ||
      b.winRate - a.winRate ||
      inf(a.avgWinTurns) - inf(b.avgWinTurns) ||
      b.games - a.games);
  }

  function statSummary() {
    const d = loadStats();
    return { games: d.games, avgTurns: d.games ? d.turnsSum / d.games : 0, updated: d.updated };
  }

  function resetStats() { try { store.removeItem(STATS_KEY); } catch (e) { /* 忽略 */ } return loadStats(); }

  const Stats = { record: recordGame, rows: statRows, summary: statSummary, reset: resetStats, raw: loadStats };

  /* 对外数据层 API：字段名与旧版保持兼容（engine/render 直接消费） */
  window.CF = {
    pick, shuffle, money, COLORS, divYield,
    NICK_A, NICK_B, randName,
    PROFESSIONS,
    STOCKS, MARKET_GROUPS,
    HAMSTER_LAYOUT, TYPE_INFO, HAMSTER_BOARD, HAMSTER_SIZE,
    HAMSTER_RING, SECTOR_DEG, ARC, PIECE_SHAPES,
    HOUSES, DOODADS, pickDoodad,
    RULES,
    TUNING, AI_POLICY, TIMING,
    TIMING_BASE, HUMAN_TIMING, ONLINE_TIMING, SPEED_PRESETS, DEFAULT_SPEED,
    normSpeed, speedInfo, applySpeed, applyOnlineTiming,
    Stats
  };
})();
