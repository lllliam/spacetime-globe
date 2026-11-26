import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadHistoryModel} from './history-model.mjs';
import {readHistorySources} from './migrate-history-model.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => typeof value==='string' && value.trim().length>0;

const risks = [
  [1,'严重伤害与争议估算',/饥荒|屠杀|灭绝|奴役|镇压|死亡|死者|饿死|迫害|强制迁徙|人相食/u],
  [1,'高影响数字或首创断言',/(?:[0-9][0-9,.]*|数|几|千|百|万|亿)[万亿％%]|人类史上第|有史以来第|史上最|全球第一|世界第一/u],
  [1,'身份及政权承继',/正统继承|完全继承|自古以来|自古就是|天然领土|历史归属/u],
  [2,'引语或证据范围待判',/[“「][^”」]{5,55}[”」]|明确写道|临终|喊道/u],
  [2,'单因果或戏剧化',/彻底|必然|绝对|决定性地|直接点燃|一锤定音|一举奠定|核聚变|降维打击|望眼欲穿|生死存亡/u],
  [3,'时效或修辞',/如今|今天依然|至今仍|世界级|超级|神话|奇迹|黯然|轰然/u],
];

function polityRanges(path) {
  const asset = readFileSync(join(path,'data/polity.bin'));
  assert.equal(asset.toString('ascii',0,4),'SGP1');
  const count = asset.readUInt32LE(4);
  let offset = asset.readUInt32LE(16);
  const entries = new Map();
  for (let i=0;i<count;i++) {
    const length = asset.readUInt16LE(offset);
    const end = offset+2+length;
    entries.set(asset.toString('utf8',offset+2,end),{from:asset.readInt16LE(end),to:asset.readInt16LE(end+2)});
    offset = end+4;
  }
  return entries;
}

export function inventory(path, loadModel = loadHistoryModel, extended = false) {
  const files = readHistorySources(path);
  const model = loadModel(path,files);
  const polity = polityRanges(path);
  const rows = new Map(), urls = new Map();
  const seen = (kind,id,data,material = '') => {
    const key = kind+'/'+id;
    assert(!rows.has(key),'重复审校身份 '+key);
    const flags = risks.filter(([, ,pattern])=>pattern.test(material)).map(([level,reason])=>({level,reason}));
    rows.set(key,{id:key,kind,digest:sha(data),...(flags.length && {flags}),data});
  };
  const fields = (data,keys) => Object.fromEntries(keys.filter(key=>data[key]!==undefined).map(key=>[key,data[key]]));
  const part = (owner,item,keys) => {
    for (const key of keys.filter(key=>text(item[key]))) seen('text',owner+'/'+key,item[key],item[key]);
  };
  const sourceRows = (owner,sources=[]) => {
    for (const source of sources) {
      const id = 'source/'+owner+'/'+source.id;
      seen('source',owner+'/'+source.id,source);
      if (!urls.has(source.url)) urls.set(source.url,[]);
      urls.get(source.url).push(id);
    }
  };
  const relation = (owner,link) => seen('relation',owner+'/'+link.id,link,[link.label,link.reason,link.note,link.display].filter(Boolean).join(' '));
  const block = (owner,item,kind='block') => {
    seen(kind,owner+'/'+item.id,fields(item,['heading','label','title','headline','text','refs','previousFingerprint']),
      [item.heading,item.label,item.title,item.headline,item.text].filter(Boolean).join(' '));
  };
  const bookIds = new Map(model.books.map(book=>[book.id,book]));
  for (const book of model.books) {
    const owner = 'book/'+book.id;
    seen('book',book.id,fields(book,['from','to','subjectIds']));
    part(owner,book,['title','summary','dateLabel','editorialNotice']);
    sourceRows(owner,book.sources);
    for (const chapter of book.chapters) {
      const id = book.id+'/'+chapter.id;
      seen('book-chapter',id,fields(chapter,['from','to','kind','recommendation']));
      part('chapter/'+id,chapter,['title','summary','dateLabel','spatialThesis','scope','editorialNotice']);
      for (const p of chapter.paragraphs) {
        block(id,p,'book-paragraph');
        if (p.callout) block(id,p.callout);
      }
      for (const ref of chapter.sceneRefs || []) {
        seen('scene-ref',id+'/'+ref.id,ref);
        for (const link of ref.placeLinks || []) seen('place-link',id+'/'+ref.id+'/'+link.blockId+'/'+link.placeId,link);
      }
      for (const link of [...chapter.related || [],...chapter.contemporaries || []]) relation(owner+'/'+chapter.id,link);
    }
  }
  for (const topic of model.topics) {
    const owner = 'topic/'+topic.id;
    seen('topic',topic.id,fields(topic,['from','to','continents','countryIsos']));
    part(owner,topic,['title','summary','subtitle','scope']);
    sourceRows(owner,topic.sources);
    (topic.connections || []).forEach(link=>relation(owner,link));
    for (const chapter of topic.chapters) {
      const id = owner+'/'+chapter.id;
      seen('article',topic.id+'/'+chapter.id,fields(chapter,['year','place']));
      part(id,chapter,['title','summary']);
      if (chapter.opening) block(id,chapter.opening);
      for (const item of chapter.sections) block(id,item);
      if (chapter.mapStory) seen('event-map',id,chapter.mapStory,JSON.stringify(chapter.mapStory));
      sourceRows(id,chapter.sources);
      (chapter.connections || []).forEach(link=>relation(id,link));
    }
  }
  for (const scene of model.scenes) {
    const {sources, ...publicData} = scene;
    const raw = files.get('data/scenes.json').find(item=>item.id===scene.id);
    const draft = fields(raw,['year','title','summary','places','routes','steps','focusPolities']);
    seen('scene',scene.id,{publicData,draft},JSON.stringify(publicData));
    sourceRows('scene/'+scene.id,sources);
  }
  const eventById = new Map(model.world.entries.map(event=>[event.id,event]));
  for (const [id,note] of Object.entries(model.notes)) {
    const owner = 'timeline/'+id;
    part(owner,note,['title','summary','date']);
    sourceRows(owner,note.sources);
    note.paragraphs.forEach(p=>block(owner,p));
    if (note.related) relation(owner,note.related);
  }
  for (const [key,target] of model.eventLinks) {
    const event = eventById.get(key);
    seen('event',key,{target,...fields(event,['zh','start','end','point','region','px','py','sm','sd','em','ed']),
      editorial:fields(model.notes[key] || {},['title','start','end','date','context'])});
  }
  for (const binding of model.bindings) {
    const {map,target,range,relation,scope} = binding;
    const book = bookIds.get(target.bookId);
    const chapter = target.chapterId && book.chapters.find(candidate=>candidate.id===target.chapterId);
    const assetRange = map.type==='polity' ? polity.get(map.key) : null;
    const id = [map.type,map.key,target.bookId,range.from].join('/');
    seen('map',id,{map,target,range,relation,scope,audit:binding.audit,assetRange,bookRange:fields(book,['from','to']),
      ...(chapter && {chapterRange:fields(chapter,['from','to'])})},scope);
  }
  for (const [id,record] of Object.entries(model.metadata)) seen('map-source',id,record);
  if (extended) {
    for (const subject of files.get('data/history/subjects.json').subjects) {
      seen('subject',subject.id,subject,[subject.name,subject.summary,subject.scope].filter(Boolean).join(' '));
      sourceRows('subject/'+subject.id,subject.sources);
    }
    for (const [groupId, canonical, members, title] of model.eventGroups ?? []) {
      seen('event-group',groupId,{canonical,members,title});
    }
    for (const event of model.world.entries) seen('world-entry',event.id,event,event.zh);
  }
  return {rows,urls};
}
