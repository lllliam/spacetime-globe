import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadHistoryModel} from './history-model.mjs';
import {readHistorySources} from './migrate-history-model.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const ledger = join(root,'docs/progress/phase-07');
const baselineRef = '5bae983a9510987b63f4bb4b2af07ab8d9e5ecdd';
const read = path => JSON.parse(readFileSync(path,'utf8'));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => typeof value==='string' && value.trim().length>0;
const date = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const status = new Set(['legacy','unreviewed','issues','checked','insufficient','disputed']);
const accessStatus = new Set(['read','irrelevant','abstract','restricted','temporary-failure','rate-limited','dead','replacement']);
const claimsStatus = new Set(['supported','limited','insufficient','disputed','incorrect']);
const actions = new Set(['retain','revise','qualify','pause','pending']);
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

function inventory(path) {
  const files = readHistorySources(path);
  const model = loadHistoryModel(path,files);
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
    seen(kind,owner+'/'+item.id,fields(item,['heading','label','title','headline','text','refs']),
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
  return {rows,urls};
}

const baselineArg = process.argv[2];
const update = process.argv.includes('--write');
assert(baselineArg && !baselineArg.startsWith('--'),'传入 Phase 06 归档目录，然后可选 --write');
const old = inventory(baselineArg);
const current = inventory(root);
const write = (name,data) => {
  const file = join(ledger,name);
  const serialized = JSON.stringify(data,null,2)+'\n';
  if (update) {
    mkdirSync(ledger,{recursive:true});
    writeFileSync(file,serialized);
  } else {
    assert(readFileSync(file,'utf8').replaceAll('\r\n','\n')===serialized,'审校产物与记录不符 '+name);
  }
};
const byKind = rows => Object.fromEntries([...new Set(rows.map(row=>row.kind))].sort()
  .map(kind=>[kind,rows.filter(row=>row.kind===kind).length]));
const batches = readdirSync(join(ledger,'batches')).filter(file=>file.endsWith('.json')).sort().map(file=>read(join(ledger,'batches',file)));
const access = new Map(), reviews = new Map(), evidenceTally = {};
for (const batch of batches) for (const item of batch.access || []) {
  assert(!access.has(item.url) && /^https:\/\//.test(item.url) && accessStatus.has(item.status) &&
    date(item.date) && text(item.material) && text(item.locator),'访问记录无效 '+item.url);
  access.set(item.url,item);
}
for (const batch of batches) for (const review of batch.reviews) {
  const row = current.rows.get(review.id);
  assert(row && !reviews.has(review.id) && status.has(review.status) && actions.has(review.action) && text(review.scope),
    '审校记录无效 '+review.id);
  if (['issues','insufficient','disputed'].includes(review.status)) assert(text(review.limit),'缺少问题或限制 '+review.id);
  if (review.level===1 && review.confirmed) assert(['revise','qualify','pause'].includes(review.action),'严重问题尚未处置 '+review.id);
  if (review.action==='pause' && row.kind==='scene') assert.equal(row.data.publicData.status,'paused',review.id);
  if (review.action==='pause' && row.kind==='map') assert.fail('地图暂停必须映射到可验证的实际处置 '+review.id);
  if (review.status==='checked') assert(review.claims?.length && review.claims.some(claim=>claim.result==='supported') && date(review.date),
    '已核对需有真实证据及日期 '+review.id);
  if (review.secondPass) assert(review.status==='checked' && date(review.secondPass.date) &&
    review.secondPass.date>=review.date && text(review.secondPass.scope),'第二遍查证缺日期或内容 '+review.id);
  for (const claim of review.claims || []) {
    assert(text(claim.statement) && claimsStatus.has(claim.result) && text(claim.limit),'论断记录无效 '+review.id);
    if (claim.result==='supported') assert(claim.evidence?.length,'已支持的论断缺证据 '+review.id);
    for (const e of claim.evidence || []) {
      const source = current.rows.get(e.source)?.data;
      const record = source && access.get(source.url);
      assert(source && record && ['read','abstract','replacement'].includes(record.status) && text(e.locator) && text(e.supports),
        '来源身份、读查记录或定位无效 '+review.id+' '+e.source);
      if (record.status==='abstract') assert(e.locator.includes('摘要'),'摘要之外的证据未实际读取 '+review.id);
    }
    evidenceTally[claim.result]=(evidenceTally[claim.result] || 0) + 1;
  }
  reviews.set(review.id,review);
}
const changes = [];
const addChange = (id,before,after) => {
  const review = reviews.get(id);
  assert(review && ['revise','qualify','pause'].includes(review.action),'变更缺少处置记录 '+id);
  changes.push({id,before:before?.data ?? null,after:after.data,action:review.action});
};
for (const [id,before] of old.rows) {
  const after = current.rows.get(id);
  assert(after,'丢失存量审校对象 '+id);
  if (after.digest===before.digest) continue;
  addChange(id,before,after);
}
const addedSources = [];
for (const [id,after] of current.rows) {
  if (old.rows.has(id)) continue;
  if (after.kind==='source') {
    assert(['read','replacement','abstract'].includes(access.get(after.data.url)?.status),'新增来源未经查读 '+id);
    addedSources.push(id);
  } else {
    addChange(id,null,after);
  }
}
const compact = ({data,...row}) => row;
const rows = [...old.rows.values()];
const pending = rows.filter(row=>!reviews.has(row.id) || reviews.get(row.id).action==='pending');
const reviewed = rows.filter(row=>reviews.has(row.id) && reviews.get(row.id).action!=='pending');
const checked = reviewed.filter(row=>reviews.get(row.id).status==='checked');
const disposed = reviewed.filter(row=>{
  const review = reviews.get(row.id);
  return review.status==='checked' || review.status==='issues' &&
    row.digest!==current.rows.get(row.id).digest && ['revise','qualify','pause'].includes(review.action);
});
const remaining = rows.filter(row=>!disposed.includes(row));
const mapRows = rows.filter(row=>row.kind==='map').map(row=>({id:row.id,...row.data}));
const sourceRows = [...new Set([...current.urls.keys(),...access.keys()])].map(url=>({
  url,uses:current.urls.get(url) || [],access:access.get(url) ?? {status:'unaccessed'},
}));
const limits = [...reviews].flatMap(([id,review])=>[
  ...(review.limit ? [{id,limit:review.limit}] : []),
  ...(review.claims || []).map(claim=>({id,claim:claim.statement,limit:claim.limit})),
]);
const summary = {baseline:baselineRef,inventory:byKind(rows),riskCandidates:rows.filter(row=>row.flags).length,
  recorded:reviews.size,reviewed:byKind(reviewed),checked:byKind(checked),unreviewed:byKind(pending),
  pendingDisposition:byKind(remaining),coverage:{disposed:disposed.length,total:rows.length},
  claimVerification:{supported:evidenceTally.supported || 0,total:Object.values(evidenceTally).reduce((sum,n)=>sum+n,0)},
  addedSources:addedSources.length,secondPass:[...reviews.values()].filter(row=>row.secondPass).length,
  confirmedSevere:[...reviews.values()].filter(row=>row.level===1 && row.confirmed).length,
  knownUrls:current.urls.size,accessed:access.size,sourceAccess:Object.fromEntries([...accessStatus].map(state=>
    [state,[...access.values()].filter(record=>record.status===state).length])),claims:evidenceTally,changed:changes.length,
  existingChanges:changes.filter(row=>row.before!==null).length,
  sceneAvailability:Object.fromEntries(['available','paused'].map(state=>[state,[...current.rows.values()].filter(row=>
    row.kind==='scene' && row.data.publicData.status===state).length])),
  relationTypes:Object.fromEntries([...new Set([...current.rows.values()].filter(row=>row.kind==='relation').map(row=>row.data.relation))].sort()
    .map(type=>[type,[...current.rows.values()].filter(row=>row.kind==='relation' && row.data.relation===type).length])),
  severityOnePending:pending.filter(row=>row.flags?.some(flag=>flag.level===1)).length};
write('inventory.json',{baseline:baselineRef,rows:rows.map(compact)});
write('map-bindings.json',mapRows);
write('sources.json',sourceRows);
write('unresolved.json',{notSubstantivelyReviewed:pending.map(row=>row.id),
  partlyReviewed:remaining.filter(row=>reviews.has(row.id)).map(row=>row.id),recordedLimits:limits});
write('changes.json',changes);
write('summary.json',summary);
console.log(JSON.stringify(summary,null,2));
