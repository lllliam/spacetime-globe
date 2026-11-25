import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import rules from '../src/history-rules.js';
import {loadHistoryModel} from './history-model.mjs';
import {readHistorySources} from './migrate-history-model.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const files = readHistorySources(root);
const model = loadHistoryModel(root,files);
const scenesFile = 'data/scenes.json';
const scene = key => model.scenes.find(item=>item.id===key);
function edit(path,update) {
  const variants = new Map(files);
  const data = structuredClone(variants.get(path));
  update(data);
  variants.set(path,data);
  return variants;
}
const fresh = update => edit(scenesFile,data=>update(data.find(item=>item.id==='yongle-capitals').observation));
const fail = (update,error) => assert.throws(()=>loadHistoryModel(root,fresh(update)),error);

const canal = scene('yongle-capitals');
const first = rules.observationFrame(canal,canal.steps[0]);
assert.deepEqual(first.routes,[]);
assert.deepEqual(first.places.map(place=>place.id),['qingjiangpu','beijing']);
assert.deepEqual(first.focusPolities,['Ming Dynasty']);
assert.deepEqual(rules.observationFrame(canal,{places:[],routes:[],focusPolities:[]}),
  {year:1411,places:[],routes:[],focusPolities:[]});
assert.deepEqual(rules.observationFrame(canal,{places:['qingjiangpu','beijing']}).routes.map(route=>route.id),['north-canal']);
assert.equal(rules.observationFrame(canal,canal.steps[2]).routes.length,2);
assert.equal(scene('achaemenid-darius').steps.length,0);
assert.equal(scene('alexander-eastward').status,'paused');
assert.equal(scene('nanjing-treaty-ports').places.length,6);
assert.equal(scene('boxer-crisis-1900').places.length,2);
assert(model.books.flatMap(book=>book.chapters.flatMap(ch=>ch.sceneRefs || [])).filter(ref=>ref.id==='boxer-crisis-1900').length);
assert.equal(model.scenes.length,48);

fail(obs=>{obs.steps[0].id=obs.steps[1].id;},/阶段 ID/);
fail(obs=>{obs.steps[0].year=0;},/阶段年份/);
fail(obs=>{obs.steps[0].year=2025;},/阶段年份/);
fail(obs=>{obs.steps[0].places=['missing'];},/阶段地点/);
fail(obs=>{obs.steps[0].focusPolities=['Ming (misspelled)'];},/关联政权无效/);
fail(obs=>{obs.steps[0].routes=['missing'];},/阶段路线/);
fail(obs=>{obs.steps[0].routes=['south-canal'];},/阶段路线端点/);
fail(obs=>{obs.routes[0].via=[[148,40]];},/示意联系不能有/);
fail(obs=>{obs.routes[0].directed=true;},/方向缺证据/);
fail(obs=>{obs.routes[0].precision='attested';},/实际路线缺少/);
fail(obs=>{obs.routes[0].evidence=['source-missing'];},/来源引用无效/);
fail(obs=>{obs.placeNotes.qingjiangpu.precision='unchecked';},/地点 qingjiangpu/);
fail(obs=>{obs.placeNotes.qingjiangpu.lon=185;},/地点 qingjiangpu/);
fail(obs=>{obs.year=0;},/类型、问题或限制缺失/);
fail(obs=>{delete obs.limit;},/类型、问题或限制缺失/);
assert.throws(()=>loadHistoryModel(root,edit('data/books/ming.json',book=>{
  const chapter = book.chapters.find(ch=>ch.id==='two-capitals');
  chapter.sceneRefs.find(ref=>ref.id==='yongle-capitals').placeLinks[0].stageId='missing-step';
})),/地名链接/);
fail(obs=>{obs.status='paused';},/地名链接/);

const approximate = loadHistoryModel(root,fresh(obs=>{
  const route = obs.routes[0];
  route.precision='approximate';
  route.directed=true;
  route.directionEvidence=route.evidence;
})).scenes.find(item=>item.id==='yongle-capitals');
assert.equal(approximate.routes[0].precision,'approximate');
assert(approximate.routes[0].directionEvidence.length);
const former = {...canal,routes:[{...canal.routes[0],precision:'legacy'},{...canal.routes[1],precision:'approximate'}]};
assert.deepEqual(rules.observationFrame(former,canal.steps[2]).routes.map(route=>route.id),['north-canal']);

const editRelation = (path,chapterId,relation,modify) => edit(path,book=>{
  const chapter = book.chapters.find(ch=>ch.id===chapterId);
  modify(chapter.contemporaries.find(item=>item.relation===relation));
});
const book = key => model.books.find(item=>item.id===key);
assert.equal(book('ming').chapters[1].contemporaries[0].relation,'contemporary');
assert(book('song').chapters.some(ch=>ch.contemporaries?.some(link=>link.relation==='compare' && link.dimension)));
assert(model.topics.some(topic=>topic.connections?.some(link=>link.relation==='context')));
const checked = book('spain-portugal').chapters.find(ch=>ch.id==='conquistadors-silver-galleon').contemporaries[0];
assert.equal(checked.relation,'documented');
assert.equal(checked.chapter,'silver');
assert(checked.evidence.some(ref=>ref.sourceId==='met-manila-commerce' && ref.locator.includes('贸易')));
assert.throws(()=>loadHistoryModel(root,editRelation('data/books/ming.json','two-capitals','contemporary',link=>{
  link.time={from:1490,to:1495};
})),/同期时间/);
assert.throws(()=>loadHistoryModel(root,editRelation('data/books/ming.json','two-capitals','contemporary',link=>{
  delete link.chapter;
})),/同期时间/);
assert.throws(()=>loadHistoryModel(root,editRelation('data/books/ming.json','silver','compare',link=>{
  delete link.dimension;
})),/历史比较缺少维度/);
for (const value of [undefined,['met-manila-commerce']]) {
  assert.throws(()=>loadHistoryModel(root,editRelation('data/books/spain-portugal.json','conquistadors-silver-galleon','documented',link=>{
    link.evidence=value;
  })),/实际历史联系需有联系本身/);
}
assert.throws(()=>loadHistoryModel(root,editRelation('data/books/spain-portugal.json','conquistadors-silver-galleon','documented',link=>{
  link.chapter='invalid-chapter';
})),/不存在的目标/);
console.log('Observation model: 48 scenes, known/absent/empty stages, source and precision rules, paused entrances and all world-relation types passed.');
