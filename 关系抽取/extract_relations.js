const fs = require('fs');
const path = require('path');
const {
  normalizeText,
  splitSentences,
  resolvePath,
  readJson,
  toRegExp,
} = require('..\\kg_common');

const configPath = path.join(__dirname, 'relation_config.json');
const config = readJson(configPath);
const textPath = resolvePath(__dirname, config.textPath);
const entityPath = resolvePath(__dirname, config.entityPath);
const outputPath = resolvePath(__dirname, config.outputPath);

const rawText = fs.readFileSync(textPath, 'utf8').replace(/\r/g, '');
const entityData = readJson(entityPath);

function buildAliasIndex(data) {
  const aliasIndex = new Map();

  (config.orderedCategories || []).forEach((category) => {
    const entities = data.categories[category] || [];
    entities.forEach((entity) => {
      const aliases = new Set([entity.canonical_entity, ...(entity.aliases || [])]);
      aliases.forEach((alias) => {
        const normalizedAlias = normalizeText(alias);
        if (!normalizedAlias) return;
        aliasIndex.set(normalizedAlias, {
          canonical: entity.canonical_entity,
          category,
        });
      });
    });
  });

  return aliasIndex;
}

function findEntitiesInSentence(sentence, aliasIndex) {
  const matched = [];
  aliasIndex.forEach((info, alias) => {
    if (sentence.includes(alias)) {
      matched.push({
        mention: alias,
        canonical: info.canonical,
        category: info.category,
      });
    }
  });

  const unique = new Map();
  matched
    .sort((a, b) => b.mention.length - a.mention.length)
    .forEach((item) => {
      const key = `${item.canonical}::${item.category}`;
      if (!unique.has(key)) unique.set(key, item);
    });

  return Array.from(unique.values());
}

function extractTime(sentence) {
  const match = sentence.match(/\d{4}年(?:\d{1,2}月(?:\d{1,2}日)?)?/);
  return match ? match[0] : null;
}

function addRelation(store, relation) {
  const key = [relation.subject, relation.predicate, relation.object, relation.time || ''].join('||');
  if (!store.has(key)) {
    store.set(key, {
      ...relation,
      time: relation.time || null,
      evidence: new Set(),
    });
  }
  store.get(key).evidence.add(relation.evidence);
}

function sentenceMatches(rule, sentence) {
  if (rule.keyword && !sentence.includes(rule.keyword)) return false;
  if (rule.sentencePattern && !toRegExp(rule.sentencePattern).test(sentence)) return false;
  return true;
}

function getEntitiesByCategory(entities, category, rule, subjectCanonical) {
  return entities.filter((item) => {
    if (item.category !== category) return false;
    if (rule.excludeSubject && item.canonical === subjectCanonical) return false;
    if (rule.objectNamePattern && !toRegExp(rule.objectNamePattern).test(item.canonical)) return false;
    return true;
  });
}

function runRule(rule, sentence, entities, store) {
  if (!sentenceMatches(rule, sentence)) return;

  if (rule.type === 'subject_to_category' || rule.type === 'subject_to_first_category') {
    const subject = entities.find((item) => item.canonical === rule.subjectCanonical);
    if (!subject) return;
    const candidates = getEntitiesByCategory(entities, rule.objectCategory, rule, rule.subjectCanonical);
    const targets = rule.type === 'subject_to_first_category' ? candidates.slice(0, 1) : candidates;

    targets.forEach((target) => {
      addRelation(store, {
        subject: subject.canonical,
        subject_type: subject.category,
        predicate: rule.predicate,
        object: target.canonical,
        object_type: target.category,
        time: extractTime(sentence),
        evidence: sentence,
        extraction_rule: rule.ruleName,
      });
    });
    return;
  }

  if (rule.type === 'fixed_to_fixed') {
    addRelation(store, {
      subject: rule.subjectLiteral,
      subject_type: rule.subjectType,
      predicate: rule.predicate,
      object: rule.objectLiteral,
      object_type: rule.objectType,
      time: extractTime(sentence),
      evidence: sentence,
      extraction_rule: rule.ruleName,
    });
    return;
  }

  if (rule.type === 'matched_actor_to_fixed') {
    const actor = entities.find((item) => item.canonical === rule.actorCanonical);
    if (!actor) return;
    addRelation(store, {
      subject: actor.canonical,
      subject_type: actor.category,
      predicate: rule.predicate,
      object: rule.objectLiteral,
      object_type: rule.objectType,
      time: extractTime(sentence),
      evidence: sentence,
      extraction_rule: rule.ruleName,
    });
    return;
  }

  if (rule.type === 'anchor_people_relation') {
    const subject = entities.find((item) => item.canonical === rule.subjectCanonical);
    if (!subject || !sentence.includes(rule.anchorPhrase)) return;
    const anchor = sentence.indexOf(rule.anchorPhrase);
    entities
      .filter((item) => item.category === rule.objectCategory && item.canonical !== rule.subjectCanonical)
      .filter((item) => sentence.indexOf(item.mention) > anchor)
      .forEach((item) => {
        addRelation(store, {
          subject: subject.canonical,
          subject_type: subject.category,
          predicate: rule.predicate,
          object: item.canonical,
          object_type: item.category,
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: rule.ruleName,
        });
      });
  }
}

function extractRelations(sentences, aliasIndex) {
  const store = new Map();
  sentences.forEach((sentence) => {
    const entities = findEntitiesInSentence(sentence, aliasIndex);
    (config.rules || []).forEach((rule) => runRule(rule, sentence, entities, store));
  });

  return Array.from(store.values()).map((item) => ({
    subject: item.subject,
    subject_type: item.subject_type,
    predicate: item.predicate,
    object: item.object,
    object_type: item.object_type,
    time: item.time,
    evidence: Array.from(item.evidence),
    extraction_rule: item.extraction_rule,
  }));
}

function buildOutput() {
  const sentences = splitSentences(rawText);
  const aliasIndex = buildAliasIndex(entityData);
  const relations = extractRelations(sentences, aliasIndex);

  return {
    title: config.title || '知识图谱关系抽取结果',
    input_text_file: path.basename(textPath),
    input_entity_file: path.basename(entityPath),
    output_time: new Date().toLocaleString('zh-CN', { hour12: false }),
    summary: {
      sentence_count: sentences.length,
      relation_count: relations.length,
    },
    relations,
  };
}

fs.writeFileSync(outputPath, JSON.stringify(buildOutput(), null, 2), 'utf8');
console.log(`关系抽取完成: ${outputPath}`);
