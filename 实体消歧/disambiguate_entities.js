const fs = require('fs');
const path = require('path');
const {
  normalizeText,
  resolvePath,
  readJson,
  unique,
  toRegExp,
} = require('..\\kg_common');

const configPath = path.join(__dirname, 'disambiguation_config.json');
const config = readJson(configPath);
const inputPath = resolvePath(__dirname, config.inputPath);
const outputPath = resolvePath(__dirname, config.outputPath);
const rawData = readJson(inputPath);

function stripRepeatedAffixes(value, affixes, mode) {
  let current = value;
  let changed = true;

  while (changed) {
    changed = false;
    for (const affix of affixes || []) {
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
  return normalizeText(value).replace(/^[，,、；：:.\s]+|[，,、；：:.\s]+$/g, '');
}

function cleanEntityName(name, category) {
  let cleaned = normalizeEntity(name);
  const rules = (config.cleanRules && config.cleanRules[category]) || {};

  cleaned = stripRepeatedAffixes(cleaned, rules.prefixes, 'prefix');
  cleaned = stripRepeatedAffixes(cleaned, rules.suffixes, 'suffix');

  (config.stripPrefixes || []).forEach((prefix) => {
    if (cleaned.startsWith(prefix) && cleaned.length > prefix.length) {
      cleaned = cleaned.slice(prefix.length).trim();
    }
  });

  return cleaned;
}

function shouldDropEntity(name, category) {
  const minLength = (config.limits && config.limits.minLength) || 2;
  if (!name || name.length < minLength) return true;

  const patterns = ((config.dropPatterns && config.dropPatterns[category]) || []).map((pattern) => toRegExp(pattern));
  if (patterns.some((pattern) => pattern.test(name))) return true;

  if (category === '人物') {
    const personMaxPlainLength = (config.limits && config.limits.personMaxPlainLength) || 8;
    if (!/[·A-Za-z一-龥]/.test(name)) return true;
    if (!/[·A-Za-z]/.test(name) && name.length > personMaxPlainLength) return true;
  }

  const validationPattern = config.validationPatterns && config.validationPatterns[category];
  if (validationPattern && !toRegExp(validationPattern).test(name)) {
    return true;
  }

  return false;
}

function getCanonicalName(name, category) {
  const categoryMap = (config.canonicalMap && config.canonicalMap[category]) || {};
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

  return {
    entities: Array.from(merged.values())
      .map((item) => ({
        canonical_entity: item.canonical_entity,
        aliases: unique(Array.from(item.aliases)).sort((a, b) => a.localeCompare(b, 'zh-CN')),
        count_estimate: item.count_estimate,
        alias_count_sum: item.alias_count_sum,
        sources: unique(Array.from(item.sources)).sort((a, b) => a.localeCompare(b, 'zh-CN')),
        disambiguation: unique(Array.from(item.strategies)),
        confidence: getConfidence({
          aliases: Array.from(item.aliases),
          sources: Array.from(item.sources),
        }),
      }))
      .sort((a, b) => {
        if (b.count_estimate !== a.count_estimate) return b.count_estimate - a.count_estimate;
        return a.canonical_entity.localeCompare(b.canonical_entity, 'zh-CN');
      }),
    dropped,
  };
}

function buildOutput() {
  const output = {
    title: config.title || '知识图谱实体消歧结果',
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

  (config.categoryOrder || []).forEach((category) => {
    const items = rawData.categories[category] || [];
    output.summary.raw_entity_count += items.length;

    const categoryResult = disambiguateCategory(category, items);
    output.categories[category] = categoryResult.entities;
    output.dropped_entities[category] = categoryResult.dropped;
    output.summary.disambiguated_entity_count += categoryResult.entities.length;
    output.summary.dropped_entity_count += categoryResult.dropped.length;
  });

  return output;
}

fs.writeFileSync(outputPath, JSON.stringify(buildOutput(), null, 2), 'utf8');
console.log(`实体消歧完成: ${outputPath}`);
