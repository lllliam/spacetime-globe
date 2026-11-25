/* One-time identity migration. Dry-run by default; --write applies validated changes. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = dirname(dirname(here));
const subjectsFile = 'data/history/subjects.json';
const bindingsFile = 'data/history/map-bindings.json';
const ordinalId = (prefix, index) => prefix + '-' + String(index + 1).padStart(2, '0');
const { stringify } = JSON;
const json = value => stringify(value, null, 2) + '\n';
const semantic = value => Array.isArray(value) ? value.map(semantic)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, semantic(value[key])])) : value;
const digest = value => createHash('sha256').update(stringify(semantic(value))).digest('hex');
const read = (base, path) => {
  try { return JSON.parse(readFileSync(join(base,path),'utf8')); }
  catch (error) { throw new Error(path + ' 无法解析：' + error.message); }
};
const sources = list => list.map((item, index) => ({...item, id:item.id ?? ordinalId('source', index)}));
const without = (item, ...keys) => Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key)));
const draftAudit = { status:'legacy' };

export function readHistorySources(base) {
  const files = new Map();
  for (const category of ['books','topics']) {
    for (const name of readdirSync(join(base, 'data', category)).filter(file => file.endsWith('.json')).sort()) {
      const path = 'data/' + category + '/' + name;
      files.set(path, read(base, path));
    }
  }
  for (const name of ['scenes','reading-timeline','world-reading']) {
    const path = 'data/' + name + '.json';
    files.set(path, read(base, path));
  }
  for (const path of [subjectsFile, bindingsFile]) {
    if (existsSync(join(base, path))) files.set(path, read(base, path));
  }
  return files;
}

const southAsia = 'south-asian-subcontinent';
const historicalSubjects = {
  ming:['ming-dynasty'],
  'india-classical-modern':[southAsia],
  'mesoamerica-maya':['maya-societies'],
};

const changedCountries = {
  'india-classical-modern:IN': { relation:'primary', scope:'本卷聚焦南亚次大陆部分古代历史、殖民与分治，以及现代印度共和国。', chapter:'independence-partition-republic' },
  'india-classical-modern:PK': { relation:'related', scope:'本卷涉及英属印度分治与克什米尔背景。', chapter:'independence-partition-republic' },
  'india-classical-modern:BD': { relation:null, scope:'书卷涉及南亚区域史，现有正文未充分覆盖孟加拉国自身历史。' },
  'india-classical-modern:LK': { relation:'related', scope:'本卷涉及阿育王时期佛教向斯里兰卡传播。', chapter:'maurya-ashoka-kushan' },
  'british-empire:IE': { relation:'related', scope:'本卷涉及英国和爱尔兰自由邦独立的背景。', chapter:'world-wars-post-imperial' },
  'canada-north-america:GL': { relation:'related', scope:'本卷涉及格陵兰与加拿大北极的因纽特文化及地缘背景。', chapter:'modern-canada-arctic' },
};

function migrateRefs(refs, list) {
  return refs?.map(ref => {
    if (!Number.isInteger(ref)) return ref;
    assert(list[ref]?.id, '旧来源索引无目标 ' + ref);
    return list[ref].id;
  });
}
function migrateBlock(block, id, list) {
  return {...block, id:block.id ?? id, ...(block.refs && {refs:migrateRefs(block.refs,list)})};
}

function createBindings(books) {
  const rows = [];
  const changes = [];
  for (const book of books) {
    const target = { bookId:book.id };
    for (const name of book.polities || []) rows.push({
      map:{type:'polity', key:name}, target, range:{from:book.from,to:book.to}, relation:'primary',
      scope:'书卷涵盖此底图主体的历史或相关时期，入口按原书卷叙事范围沿用。', audit:draftAudit,
      ...(book.id === 'ming' && name === 'Ming Dynasty' && {subjectId:'ming-dynasty'}),
    });
    for (const binding of book.countries || []) {
      const {iso, from} = binding;
      const old = { map:{type:'country', key:iso}, target, range:{from,to:binding.to ?? null}, relation:'primary',
        scope:'原现代地图入口，书卷范围以其叙事内容为准。', audit:draftAudit };
      const edit = changedCountries[book.id + ':' + iso];
      if (!edit) { rows.push(old); continue; }
      if (edit.relation) rows.push({...old, relation:edit.relation, scope:edit.scope,
        target:{...target, ...(edit.relation==='related' && edit.chapter && {chapterId:edit.chapter})}, audit:{status:'unreviewed'}});
      changes.push({bookId:book.id, iso, before:'primary', after:edit.relation ?? 'map-only',
        range:old.range, ...(edit.chapter && {chapterId:edit.chapter}), scope:edit.scope});
    }
  }
  return { rows, changes };
}

export function migrateHistory(input) {
  const result = new Map(input);
  const books = [...input].filter(([file]) => file.startsWith('data/books/')).map(([,book]) => book);
  const legacy = books.some(book => Array.isArray(book.polities) || Array.isArray(book.countries));
  const {rows,changes} = legacy ? createBindings(books) : {rows:input.get(bindingsFile)?.bindings,changes:[]};
  if (legacy) assert(!input.has(bindingsFile) && !input.has(subjectsFile), '已存在新入口文件，请勿混用两个权威来源');
  if (legacy) {
    result.set(bindingsFile, {bindings:rows});
    result.set(subjectsFile, {version:1, subjects:[
      {id:'ming-dynasty', type:'polity', name:'明朝', range:{from:1368,to:1644},
        maps:[{type:'polity',key:'Ming Dynasty'}], audit:draftAudit},
      {id:southAsia, type:'region', name:'南亚次大陆',
        scope:'此地理区域用于说明书卷的部分叙事范围。', audit:{status:'unreviewed'}},
      {id:'maya-societies', type:'civilization', name:'玛雅文明与社会',
        scope:'中部美洲的玛雅社会与文化，涵盖多个城邦和时期。', audit:{status:'unreviewed'}},
    ], mapSources:{
      polity:{name:'Cliopatria', source:'https://github.com/Seshat-Global-History-Databank/cliopatria',
        version:null, retrievedAt:null, generatedAt:null, coverage:{from:-3400,to:2024}, license:'CC BY 4.0',
        asset:'data/polity.bin.gz', limitations:'使用底图原名定位。没有完整的地区覆盖，资产未记录精确的上游提交或本地生成日期。'},
      country:{name:'Natural Earth', source:'https://www.naturalearthdata.com/about/terms-of-use/',
        version:null, retrievedAt:null, generatedAtFrom:'world.generatedAt', coverage:null, license:'Public Domain',
        asset:'data/world.json', limitations:'现代参考边界。时间戳为本地世界数据包生成时间，底图快照年未记录。'},
    }});
  }
  for (const [file,value] of input) {
    if (file.startsWith('data/books/')) {
      const list = sources(value.sources);
      const chapters = value.chapters.map(ch => {
        const paragraphs = ch.paragraphs.map((p,index) => ({
          ...migrateBlock(p,ordinalId('p',index),list),
          ...(p.callout && {callout:{...p.callout,id:p.callout.id ?? ordinalId('aside',index)}}),
        }));
        const sceneRefs = ch.sceneRefs?.map(ref => {
          if (ref.after === undefined) return ref;
          assert(!ref.afterBlockId && paragraphs[ref.after - 1]?.id, value.id + '/' + ch.id + ' 旧场景位置无效 ' + ref.id);
          return {...without(ref,'after'), afterBlockId:paragraphs[ref.after - 1].id};
        });
        return {...ch, kind:ch.kind ?? 'narrative', paragraphs, ...(sceneRefs && {sceneRefs}),
          ...(ch.spatialThesis && {spatialThesisId:ch.spatialThesisId ?? 'spatial-thesis'})};
      });
      const subjectIds = value.subjectIds ?? historicalSubjects[value.id];
      result.set(file, {...without(value,'polities','countries'), sources:list, chapters, ...(subjectIds && {subjectIds})});
    } else if (file.startsWith('data/topics/')) {
      result.set(file, {...value, chapters:value.chapters.map(ch => {
        const list = sources(ch.sources);
        return {...ch, sources:list,
          ...(ch.opening ? {opening:migrateBlock(ch.opening,'opening',list)} : {openingBlockId:ch.openingBlockId ?? 'opening-summary'}),
          sections:ch.sections.map((p,index) => migrateBlock(p,ordinalId('section',index),list)),
          ...(ch.mapStory && {mapStory:{...ch.mapStory,refs:migrateRefs(ch.mapStory.refs,list)}}),
        };
      })});
    } else if (file === 'data/scenes.json') {
      result.set(file, value.map(scene => scene.sources ? {...scene,sources:sources(scene.sources)} : scene));
    } else if (file === 'data/reading-timeline.json') {
      result.set(file, Object.fromEntries(Object.entries(value).map(([id,note]) => [id,{
        ...note, sources:sources(note.sources), paragraphs:note.paragraphs.map((p,index) =>
          typeof p === 'string' ? {id:ordinalId('p',index),text:p} : p),
      }])));
    }
  }
  return {result,changes};
}

/* Compare resolved original sources and scene positions as well as every retained field. */
export function legacyContent(files) {
  const legacyRefs = (refs, list) => refs?.map(ref => {
    const index = Number.isInteger(ref) ? ref : list.findIndex(source => source.id === (typeof ref === 'string' ? ref : ref.sourceId));
    assert(index >= 0 && list[index], '正文引用未能恢复到原来源');
    return index;
  });
  const block = (value, list) => ({...without(value,'id'), ...(value.refs && {refs:legacyRefs(value.refs,list)})});
  const stripSources = list => list.map(source => without(source,'id'));
  const output = {};
  for (const [path, data] of files) {
    if (path.startsWith('data/books/')) {
      output[path] = {...without(data,'polities','countries','subjectIds'), sources:stripSources(data.sources),
        chapters:data.chapters.map(ch => ({
          ...without(ch,'kind','spatialThesisId'),
          paragraphs:ch.paragraphs.map(p => ({...block(p,data.sources), ...(p.callout && {callout:without(p.callout,'id')})})),
          ...(ch.sceneRefs && {sceneRefs:ch.sceneRefs.map(ref => {
            const after = ref.after ?? 1 + ch.paragraphs.findIndex(p => p.id === ref.afterBlockId);
            assert(after > 0, ch.id + ' 场景引用无对应原段落 ' + ref.id);
            return {...without(ref,'afterBlockId'),after};
          })}),
        })),
      };
    } else if (path.startsWith('data/topics/')) {
      output[path] = {...data, chapters:data.chapters.map(ch => ({
        ...without(ch,'openingBlockId'), sources:stripSources(ch.sources),
        sections:ch.sections.map(p => block(p,ch.sources)),
        ...(ch.opening && {opening:block(ch.opening,ch.sources)}),
        ...(ch.mapStory && {mapStory:{...ch.mapStory,refs:legacyRefs(ch.mapStory.refs,ch.sources)}}),
      }))};
    } else if (path === 'data/scenes.json') {
      output[path] = data.map(scene => scene.sources ? {...scene,sources:stripSources(scene.sources)} : scene);
    } else if (path === 'data/reading-timeline.json') {
      output[path] = Object.fromEntries(Object.entries(data).map(([id,note]) =>
        [id,{...note,sources:stripSources(note.sources),paragraphs:note.paragraphs.map(p => typeof p === 'string' ? p : p.text)}]));
    } else if (path === 'data/world-reading.json') output[path] = data;
  }
  return output;
}

export function migrationEvidence(before, after) {
  const original = legacyContent(before);
  const current = legacyContent(after);
  assert.deepEqual(semantic(current),semantic(original),'迁移改变了正文、来源或已有关联');
  const expected = migrateHistory(before);
  assert.deepEqual(after.get(bindingsFile),expected.result.get(bindingsFile),'实际入口与迁移清单不一致');
  const inventory = Object.entries(current).map(([file,item]) => ({
    file, sha256:digest(item), ...(item.chapters && {chapters:item.chapters.map(ch => ({
      id:ch.id, blocks:(ch.paragraphs ?? ch.sections).length + Number(Boolean(ch.opening)),
      sources:(ch.sources ?? item.sources).length, sceneRefs:ch.sceneRefs?.length ?? 0, sha256:digest(ch),
    }))}),
  }));
  const bindings = after.get(bindingsFile).bindings;
  return { legacyContentSha256:digest(original), migratedContentSha256:digest(current), inventory,
    bindings:{ total:bindings.length, primary:bindings.filter(b=>b.relation==='primary').length,
      related:bindings.filter(b=>b.relation==='related').length, intentionalChanges:expected.changes } };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(name);
    if (index < 0) return null;
    assert(args[index + 1] && !args[index + 1].startsWith('--'), name + ' 需要一个路径');
    return resolve(args[index + 1]);
  };
  const target = option('--root') ?? root;
  const baseline = option('--baseline');
  const report = option('--report');
  const before = readHistorySources(target);
  const {result} = migrateHistory(before);
  const evidence = migrationEvidence(baseline ? readHistorySources(baseline) : before,result);
  const changes = [...result].filter(([path,data]) => !before.has(path) || digest(before.get(path)) !== digest(data));
  assert.deepEqual(migrateHistory(result).result,result,'迁移结果不可重复');
  const {loadHistoryModel} = await import('./history-model.mjs');
  loadHistoryModel(target,result);
  if (args.includes('--write')) {
    for (const [path,value] of changes) {
      const destination = join(target,path);
      mkdirSync(dirname(destination),{recursive:true});
      writeFileSync(destination,json(value));
    }
  } else if (args.includes('--check')) assert.equal(changes.length,0,'仍有文件需要迁移');
  if (report) writeFileSync(report,json(evidence));
  console.log(stringify({ action:args.includes('--write') ? 'write' : 'check', files:changes.length,
    compared:evidence.inventory.length, sha256:evidence.legacyContentSha256, bindings:evidence.bindings },null,2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error=>{ console.error(error.message); process.exitCode=1; });
}
