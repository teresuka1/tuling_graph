const fs = require('fs');
const path = require('path');
const {
  normalizeText,
  splitSentences,
  resolvePath,
  readJson,
  countOccurrences,
  toRegExp,
} = require('..\\kg_common');

const configPath = path.join(__dirname, 'entity_config.json');
const config = readJson(configPath);
const inputPath = resolvePath(__dirname, config.inputPath);
const outputPath = resolvePath(__dirname, config.outputPath);

const rawText = fs.readFileSync(inputPath, 'utf8');
const text = rawText.replace(/\r/g, '');
const sentences = splitSentences(text);
const firstLine = text.split('\n').find((line) => line.trim()) || '';
const entityStore = new Map();
const stopEntities = new Set(config.stopEntities || []);
const noisePatterns = (config.noisePatterns || []).map((pattern) => toRegExp(pattern));

function normalizeEntity(value) {
  return normalizeText(value)
    .replace(/[()（）]/g, '')
    .replace(/^[，,、；：:.\s]+|[，,、；：:.\s]+$/g, '')
    .trim();
}

const filters = {
  englishPerson(value) {
    if (!value) return '';
    if (/\b(of|to|with|and|on|The|Foundations)\b/i.test(value)) return '';
    if (value.length > 40) return '';
    return value;
  },
  maxLen18(value) {
    return value && value.length <= 18 ? value : '';
  },
  stripOrgLeading(value) {
    return String(value || '').replace(/^(在|于|到|入|考入)/, '').trim();
  },
};

function applyFilter(value, filterName) {
  if (!filterName) return value;
  const filter = filters[filterName];
  return filter ? filter(value) : value;
}

function addEntity(category, value, sourceLabel) {
  const name = normalizeEntity(value);
  if (!name || name.length < 2) return;
  if (stopEntities.has(name)) return;
  if (/^[0-9]+$/.test(name)) return;
  if (noisePatterns.some((pattern) => pattern.test(name))) return;

  if (!entityStore.has(category)) {
    entityStore.set(category, new Map());
  }

  const categoryMap = entityStore.get(category);
  if (!categoryMap.has(name)) {
    categoryMap.set(name, { count: 0, sources: new Set() });
  }

  const current = categoryMap.get(name);
  current.count = Math.max(current.count, countOccurrences(text, name) || 1);
  if (sourceLabel) current.sources.add(sourceLabel);
}

function runRule(rule) {
  if (rule.type === 'list') {
    (rule.values || []).forEach((item) => {
      if (text.includes(item)) addEntity(rule.category, item, rule.sourceLabel);
    });
    return;
  }

  if (rule.type === 'first_line_leading') {
    const match = firstLine.match(toRegExp(rule.pattern));
    if (match) addEntity(rule.category, match[1] || match[0], rule.sourceLabel);
    return;
  }

  if (rule.type === 'first_line_regex') {
    const match = firstLine.match(toRegExp(rule.pattern, rule.flags));
    if (match) addEntity(rule.category, applyFilter(match[1] || match[0], rule.filter), rule.sourceLabel);
    return;
  }

  if (rule.type === 'first_line_split_regex') {
    const regex = toRegExp(rule.pattern, rule.flags || 'g');
    let match;
    while ((match = regex.exec(firstLine)) !== null) {
      const rawValue = match[1] || match[0];
      rawValue
        .split(toRegExp(rule.splitPattern))
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => addEntity(rule.category, item, rule.sourceLabel));
    }
    return;
  }

  if (rule.type === 'global_regex') {
    const regex = toRegExp(rule.pattern, rule.flags || 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      addEntity(rule.category, applyFilter(match[1] || match[0], rule.filter), rule.sourceLabel);
    }
    return;
  }

  if (rule.type === 'sentence_regex') {
    const regex = toRegExp(rule.pattern, rule.flags || 'g');
    sentences.forEach((sentence) => {
      const localRegex = toRegExp(rule.pattern, rule.flags || 'g');
      let match;
      while ((match = localRegex.exec(sentence)) !== null) {
        addEntity(rule.category, applyFilter(match[1] || match[0], rule.filter), rule.sourceLabel);
      }
    });
  }
}

function pruneNoise() {
  const invalidByCategory = (config.prune && config.prune.invalidByCategory) || {};
  const maxLength = (config.prune && config.prune.maxLength) || 0;
  const containsPattern = config.prune && config.prune.containsPattern
    ? toRegExp(config.prune.containsPattern)
    : null;
  const excludeCategories = new Set((config.prune && config.prune.containsPatternExcludeCategories) || []);

  Object.entries(invalidByCategory).forEach(([category, invalidList]) => {
    const categoryMap = entityStore.get(category);
    if (!categoryMap) return;
    invalidList.forEach((item) => categoryMap.delete(item));
    Array.from(categoryMap.keys()).forEach((name) => {
      if (maxLength && name.length > maxLength) categoryMap.delete(name);
      if (containsPattern && !excludeCategories.has(category) && containsPattern.test(name)) categoryMap.delete(name);
    });
  });
}

function buildOutput() {
  const result = {
    title: config.title || '知识图谱原始文本实体抽取结果',
    input_file: path.basename(inputPath),
    output_time: new Date().toLocaleString('zh-CN', { hour12: false }),
    categories: {},
  };

  (config.orderedCategories || []).forEach((category) => {
    const categoryMap = entityStore.get(category);
    const entities = categoryMap
      ? Array.from(categoryMap.entries()).sort((a, b) => {
        if (b[1].count !== a[1].count) return b[1].count - a[1].count;
        return a[0].localeCompare(b[0], 'zh-CN');
      })
      : [];

    result.categories[category] = entities.map(([name, meta]) => ({
      entity: name,
      count: meta.count,
      sources: Array.from(meta.sources),
    }));
  });

  return result;
}

(config.rules || []).forEach(runRule);
pruneNoise();
fs.writeFileSync(outputPath, JSON.stringify(buildOutput(), null, 2), 'utf8');
console.log(`实体抽取完成: ${outputPath}`);
