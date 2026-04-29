const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'Turing_entities.json');
const outputPath = path.join(__dirname, 'Turing_entities_disambiguated.json');

const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const CATEGORY_ORDER = ['人物', '机构', '地点', '作品', '概念', '事件', '时间', '荣誉'];

const CLEAN_RULES = {
  人物: {
    prefixes: [
      '又译',
      '密码破译员',
      '战时密码破译员',
      '战争历史学家',
      '历史学家',
      '运会银牌得主',
      '国银牌得主',
      '银牌得主',
      '得主',
      '英国首相',
      '首相',
      '国王',
      '女王',
      '父亲',
      '母亲',
    ],
    suffixes: ['一起专注于', '估计', '赦免', '攻读本科', '研究员'],
  },
  机构: {
    prefixes: ['图灵考入', '他成为', '他是', '随后', '获', '在', '于', '到', '入', '考入'],
    suffixes: [],
  },
  事件: {
    prefixes: ['有', '一份超过'],
    suffixes: [],
  },
};

const DROP_PATTERNS = {
  人物: [
    /和战时密码破译员/,
    /^任命为/,
    /^学院/,
    /^密码破译员$/,
    /大英帝国勋$/,
  ],
  机构: [
    /^图灵$/,
    /^他$/,
  ],
  事件: [
    /^有\d+万多人签名请愿$/,
    /^一份超过\d+万人的请愿$/,
  ],
};

const CANONICAL_MAP = {
  人物: {
    图灵: '艾伦·麦席森·图灵',
    阿兰·图灵: '艾伦·麦席森·图灵',
    'Alan Mathison Turing': '艾伦·麦席森·图灵',
    'Julius Mathison Turing': '朱利斯·麦席森·图灵',
    'Thomas Richards': '托马斯·理查兹',
    '汤姆·理查兹': '托马斯·理查兹',
  },
  机构: {
    布莱奇利庄园: '布莱切利庄园',
  },
  作品: {
    'Nova PBS纪录片《解码纳粹秘密》': '解码纳粹秘密',
  },
  事件: {
    二次世界大战: '第二次世界大战',
    '艾伦·图灵法案': '图灵法案',
  },
};

function uniq(values) {
  return Array.from(new Set(values));
}

function stripRepeatedAffixes(value, affixes, mode) {
  let current = value;
  let changed = true;

  while (changed) {
    changed = false;
    for (const affix of affixes) {
      if (mode === 'prefix' && current.startsWith(affix) && current.length > affix.length) {
        current = current.slice(affix.length).trim();
        changed = true;
      }
      if (mode === 'suffix' && current.endsWith(affix) && current.length > affix.length) {
        current = current.slice(0, -affix.length).trim();
        changed = true;
      }
    }
  }

  return current;
}

function normalizeEntity(value) {
  return String(value || '')
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，,、；：:.\s]+|[，,、；：:.\s]+$/g, '')
    .trim();
}

function cleanEntityName(name, category) {
  let cleaned = normalizeEntity(name);
  const rules = CLEAN_RULES[category];

  if (rules) {
    cleaned = stripRepeatedAffixes(cleaned, rules.prefixes || [], 'prefix');
    cleaned = stripRepeatedAffixes(cleaned, rules.suffixes || [], 'suffix');
  }

  cleaned = cleaned
    .replace(/^的/, '')
    .replace(/^和/, '')
    .replace(/^请愿书/, '')
    .replace(/^纪录片/, '')
    .trim();

  return cleaned;
}

function shouldDropEntity(name, category) {
  if (!name || name.length < 2) return true;

  const patterns = DROP_PATTERNS[category] || [];
  if (patterns.some((pattern) => pattern.test(name))) return true;

  if (category === '人物') {
    if (!/[·A-Za-z一-龥]/.test(name)) return true;
    if (!/[·A-Za-z]/.test(name) && name.length > 8) return true;
  }

  if (category === '机构') {
    if (!/(大学|学院|实验室|学校|密码局|档案馆|数学系|俱乐部|代表队|国家实验室|庄园|海军|军情六处|政府|首相府邸|司法部|上议院|GCHQ|GC&CS|Hut 8)/.test(name)) {
      return true;
    }
  }

  if (category === '事件') {
    if (!/(战役|大战|会议|讲座|大罢工|赛跑|试训|请愿|法案|运动会)/.test(name)) {
      return true;
    }
  }

  return false;
}

function getCanonicalName(name, category) {
  const categoryMap = CANONICAL_MAP[category] || {};
  return categoryMap[name] || name;
}

function getConfidence(record) {
  if (record.aliases.length >= 3) return 'high';
  if (record.aliases.length === 2 || record.sources.length >= 2) return 'medium';
  return 'low';
}

function disambiguateCategory(category, items) {
  const merged = new Map();
  const dropped = [];

  for (const item of items || []) {
    const original = normalizeEntity(item.entity);
    const cleaned = cleanEntityName(original, category);

    if (shouldDropEntity(cleaned, category)) {
      dropped.push({
        original_entity: original,
        cleaned_entity: cleaned,
        reason: '规则判定为噪声或不完整实体',
      });
      continue;
    }

    const canonical = getCanonicalName(cleaned, category);

    if (!merged.has(canonical)) {
      merged.set(canonical, {
        canonical_entity: canonical,
        aliases: new Set(),
        count_estimate: 0,
        alias_count_sum: 0,
        sources: new Set(),
        strategies: new Set(),
      });
    }

    const current = merged.get(canonical);
    current.aliases.add(original);
    current.aliases.add(cleaned);
    current.count_estimate = Math.max(current.count_estimate, item.count || 0);
    current.alias_count_sum += item.count || 0;
    (item.sources || []).forEach((source) => current.sources.add(source));

    if (original !== cleaned) current.strategies.add('规则清洗');
    if (canonical !== cleaned) current.strategies.add('别名合并');
    if (original === cleaned && canonical === cleaned) current.strategies.add('直接保留');
  }

  const result = Array.from(merged.values())
    .map((item) => ({
      canonical_entity: item.canonical_entity,
      aliases: uniq(Array.from(item.aliases)).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      count_estimate: item.count_estimate,
      alias_count_sum: item.alias_count_sum,
      sources: uniq(Array.from(item.sources)).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      disambiguation: uniq(Array.from(item.strategies)),
      confidence: getConfidence({
        aliases: Array.from(item.aliases),
        sources: Array.from(item.sources),
      }),
    }))
    .sort((a, b) => {
      if (b.count_estimate !== a.count_estimate) return b.count_estimate - a.count_estimate;
      return a.canonical_entity.localeCompare(b.canonical_entity, 'zh-CN');
    });

  return { entities: result, dropped };
}

function buildOutput() {
  const output = {
    title: '图灵知识图谱实体消歧结果',
    based_on: path.basename(inputPath),
    output_time: new Date().toLocaleString('zh-CN', { hour12: false }),
    summary: {
      raw_entity_count: 0,
      disambiguated_entity_count: 0,
      dropped_entity_count: 0,
    },
    categories: {},
    dropped_entities: {},
  };

  for (const category of CATEGORY_ORDER) {
    const items = rawData.categories[category] || [];
    output.summary.raw_entity_count += items.length;

    const categoryResult = disambiguateCategory(category, items);
    output.categories[category] = categoryResult.entities;
    output.dropped_entities[category] = categoryResult.dropped;

    output.summary.disambiguated_entity_count += categoryResult.entities.length;
    output.summary.dropped_entity_count += categoryResult.dropped.length;
  }

  return JSON.stringify(output, null, 2);
}

fs.writeFileSync(outputPath, buildOutput(), 'utf8');
console.log(`实体消歧完成: ${outputPath}`);
