const fs = require('fs');
const path = require('path');

const textPath = 'D:\\Turing_graph\\Turing.txt';
const entityPath = 'D:\\Turing_graph\\实体消歧\\Turing_entities_disambiguated.json';
const outputPath = 'D:\\Turing_graph\\关系抽取\\Turing_relations.json';

const rawText = fs.readFileSync(textPath, 'utf8').replace(/\r/g, '');
const entityData = JSON.parse(fs.readFileSync(entityPath, 'utf8'));

const orderedCategories = ['人物', '机构', '地点', '作品', '概念', '事件', '时间', '荣誉'];

function normalizeText(value) {
  return String(value || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  return text
    .split(/[。！？\n]/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function buildAliasIndex(data) {
  const aliasIndex = new Map();

  orderedCategories.forEach((category) => {
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
  const key = [
    relation.subject,
    relation.predicate,
    relation.object,
    relation.time || '',
  ].join('||');

  if (!store.has(key)) {
    store.set(key, {
      subject: relation.subject,
      subject_type: relation.subject_type,
      predicate: relation.predicate,
      object: relation.object,
      object_type: relation.object_type,
      time: relation.time || null,
      evidence: new Set(),
      extraction_rule: relation.extraction_rule,
    });
  }

  const current = store.get(key);
  current.evidence.add(relation.evidence);
}

function addSimpleMatchRelation(store, sentence, entities, config) {
  const subject = entities.find((item) => item.canonical === config.subject);
  if (!subject || !sentence.includes(config.keyword)) return;

  const candidates = entities.filter((item) => item.category === config.object_category);
  candidates.forEach((target) => {
    if (config.object_filter && !config.object_filter(target.canonical, sentence)) return;
    addRelation(store, {
      subject: subject.canonical,
      subject_type: subject.category,
      predicate: config.predicate,
      object: target.canonical,
      object_type: target.category,
      time: extractTime(sentence),
      evidence: sentence,
      extraction_rule: config.rule_name,
    });
  });
}

function addCollaborationRelations(store, sentence, entities) {
  if (!entities.some((item) => item.canonical === '艾伦·麦席森·图灵')) return;

  const candidates = entities.filter((item) => item.category === '人物' && item.canonical !== '艾伦·麦席森·图灵');

  if (sentence.includes('与图灵一起工作')) {
    const anchor = sentence.indexOf('与图灵一起工作');
    candidates
      .filter((item) => sentence.indexOf(item.mention) > anchor)
      .forEach((item) => {
        addRelation(store, {
          subject: '艾伦·麦席森·图灵',
          subject_type: '人物',
          predicate: '合作对象',
          object: item.canonical,
          object_type: item.category,
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: '合作关系-共同工作',
        });
      });
  }

  if (sentence.includes('图灵和') && /(开发|合作|专注于)/.test(sentence)) {
    const anchor = sentence.indexOf('图灵和');
    candidates
      .filter((item) => sentence.indexOf(item.mention) > anchor)
      .forEach((item) => {
        addRelation(store, {
          subject: '艾伦·麦席森·图灵',
          subject_type: '人物',
          predicate: '合作对象',
          object: item.canonical,
          object_type: item.category,
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: '合作关系-并列主语',
        });
      });
  }
}

function extractRuleRelations(sentences, aliasIndex) {
  const store = new Map();

  sentences.forEach((sentence) => {
    const entities = findEntitiesInSentence(sentence, aliasIndex);
    const hasTuring = entities.some((item) => item.canonical === '艾伦·麦席森·图灵');

    if (hasTuring) {
      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '父亲',
        predicate: '父亲是',
        object_category: '人物',
        object_filter: (name) => name !== '艾伦·麦席森·图灵',
        rule_name: '亲属关系-父亲',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '母亲',
        predicate: '母亲是',
        object_category: '人物',
        object_filter: (name) => name !== '艾伦·麦席森·图灵',
        rule_name: '亲属关系-母亲',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '考入',
        predicate: '就读于',
        object_category: '机构',
        rule_name: '教育经历-考入',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '研究员',
        predicate: '任职于',
        object_category: '机构',
        rule_name: '任职关系-研究员',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '在',
        predicate: '任职于',
        object_category: '机构',
        object_filter: (_, text) => /(负责|兼职工作|副主任|招聘|监督下从事|工作期间)/.test(text),
        rule_name: '任职关系-机构上下文',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '负责',
        predicate: '研究',
        object_category: '概念',
        rule_name: '研究关系-负责',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '提出',
        predicate: '提出',
        object_category: '概念',
        rule_name: '概念提出',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '写了',
        predicate: '创作',
        object_category: '作品',
        rule_name: '作品创作-写了',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '发表了一篇论文',
        predicate: '发表',
        object_category: '作品',
        rule_name: '作品发表-论文',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '获得了',
        predicate: '获得',
        object_category: '荣誉',
        rule_name: '荣誉获得',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '被评选为',
        predicate: '获得',
        object_category: '荣誉',
        rule_name: '荣誉获得-被评选',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '获',
        predicate: '获得',
        object_category: '荣誉',
        object_filter: (_, text) => /(博士学位|勋章)/.test(text),
        rule_name: '荣誉获得-获',
      });

      addSimpleMatchRelation(store, sentence, entities, {
        subject: '艾伦·麦席森·图灵',
        keyword: '被誉为',
        predicate: '被誉为',
        object_category: '概念',
        object_filter: (name, text) => text.includes(name),
        rule_name: '称号关系',
      });
    }

    if (sentence.includes('被选为') && hasTuring) {
      const org = entities.find((item) => item.category === '机构');
      if (org) {
        addRelation(store, {
          subject: '艾伦·麦席森·图灵',
          subject_type: '人物',
          predicate: '任职于',
          object: org.canonical,
          object_type: org.category,
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: '任职关系-被选为',
        });
      }
    }

    if (sentence.includes('在') && sentence.includes('出生') && hasTuring) {
      const place = entities.find((item) => item.category === '地点' && /英国|伦敦|帕丁顿/.test(item.canonical));
      if (place) {
        addRelation(store, {
          subject: '艾伦·麦席森·图灵',
          subject_type: '人物',
          predicate: '出生地',
          object: place.canonical,
          object_type: place.category,
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: '出生地关系',
        });
      }
    }

    if (sentence.includes('在') && sentence.includes('怀了孕')) {
      const mother = entities.find((item) => item.canonical === 'Ethel Sara Stoney');
      const place = entities.find((item) => item.category === '地点');
      if (mother && place) {
        addRelation(store, {
          subject: mother.canonical,
          subject_type: mother.category,
          predicate: '怀孕地点',
          object: place.canonical,
          object_type: place.category,
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: '地点关系-怀孕',
        });
      }
    }

    if (hasTuring && sentence.includes('遭到') && sentence.includes('英国政府迫害')) {
      addRelation(store, {
        subject: '英国政府',
        subject_type: '机构',
        predicate: '迫害',
        object: '艾伦·麦席森·图灵',
        object_type: '人物',
        time: extractTime(sentence),
        evidence: sentence,
        extraction_rule: '迫害关系',
      });
    }

    if (hasTuring && sentence.includes('赦免')) {
      const actor = entities.find((item) => item.canonical === '伊丽莎白二世');
      if (actor) {
        addRelation(store, {
          subject: actor.canonical,
          subject_type: actor.category,
          predicate: '赦免',
          object: '艾伦·麦席森·图灵',
          object_type: '人物',
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: '赦免关系',
        });
      }
    }

    if (sentence.includes('公开道歉')) {
      const actor = entities.find((item) => item.canonical === '戈登·布朗');
      if (actor && hasTuring) {
        addRelation(store, {
          subject: actor.canonical,
          subject_type: actor.category,
          predicate: '公开道歉对象',
          object: '艾伦·麦席森·图灵',
          object_type: '人物',
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: '道歉关系',
        });
      }
    }

    addCollaborationRelations(store, sentence, entities);

    if (hasTuring && sentence.includes('跑赢了')) {
      const target = entities.find((item) => item.category === '人物' && item.canonical !== '艾伦·麦席森·图灵');
      if (target) {
        addRelation(store, {
          subject: '艾伦·麦席森·图灵',
          subject_type: '人物',
          predicate: '比赛胜过',
          object: target.canonical,
          object_type: target.category,
          time: extractTime(sentence),
          evidence: sentence,
          extraction_rule: '竞赛关系',
        });
      }
    }
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
  const relations = extractRuleRelations(sentences, aliasIndex);

  return JSON.stringify(
    {
      title: '图灵知识图谱关系抽取结果',
      input_text_file: path.basename(textPath),
      input_entity_file: path.basename(entityPath),
      output_time: new Date().toLocaleString('zh-CN', { hour12: false }),
      summary: {
        sentence_count: sentences.length,
        relation_count: relations.length,
      },
      relations,
    },
    null,
    2
  );
}

fs.writeFileSync(outputPath, buildOutput(), 'utf8');
console.log(`关系抽取完成: ${outputPath}`);
