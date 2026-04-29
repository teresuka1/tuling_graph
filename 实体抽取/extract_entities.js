const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'Turing.txt');
const outputPath = path.join(__dirname, 'Turing_entities.json');

const rawText = fs.readFileSync(inputPath, 'utf8');
const text = rawText.replace(/\r/g, '');
const sentences = text
  .split(/[。！？\n]/)
  .map((item) => item.trim())
  .filter(Boolean);

const entityStore = new Map();

const STOP_ENTITIES = new Set([
  '英语',
  '期间',
  '主条目',
  '内容',
  '事实',
  '委员会',
  '工作',
  '研究',
  '方法',
  '程序',
  '概念',
  '论文',
  '文章',
  '机器',
  '结果',
  '证明',
  '设置',
]);

const NOISE_PATTERNS = [
  /^的/,
  /^在/,
  /^并/,
  /^从而/,
  /^后来/,
  /^由于/,
  /^因为/,
  /^要求/,
  /^正式向/,
  /^追授/,
  /^年/,
  /进行/,
  /公开道歉/,
  /解释说/,
  /回答说/,
  /就是这样一个/,
  /选集/,
  /法案生效/,
];

function normalizeEntity(value) {
  if (value == null) return '';
  return value
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[“”"']/g, '')
    .replace(/[()（）]/g, '')
    .replace(/^[，,、；：:.\s]+|[，,、；：:.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countOccurrences(source, keyword) {
  if (!keyword) return 0;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = source.match(new RegExp(escaped, 'g'));
  return matches ? matches.length : 0;
}

function addEntity(category, value, sourceLabel) {
  const name = normalizeEntity(value);
  if (!name || name.length < 2) return;
  if (STOP_ENTITIES.has(name)) return;
  if (/^[0-9]+$/.test(name)) return;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(name))) return;

  if (!entityStore.has(category)) {
    entityStore.set(category, new Map());
  }

  const categoryMap = entityStore.get(category);
  if (!categoryMap.has(name)) {
    categoryMap.set(name, {
      count: 0,
      sources: new Set(),
    });
  }

  const current = categoryMap.get(name);
  current.count = Math.max(current.count, countOccurrences(text, name) || 1);
  if (sourceLabel) current.sources.add(sourceLabel);
}

function extractWithRegex(category, regex, sourceLabel, transform) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    const value = transform ? transform(match) : match[1] || match[0];
    if (Array.isArray(value)) {
      value.forEach((item) => addEntity(category, item, sourceLabel));
    } else {
      addEntity(category, value, sourceLabel);
    }
  }
}

function addFromList(category, values, sourceLabel) {
  values.forEach((item) => {
    if (text.includes(item)) addEntity(category, item, sourceLabel);
  });
}

function addSentenceMatch(category, pattern, sourceLabel, cleaner) {
  sentences.forEach((sentence) => {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(sentence)) !== null) {
      const rawValue = cleaner ? cleaner(match[1] || match[0], sentence) : match[1] || match[0];
      addEntity(category, rawValue, sourceLabel);
    }
  });
}

function extractPrimaryPerson() {
  const firstLine = text.split('\n').find((line) => line.trim());
  if (!firstLine) return;
  const match = firstLine.match(/^([^，,（(]+)/);
  if (match) addEntity('人物', match[1], '首句主体');

  const aliasMatch = firstLine.match(/英语[:：]\s*([A-Za-z][A-Za-z .'-]+)/);
  if (aliasMatch) addEntity('人物', aliasMatch[1], '英文别名');

  const translatedAliases = [];
  const aliasRegex = /又译([^，。,（）]+)/g;
  let alias;
  while ((alias = aliasRegex.exec(firstLine)) !== null) {
    alias[1]
      .split(/或者|或|、|和/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => translatedAliases.push(item));
  }
  translatedAliases.forEach((item) => addEntity('人物', item, '中文别名'));
}

function extractPersons() {
  extractPrimaryPerson();
  extractWithRegex('人物', /\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})\b/g, '英文人名模式', (match) => {
    const value = match[1];
    if (/\b(of|to|with|and|on|The|Foundations)\b/i.test(value)) return null;
    if (value.length > 40) return null;
    return value;
  });

  extractWithRegex('人物', /\b([A-Z]\.[A-Z]\.[A-Za-z一-龥]{1,8})\b/g, '英文缩写人名');

  addSentenceMatch('人物', /(?:父亲|母亲|历史学家|破译员|得主|首相|国王|女王)([A-Za-z][A-Za-z .'-]{1,40}|[一-龥]{2,8}(?:·[一-龥]{1,8}){0,2})/g, '人物上下文');
  addSentenceMatch('人物', /([一-龥]{2,8}(?:·[一-龥]{1,8}){1,3})/g, '中译外文人名', (value) => {
    if (value.length > 18) return '';
    return value;
  });
  addSentenceMatch('人物', /([一-龥]{2,6})(?:曾说过|撰文|回答说)/g, '中文人物上下文');

  addFromList(
    '人物',
    [
      '艾伦·麦席森·图灵',
      'Alan Mathison Turing',
      '阿兰·图灵',
      '图灵',
      '朱利斯·麦席森·图灵',
      'Ethel Sara Stoney',
      '阿尔伯特·爱因斯坦',
      '亚尔·瓦尔德马·林德伯格',
      '阿隆佐·邱奇',
      '简·伊丽莎·宝洁',
      '冯·诺依曼',
      '维特根斯坦',
      'Asa Briggs',
      '第利温·诺克斯',
      'Ronald Lewin',
      'I·J·古德',
      '彼得希尔顿',
      '汤姆·理查兹',
      'Thomas Richards',
      '哈里·欣斯利',
      '乔治六世',
      '戈登·布朗',
      '麦克纳利',
      '伊丽莎白二世',
      '理查德',
    ],
    '人物词表'
  );
}

function extractOrganizations() {
  addSentenceMatch(
    '机构',
    /([A-Za-z一-龥&·'\- ]{2,30}(?:大学|学院|实验室|学校|密码局|档案馆|数学系|俱乐部|代表队|国家实验室))/g,
    '机构后缀模式',
    (value) => value.replace(/^(在|于|到|入|考入)/, '').trim()
  );

  addFromList(
    '机构',
    [
      'Hut 8',
      '剑桥大学国王学院',
      '普林斯顿大学',
      '布莱切利庄园',
      '布莱奇利庄园',
      '英国密码破译组织政府密码和密码学校',
      'GC&CS',
      'GCHQ',
      '英国皇家海军',
      '英国军情六处',
      '国家物理实验室',
      '曼彻斯特大学计算机实验室',
      '洛斯阿拉莫斯国家实验室',
      '沃尔顿竞技俱乐部',
      '英国首相府邸',
      '英国司法部',
      '英国上议院',
      '英国国家档案馆',
    ],
    '机构词表'
  );
}

function extractLocations() {
  addFromList(
    '地点',
    [
      '英国',
      '伦敦',
      '帕丁顿',
      '英属印度',
      '英伦',
      '印度',
      '吉尔福德',
      '多塞特郡',
      '南安普顿',
      '剑桥',
      '普林斯顿',
      '华沙',
      '大西洋',
      '东柴郡威姆斯洛',
      '新墨西哥州洛斯阿拉莫斯',
      '法国',
    ],
    '地点词表'
  );
}

function extractWorks() {
  extractWithRegex('作品', /《([^》]+)》/g, '书名号作品');

  extractWithRegex(
    '作品',
    /题为\s*([A-Za-z][A-Za-z ]{3,80})/g,
    '英文题名',
    (match) => match[1].trim()
  );

  addFromList(
    '作品',
    [
      'On Computable Numbers, with an Application to the Entscheidungsproblem',
      'The Applications of Probability to Cryptography',
      'Paper on Statistics of Repetitions',
      'The Chemical Basis of Morphogenesis',
      'Nova PBS纪录片《解码纳粹秘密》',
      '艾伦·图灵选集',
    ],
    '作品词表'
  );
}

function extractConcepts() {
  addFromList(
    '概念',
    [
      '图灵测试',
      '图灵机',
      '恩尼格玛密码机',
      '停机问题',
      '中心极限定理',
      '判定问题',
      '序数逻辑',
      '相对计算',
      '预言机',
      'λ演算',
      '自动计算引擎',
      'ACE',
      '曼彻斯特一号',
      '人工智能',
      '计算机科学',
      '形态发生',
      '斐波那契叶序列',
      '反应-扩散公式',
      'Bombe',
      '炸弹',
    ],
    '概念词表'
  );
}

function extractEvents() {
  addSentenceMatch('事件', /([一-龥A-Za-z0-9·]{2,20}(?:战役|大战|会议|讲座|大罢工|赛跑|试训|请愿|法案))/g, '事件后缀模式');

  addFromList(
    '事件',
    [
      '第二次世界大战',
      '二次世界大战',
      '大西洋战役',
      '奥林匹克运动会',
      '图灵法案',
      '越野赛跑',
    ],
    '事件词表'
  );
}

function extractTimes() {
  extractWithRegex(
    '时间',
    /\b(\d{4}年(?:\d{1,2}月(?:\d{1,2}日)?)?)\b/g,
    '时间模式'
  );

  addFromList(
    '时间',
    [
      '二次世界大战期间',
      '第二次世界大战期间',
      '1945年到1948年',
      '1936年9月到1938年7月',
    ],
    '时间词表'
  );
}

function extractHonors() {
  addFromList(
    '荣誉',
    [
      'OBE',
      'FRS',
      '大英帝国勋章',
      '简·伊丽莎·宝洁奖学金',
      '博士学位',
      '一等荣誉',
      '研究员',
    ],
    '荣誉词表'
  );
}

function pruneNoise() {
  const invalidByCategory = {
    人物: [
      '美国数学世纪的回忆',
      'Can Machines Think',
      'Foundations of mathematics',
      '死后',
      '要求英国政府',
      'Jane Eliza Procter Visiting',
      'Nova PBS',
      'St. Michaels',
      'The Applications',
      'The Chemical Basis',
      '艾伦·图灵法案',
      '艾伦·图灵选集',
    ],
    机构: [
      '英国',
      '法国',
      '要求英国政府',
      '并因为其性倾向而遭到当时的英国政府',
      '并在英国军情六处',
      '从而使得军情六处',
      '但是军情六处',
      '负责德国海军',
      '图灵在学校',
      '政府密码和密码学校',
      'Michaels的日间学校',
    ],
    地点: ['英伦与朋友同住'],
    作品: ['英语', '主条目', '官方保密法', '每日电讯报', '自然'],
    事件: ['在第二次世界大战', '使盟军能够在包括大西洋战役', '不幸遇上了大罢工'],
  };

  Object.entries(invalidByCategory).forEach(([category, invalidList]) => {
    const categoryMap = entityStore.get(category);
    if (!categoryMap) return;
    invalidList.forEach((item) => categoryMap.delete(item));
    Array.from(categoryMap.keys()).forEach((name) => {
      if (name.length > 24) categoryMap.delete(name);
      if (/的|了|在|并|使|月才被发布给/.test(name) && category !== '作品') categoryMap.delete(name);
    });
  });
}

function buildOutput() {
  const orderedCategories = ['人物', '机构', '地点', '作品', '概念', '事件', '时间', '荣誉'];
  const result = {
    title: '图灵知识图谱原始文本实体抽取结果',
    input_file: path.basename(inputPath),
    output_time: new Date().toLocaleString('zh-CN', { hour12: false }),
    categories: {},
  };

  orderedCategories.forEach((category) => {
    const categoryMap = entityStore.get(category);
    const entities = categoryMap
      ? Array.from(categoryMap.entries())
        .sort((a, b) => {
          if (b[1].count !== a[1].count) return b[1].count - a[1].count;
          return a[0].localeCompare(b[0], 'zh-CN');
        })
      : []
      ;

    result.categories[category] = entities.map(([name, meta]) => ({
      entity: name,
      count: meta.count,
      sources: Array.from(meta.sources),
    }));
  });

  return JSON.stringify(result, null, 2);
}

extractPersons();
extractOrganizations();
extractLocations();
extractWorks();
extractConcepts();
extractEvents();
extractTimes();
extractHonors();
pruneNoise();

const output = buildOutput();
fs.writeFileSync(outputPath, output, 'utf8');

console.log(`实体抽取完成: ${outputPath}`);
