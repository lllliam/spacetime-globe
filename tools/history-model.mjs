import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import rules from '../src/history-rules.js';
import {readHistorySources} from './migrate-history-model.mjs';
import {compileHistoricalScenes} from './historical-scenes.mjs';
import {loadPolityNames,readPolityIds,readPolityRanges} from './polity-names.mjs';

const {isHistoryYear,historyIncludes,historyOverlaps,referenceId} = rules;
const string = value => typeof value === 'string' && value.trim().length > 0;
const id = value => string(value) && /^[a-z][a-z0-9-]*$/.test(value);
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
const isoCode = value => typeof value === 'string' && /^[A-Z]{2}$/.test(value);
const chinese = value => string(value) && /\p{Script=Han}/u.test(value);
const list = (value, check) => Array.isArray(value) && value.every(check);
const coordinate = (lon,lat) => Number.isFinite(lon) && Math.abs(lon)<=180 && Number.isFinite(lat) && Math.abs(lat)<=90;
const calendarDate = value => string(value) && /^\d{4}-\d{2}-\d{2}(?:T\S+Z)?$/.test(value) && Number.isFinite(Date.parse(value));
const url = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const auditStates = new Set(['legacy','unreviewed','issues','checked','insufficient','disputed']);
const relationKinds = new Set(['legacy','context','further','contemporary','compare','documented']);
const chapterKinds = new Set(['narrative','introduction','retrospective','thematic','epilogue']);
const check = (condition, label) => { if (!condition) throw new Error('历史内容结构：' + label); };
const read = (root, file) => {
  try { return JSON.parse(readFileSync(join(root,file),'utf8')); }
  catch (error) { throw new Error(file + ' 无法解析：' + error.message); }
};

function requireRange(range, label, {unknown = false, required = true} = {}) {
  if (!required && range === undefined) return;
  check(object(range) && (isHistoryYear(range.from) &&
    (range.to === null || isHistoryYear(range.to) && range.to >= range.from) ||
    unknown && range.from === null && range.to === null), label + ' 年代非法');
  if (range.dateLabel !== undefined) check(string(range.dateLabel),label + ' 年代说明无效');
  if (range.approximate !== undefined) check(typeof range.approximate === 'boolean' &&
    (!range.approximate || string(range.dateLabel)),label + ' 近似年代需有说明');
}
function contained(outer,inner) {
  return outer.from !== null && inner.from !== null && outer.from<=inner.from &&
    (inner.to ?? Infinity)<=(outer.to ?? Infinity);
}
function requireAudit(value,label) {
  if (value === undefined) return;
  check(object(value) && auditStates.has(value.status),label + ' 审校状态无效');
  if (value.status === 'checked') check(string(value.scope) && calendarDate(value.checkedAt),label + ' 已核对需注明范围及日期');
  if (['issues','insufficient','disputed'].includes(value.status)) check(string(value.note),label + ' 缺问题或不确定性说明');
  if (value.checks !== undefined) {
    const options = { link:['unchecked','reachable','unavailable'], claim:['unchecked','supported','mixed','unsupported'],
      editorial:['unchecked','accepted','revision-needed'] };
    check(object(value.checks) && Object.entries(value.checks).every(([key,status])=>options[key]?.includes(status)),
      label + ' 审校维度无效');
  }
}
function identities(entities, label, key = item => item.id, valid = id) {
  check(Array.isArray(entities),label + ' 应为数组');
  const found = new Map();
  for (const item of entities) {
    const ident = item && key(item);
    check(valid(ident) && !found.has(ident),label + ' 缺少或重复身份 ' + ident);
    found.set(ident,item);
  }
  return found;
}
function sourceList(value, label) {
  const sources = identities(value,label + ' 来源');
  for (const [key,source] of sources) {
    check(string(source.title) && url(source.url) && (source.checkedAt === undefined || calendarDate(source.checkedAt)),
      label + ' 来源 ' + key + ' 结构无效');
    requireAudit(source.audit,label + '/' + key);
  }
  return sources;
}
function references(value, sources, label, required = true) {
  if (!required && value === undefined) return;
  check(list(value,ref => sources.has(referenceId(ref)) && (typeof ref === 'string' ||
    object(ref) && ['locator','note'].every(field=>ref[field]===undefined || string(ref[field])))),
    label + ' 来源引用无效 ' + JSON.stringify(value));
}
function blockIdentity(seen,blockId,label) {
  check(id(blockId) && !seen.has(blockId),label + ' 缺少或重复正文块 ID ' + blockId);
  seen.add(blockId);
}
function requireBlock(block, seen, sources, label, requiredRefs = true) {
  blockIdentity(seen,block?.id,label);
  check(string(block.text),label + '/' + block.id + ' 缺少正文');
  references(block.refs,sources,label + '/' + block.id,requiredRefs);
  requireAudit(block.audit,label + '/' + block.id);
}
function relationMeta(link,sources,label,origin,destination) {
  check(relationKinds.has(link.relation ?? 'legacy'),label + ' 关系类型无效');
  if (link.id!==undefined) check(id(link.id),label + ' 关系身份无效');
  if (link.display!==undefined) check(string(link.display),label + ' 关系解释无效');
  if (link.time!==undefined) requireRange(link.time,label + ' 关系时间');
  references(link.evidence,sources,label,false);
  if (link.relation==='contemporary') {
    const time = link.time ?? (isHistoryYear(link.year) && {from:link.year,to:link.year});
    check(time && time.to!==null && origin && destination && contained(origin,time) && contained(destination,time) && string(link.display),
      label + ' 同期时间超出源或目标内容范围');
  }
  if (link.relation==='compare') check(string(link.dimension) && string(link.display),label + ' 历史比较缺少维度或解释');
  if (link.relation==='documented') check(link.time && link.time.to!==null && origin && destination &&
    contained(origin,link.time) && contained(destination,link.time) && string(link.display) &&
    link.evidence?.some(ref=>string(ref?.locator) && string(ref?.note)) && link.audit?.status==='checked',
    label + ' 实际历史联系需有联系本身的定位证据、核查范围和时间');
  requireAudit(link.audit,label);
}

export function loadHistoryModel(root, files = readHistorySources(root)) {
  const world = read(root,'data/world.json');
  const plan = read(root,'data/content-plan.json');
  const polityIds = readPolityIds(root);
  const polityRanges = readPolityRanges(root);
  const names = loadPolityNames(root);
  const countries = new Set(world.map.map(([iso])=>iso));
  const regions = identities(world.regions,'data/world.json 地区',item=>item.id,string);
  const events = identities(world.entries,'data/world.json 事件',item=>item.id,string);
  check(regions.size && events.size && countries.size,'data/world.json 地图注册表为空');
  for (const region of regions.values()) check(chinese(region.zh),'data/world.json 地区缺中文 ' + region.id);
  for (const event of events.values()) {
    const label = 'data/world.json/' + event.id;
    requireRange({from:event.start,to:event.point ? event.start : event.end},label);
    check(regions.has(event.region) && chinese(event.zh),label + ' 地区或中文名无效');
    if (event.px != null || event.py != null) check(Number.isFinite(event.px) && event.px>=0 && event.px<=1000 &&
      Number.isFinite(event.py) && event.py>=0 && event.py<=500,label + ' 定位不合法');
  }
  for (const [iso, path] of world.map) check(string(path) && /^M/.test(path.trim()) &&
    (!isoCode(iso) || chinese(world.isoNames[iso])), 'data/world.json 国界无效 ' + iso);

  const registry = files.get('data/history/subjects.json');
  check(registry?.version === 1,'data/history/subjects.json 模型版本无效');
  const locateMap = map => object(map) &&
    (map.type === 'country' ? isoCode(map.key) && countries.has(map.key) : map.type === 'polity' && polityIds.has(map.key));
  const subjects = identities(registry.subjects,'data/history/subjects.json');
  for (const [key,subject] of subjects) {
    const label = 'data/history/subjects.json/' + key;
    check(['region','civilization','polity','country'].includes(subject.type) && string(subject.name),label + ' 类型或名称无效');
    requireRange(subject.range,label,{unknown:true,required:false});
    requireAudit(subject.audit,label);
    if (subject.aliases !== undefined) check(list(subject.aliases,string),label + ' 别名无效');
    if (subject.scope !== undefined) check(string(subject.scope),label + ' 范围说明无效');
    if (subject.sources !== undefined) sourceList(subject.sources,label);
    if (subject.maps !== undefined) check(list(subject.maps,map=>locateMap(map) &&
      (!['polity','country'].includes(subject.type) || subject.type===map.type)),label + ' 底图注册表引用无效');
    if (subject.type === 'country') check(isoCode(subject.iso) && countries.has(subject.iso) &&
      (!subject.maps || subject.maps.every(map=>map.key===subject.iso)),label + ' 现代 ISO 无效');
  }
  for (const [type,asset] of [['country','data/world.json'],['polity','data/polity.bin.gz']]) {
    const metadata = registry.mapSources?.[type], label = '地图元数据/' + type;
    check(metadata?.asset === asset && string(metadata.name) && url(metadata.source) && string(metadata.license) &&
      string(metadata.limitations) && (metadata.version === null || string(metadata.version)) &&
      (metadata.retrievedAt === null || calendarDate(metadata.retrievedAt)) &&
      (type==='country' ? metadata.generatedAtFrom==='world.generatedAt' && calendarDate(world.generatedAt)
        : metadata.generatedAt === null || calendarDate(metadata.generatedAt)),label + ' 元数据无效');
    if (metadata.coverage !== null) requireRange(metadata.coverage,label);
  }
  const metadata = {...registry.mapSources,country:{...registry.mapSources.country,generatedAt:world.generatedAt}};

  const collect = category => [...files].filter(([file])=>file.startsWith('data/'+category+'/')).map(([file,value])=>{
    check(value?.id && file.endsWith('/'+value.id+'.json'),file + ' 文件名与身份不符');
    return value;
  });
  const books = collect('books'), topics = collect('topics');
  const byBook = identities(books,'data/books'), byTopic = identities(topics,'data/topics');
  check(books.length && topics.length,'历史库或专题库为空');
  const warnings = [];
  const texts = new Map(), mapStories = new Map(), eventLinks = new Map();
  const bookChapter = (bookId,chapterId) => {
    const chapters = byBook.get(bookId)?.chapters;
    return chapters?.find(chapter=>chapter.id===chapterId) ??
      chapters?.find(chapter=>chapter.aliases?.includes(chapterId));
  };
  const topicChapter = (topicId,chapterId) => byTopic.get(topicId)?.chapters?.find(c=>c.id===chapterId);
  const narratedRange = item => !item ? undefined : item.from === undefined ? {from:item.year,to:item.year} : item;
  const topicRange = (id,chapterId) => chapterId ? narratedRange(topicChapter(id,chapterId)) : byTopic.get(id);
  const target = (owner,chapterId,lookup,find,label) => {
    check(lookup.has(owner) && (chapterId===undefined || id(chapterId) && find(owner,chapterId)),label + ' 不存在的目标 ' + owner + '/' + (chapterId ?? ''));
  };
  const duplicateText = (text,label) => {
    check(!texts.has(text),label + ' 与 ' + texts.get(text) + ' 正文完全相同');
    texts.set(text,label);
  };
  for (const book of books) {
    const file = 'data/books/' + book.id + '.json';
    check(string(book.title) && string(book.summary) && !Object.hasOwn(book,'polities') && !Object.hasOwn(book,'countries'),
      file + ' 书卷标题、介绍或入口结构无效');
    requireRange(book,file,{unknown:true});
    if (book.from === null) check(string(book.dateLabel),file + ' 未知年代需有说明');
    requireAudit(book.audit,file);
    check(book.editorialNotice===undefined || string(book.editorialNotice),file + ' 资料说明无效');
    check(!book.subjectIds || list(book.subjectIds,key=>subjects.has(key)),file + ' 无法查找所述历史对象');
    const sources = sourceList(book.sources,file);
    if (!sources.size) warnings.push(file + ' 来源待补充');
    check(identities(book.chapters,file + ' 章节').size > 0,file + ' 缺少章节');
    for (const ch of book.chapters) {
      const label = file + '/' + ch.id;
      check(string(ch.title) && string(ch.summary) && chapterKinds.has(ch.kind),label + ' 章节名称或叙事类型无效');
      check(ch.editorialNotice===undefined || string(ch.editorialNotice),label + ' 资料说明无效');
      requireRange(ch,label,{unknown:true});
      if (ch.from === null) check(string(ch.dateLabel),label + ' 未知年代需有说明');
      if (!contained(book,ch) && book.from !== null)
        check(ch.kind !== 'narrative' && string(ch.scope),label + ' 超出书卷范围需标明叙事类型和范围说明');
      if (ch.recommendation !== undefined && ch.recommendation !== false) {
        const rule = ch.recommendation;
        check(object(rule) && Number.isSafeInteger(rule.priority ?? 0),label + ' 推荐优先级无效');
        if (rule.range !== undefined) {
          requireRange(rule.range,label + ' 推荐范围');
          check(contained(ch,rule.range) || string(rule.reason),label + ' 跨章年代的推荐范围需注明依据');
        }
      }
      requireAudit(ch.audit,label);
      const blocks = new Set(), fingerprints = new Set();
      check(Array.isArray(ch.paragraphs) && ch.paragraphs.length,label + ' 缺少正文块');
      for (const p of ch.paragraphs) {
        requireBlock(p,blocks,sources,label);
        duplicateText(p.text,label + '/' + p.id);
        check(p.heading===undefined || string(p.heading),label + ' 小节标题无效');
        if (!p.refs.length) warnings.push(label + '/' + p.id + ' 引用待补充');
        if (p.callout !== undefined) {
          requireBlock(p.callout,blocks,sources,label,false);
          check(string(p.callout.label),label + ' 补充说明缺少标签');
        }
        for (const block of [p,p.callout].filter(block=>block?.previousFingerprint!==undefined)) {
          const fingerprint = block.previousFingerprint;
          check(typeof fingerprint==='string' && /^[0-9a-z]{1,7}$/.test(fingerprint) && !fingerprints.has(fingerprint),
            label + '/' + block.id + ' 旧阅读指纹无效或重复');
          fingerprints.add(fingerprint);
        }
      }
      if (ch.spatialThesis !== undefined) {
        blockIdentity(blocks,ch.spatialThesisId,label);
        check(string(ch.spatialThesis),label + ' 空间线索缺少正文');
      }
      for (const key of ['related','contemporaries']) {
        if (ch[key] === undefined) continue;
        check(Array.isArray(ch[key]),label + ' 关联格式无效');
        for (const link of ch[key]) {
          check(string(link?.label) && (Boolean(link.book) !== Boolean(link.topic)) &&
            (key !== 'contemporaries' || link.book && string(link.note) && (link.year===undefined || isHistoryYear(link.year))),
            label + ' 关联结构无效');
          if (link.book) target(link.book,link.chapter,byBook,bookChapter,label);
          else target(link.topic,link.chapter,byTopic,topicChapter,label);
          const specific = link.book ? bookChapter(link.book,link.chapter) : topicChapter(link.topic,link.chapter);
          relationMeta(link,sources,label + '/' + (link.id || link.label),ch,narratedRange(specific));
        }
      }
      const relationIds = [...(ch.related || []),...(ch.contemporaries || [])].filter(link=>link.id!==undefined);
      identities(relationIds,label + ' 关系');
      if (ch.eventIds !== undefined) check(list(ch.eventIds,string) &&
        new Set(ch.eventIds).size===ch.eventIds.length,label + ' 事件身份无效');
    }
  }
  const topicLink = (link,sources,label,origin) => {
    check(string(link?.label) && string(link.reason),label + ' 延伸阅读缺少解释');
    target(link.topicId,link.chapterId,byTopic,topicChapter,label);
    relationMeta(link,sources,label + '/' + (link.id || link.label),origin,
      link.chapterId ? topicRange(link.topicId,link.chapterId) : undefined);
  };
  for (const topic of topics) {
    const file = 'data/topics/' + topic.id + '.json';
    requireRange(topic,file);
    requireAudit(topic.audit,file);
    check(topic.to !== null && string(topic.title) && string(topic.scope) && string(topic.summary) &&
      list(topic.continents,string) && topic.continents.length && list(topic.countryIsos,isoCode),file + ' 专题结构无效');
    check(identities(topic.chapters,file + ' 章节').size > 0,file + ' 缺少篇章');
    const topicSources = topic.sources===undefined ? new Map() : sourceList(topic.sources,file);
    if (topic.connections !== undefined) {
      check(Array.isArray(topic.connections),file + ' 专题关系应为数组');
      identities(topic.connections.filter(link=>link.id!==undefined),file + ' 关系');
      for (const link of topic.connections) topicLink(link,topicSources,file,undefined);
    }
    for (const ch of topic.chapters) {
      const label = file + '/' + ch.id;
      check(string(ch.title) && string(ch.summary) && historyIncludes(topic,ch.year) &&
        ch.place && string(ch.place.label) && coordinate(ch.place.lon,ch.place.lat),label + ' 篇章或定位无效');
      requireAudit(ch.audit,label);
      const sources = sourceList(ch.sources,label);
      const blocks = new Set();
      check(Array.isArray(ch.sections) && (ch.sections.length || ch.opening),label + ' 缺少正文');
      if (ch.opening) {
        requireBlock(ch.opening,blocks,sources,label);
        check(string(ch.opening.headline),label + ' 开篇标题无效');
      } else blockIdentity(blocks,ch.openingBlockId,label);
      for (const section of ch.sections) {
        requireBlock(section,blocks,sources,label);
        check(string(section.title),label + ' 小节标题无效');
        duplicateText(section.text,label + '/' + section.id);
      }
      if (!sources.size || ch.sections.some(section=>!section.refs.length)) warnings.push(label + ' 引用待补充');
      if (ch.connections !== undefined) {
        check(Array.isArray(ch.connections),label + ' 篇章关系应为数组');
        identities(ch.connections.filter(link=>link.id!==undefined),label + ' 关系');
        for (const link of ch.connections) topicLink(link,sources,label,narratedRange(ch));
      }
      if (ch.mapStory) {
        const {worldEntryId, title, summary, places, participants, refs} = ch.mapStory;
        const event = events.get(worldEntryId);
        check(event && historyIncludes({from:event.start,to:event.point ? event.start : event.end},ch.year) &&
          !mapStories.has(worldEntryId) && string(title) && string(summary),label + ' 专题地图缺事件、年份冲突或重复');
        const points = identities(places,label + ' 附加地点');
        check(points.size && !points.has('main') && [...points.values()].every(p=>string(p.name) &&
          string(p.role) && coordinate(p.lon,p.lat)),label + ' 专题地图地点无效');
        check(list(participants,p=>string(p?.name) && string(p.role) && (p.members===undefined || list(p.members,string))) &&
          participants.length,label + ' 专题地图参与方无效');
        references(refs,sources,label + ' 专题地图');
        mapStories.set(worldEntryId,ch);
      }
    }
  }

  const notes = files.get('data/reading-timeline.json');
  check(object(notes),'data/reading-timeline.json 格式无效');
  const eventRange = event => ({ from:notes[event.id]?.start ?? event.start,
    to:notes[event.id]?.end ?? (event.point ? event.start : event.end) });
  for (const [key,note] of Object.entries(notes)) {
    const label = 'data/reading-timeline.json/' + key;
    const event = events.get(key);
    check(event && object(note) && list(note.paragraphs,p=>object(p)) && note.paragraphs.length,label + ' 事件或正文缺失');
    requireRange(eventRange(event),label);
    requireAudit(note.audit,label);
    const sources = sourceList(note.sources,label), blocks = new Set();
    for (const p of note.paragraphs) requireBlock(p,blocks,sources,label,false);
    if (note.related) {
      target(note.related.topicId,note.related.chapterId,byTopic,topicChapter,label);
      relationMeta(note.related,sources,label,eventRange(event),note.related.chapterId && topicRange(note.related.topicId,note.related.chapterId));
    }
  }
  const linkEvent = (key,bookId,chapterId,label) => {
    target(bookId,chapterId,byBook,bookChapter,label);
    const event = events.get(key), book = byBook.get(bookId);
    const range = event && eventRange(event);
    check(range && !eventLinks.has(key) &&
      (chapterId ? historyOverlaps(range,bookChapter(bookId,chapterId)) : historyOverlaps(range,book) ||
        book.chapters.some(ch=>historyOverlaps(range,ch) || historyOverlaps(range,ch.recommendation?.range ?? ch))),
      label + ' 事件与叙事年代不相交或有多个主入口');
    eventLinks.set(key,chapterId ? [bookId,chapterId] : [bookId]);
  };
  for (const book of books) for (const chapter of book.chapters) for (const event of chapter.eventIds || []) {
    check(!mapStories.has(event) || historyIncludes(chapter,mapStories.get(event).year),
      'data/books/' + book.id + '/' + chapter.id + ' 专题事件年份无效 ' + event);
    linkEvent(event,book.id,chapter.id,'data/books/' + book.id + '/' + chapter.id + ' → ' + event);
  }
  const worldReading = files.get('data/world-reading.json');
  check(object(worldReading),'data/world-reading.json 格式无效');
  for (const [key,path] of Object.entries(worldReading)) {
    const label = 'data/world-reading.json/' + key;
    check(string(path),label + ' 路径无效');
    const [bookId,chapterId,...extra] = path.split('/');
    check(!extra.length,label + ' 路径层级无效');
    linkEvent(key,bookId,chapterId,label);
  }

  const bindings = files.get('data/history/map-bindings.json')?.bindings;
  check(Array.isArray(bindings),'data/history/map-bindings.json 缺少入口集合');
  const mapIndex = new Map();
  for (const row of bindings) {
    const label = 'data/history/map-bindings.json/' + row?.map?.type + '/' + row?.map?.key + ' → ' + row?.target?.bookId;
    check(locateMap(row?.map) && ['primary','related'].includes(row.relation) && string(row.scope) && row.audit, label + ' 入口无效');
    target(row.target?.bookId,row.target?.chapterId,byBook,bookChapter,label);
    check(row.relation==='related' || row.target.chapterId===undefined,label + ' 主入口应打开整卷');
    requireRange(row.range,label);
    check(row.map.type !== 'polity' || historyOverlaps(row.range, polityRanges.get(row.map.key)),
      label + ' 入口年代与底图覆盖年代不相交');
    requireAudit(row.audit,label);
    if (row.subjectId !== undefined) {
      const subject = subjects.get(row.subjectId);
      check(subject && (!subject.maps || subject.maps.some(map=>map.type===row.map.type && map.key===row.map.key)),
        label + ' 历史对象引用无效');
    }
    const key = row.map.type + ':' + row.map.key, previous = mapIndex.get(key) || [];
    check(!previous.some(p=>historyOverlaps(row.range,p.range) &&
      (row.relation==='primary' && p.relation==='primary' || p.target.bookId===row.target.bookId &&
        p.target.chapterId===row.target.chapterId && p.relation===row.relation)),label + ' 主入口冲突或同一关联重复');
    previous.push(row);
    mapIndex.set(key,previous);
  }
  function compareBindings(a,b) {
    const first = a.relation===b.relation ? 0 : a.relation==='primary' ? -1 : 1;
    return first || a.target.bookId.localeCompare(b.target.bookId) || a.range.from-b.range.from ||
      (a.target.chapterId ?? '').localeCompare(b.target.chapterId ?? '');
  }
  const compiledBindings = [...mapIndex].map(([key,rows])=>[key,rows.sort(compareBindings).map(row=>[
    row.target.bookId,row.range.from,row.range.to,row.relation,
    ...(row.relation==='related' || row.audit.status!=='legacy' ? [row.scope,row.target.chapterId ?? null] : []),
  ])]);
  const rawScenes = files.get('data/scenes.json');
  const sceneRecords = identities(rawScenes,'data/scenes.json');
  for (const [sceneId,scene] of sceneRecords) {
    const label = 'data/scenes.json/' + sceneId;
    requireAudit(scene.audit,label);
    if (scene.topicEvent) check(!scene.sources && mapStories.has(scene.topicEvent),label + ' 专题复用入口无效');
    else check(sourceList(scene.sources,label).size,label + ' 场景来源为空');
  }
  const scenes = compileHistoricalScenes(rawScenes,books,topics,polityIds,{checkAudit:requireAudit,sourceList,references});
  const planned = identities(plan,'data/content-plan.json');
  for (const item of plan) {
    check(string(item.title) && Number.isSafeInteger(item.chapters) && item.chapters>=0,'data/content-plan.json/' + item.id + ' 计划格式无效');
    if (byTopic.get(item.id)?.chapters.length !== item.chapters) warnings.push(item.id + ' 实际篇数与编辑计划不同');
  }
  const legacyBindings = bindings.filter(row=>['legacy','unreviewed'].includes(row.audit.status)).length;
  if (legacyBindings) warnings.push(legacyBindings + ' 条地图入口待按书卷与底图范围逐条审校');

  const compiledSubjects = [];
  for (const subject of subjects.values()) {
    if (!subject.maps?.length) continue;
    for (const map of subject.maps) {
      compiledSubjects.push([
        map.type + ':' + map.key,
        {
          id: subject.id,
          type: subject.type,
          name: subject.name,
          from: subject.range?.from ?? null,
          to: subject.range?.to ?? null,
          ...(subject.range?.dateLabel ? { dateLabel: subject.range.dateLabel } : {}),
          ...(subject.scope ? { scope: subject.scope } : {}),
        },
      ]);
    }
  }

  const eventIdentities = files.get('data/history/event-identities.json');
  const eventGroups = [];
  let pendingEventCandidates = [];
  if (eventIdentities !== undefined) {
    check(eventIdentities?.version === 1 && Array.isArray(eventIdentities.confirmedDuplicates) &&
      Array.isArray(eventIdentities.pendingCandidates), 'data/history/event-identities.json 格式无效');
    const groupedMembers = new Set();
    const seenGroupIds = new Set();
    for (const group of eventIdentities.confirmedDuplicates) {
      const label = 'data/history/event-identities.json/' + group?.id;
      check(id(group?.id) && !seenGroupIds.has(group.id), label + ' 重复事件组 ID 无效或重复');
      seenGroupIds.add(group.id);
      check(Array.isArray(group.memberIds) && group.memberIds.length >= 2 &&
        group.memberIds.every(eid => events.has(eid)) && group.memberIds.includes(group.canonicalEntryId) &&
        string(group.note), label + ' 重复事件组成员或说明无效');
      check(new Set(group.memberIds).size === group.memberIds.length, label + ' 存在重复成员 ID');
      if (group.displayTitle !== undefined) check(string(group.displayTitle), label + ' 显示标题无效');
      let noteCount = 0, storyCount = 0;
      for (const eid of group.memberIds) {
        check(!groupedMembers.has(eid), label + ' 成员 ' + eid + ' 属于多个重复组');
        groupedMembers.add(eid);
        if (notes[eid]) noteCount++;
        if (mapStories.has(eid)) storyCount++;
      }
      check(noteCount <= 1 && storyCount <= 1, label + ' 同一重复组不可丢弃多份长注或专题地图');
      eventGroups.push([
        group.id,
        group.canonicalEntryId,
        group.memberIds,
        ...(group.displayTitle ? [group.displayTitle] : []),
      ]);
    }
    const pendingSet = new Set();
    for (const cand of eventIdentities.pendingCandidates) {
      const label = 'data/history/event-identities.json/' + cand?.id;
      check(id(cand?.id) && !seenGroupIds.has(cand.id) && Array.isArray(cand.memberIds) &&
        cand.memberIds.length >= 2 && cand.memberIds.every(eid => events.has(eid)) && string(cand.reason),
        label + ' 待核候选无效');
      seenGroupIds.add(cand.id);
      for (const eid of cand.memberIds) {
        check(!groupedMembers.has(eid), label + ' 待核成员 ' + eid + ' 与已确认重复组冲突');
        pendingSet.add(eid);
      }
    }
    pendingEventCandidates = eventIdentities.pendingCandidates;
    const seenExactSource = new Map();
    for (const ev of events.values()) {
      if (groupedMembers.has(ev.id) || pendingSet.has(ev.id)) continue;
      if (!ev.source) continue;
      const key = `${ev.start}|${ev.point ? ev.start : ev.end}|${ev.kind}|${ev.source}`;
      const previous = seenExactSource.get(key);
      check(!previous || previous.zh !== ev.zh,
        '存在未纳入事件身份治理的同源同日同名事件：' + ev.id + ' 与 ' + previous?.id);
      seenExactSource.set(key, ev);
    }
  }

  return { world, plan:planned, books, topics, scenes, notes, eventLinks, mapBindings:compiledBindings, bindings,
    polityNames:names, subjects, compiledSubjects, eventGroups, pendingEventCandidates, metadata, version:registry.version, warnings };
}
