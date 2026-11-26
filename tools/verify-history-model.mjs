/* Content constraints use in-memory fixtures, never the editing files. */
import assert from 'node:assert/strict';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import rules from '../src/history-rules.js';
import {loadHistoryModel} from './history-model.mjs';
import {migrateHistory,migrationEvidence,readHistorySources} from './migrate-history-model.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const files = readHistorySources(root);
const model = loadHistoryModel(root,files);
const {recommendChapters,historyIncludes,referenceId} = rules;
const mingPath = 'data/books/ming.json', bindingsPath = 'data/history/map-bindings.json';
const topicPath = 'data/topics/china-early.json', scenesPath = 'data/scenes.json';
const ming = model.books.find(book=>book.id==='ming');
const ids = chapters => chapters.map(chapter=>chapter.id);
const choose = (book,year) => ids(recommendChapters(book,year));
const fixture = (path,mutate) => {
  const copy = new Map(files);
  const content = structuredClone(files.get(path));
  mutate(content);
  copy.set(path,content);
  return copy;
};
const reject = (path,edit,pattern) => assert.throws(()=>loadHistoryModel(root,fixture(path,edit)),pattern);

const sampleBook = (id,chapters,from,to) => ({
  id,title:'测试书卷',summary:'隔离测试数据',from,to,
  sources:[{id:'one',title:'示例资料',url:'https://example.org/source'}], chapters,
});
const sampleChapter = (id,from,to,extra) => ({
  id,kind:'narrative',title:id,summary:'隔离章节',from,to,...extra,
  paragraphs:[{id:'first',text:'测试正文 ' + id,refs:['one']}],
});
const brief = sampleBook('test-brief',[sampleChapter('bce-ce',-1,1)],-1,1);
const flexible = sampleBook('test-flexible',[
  sampleChapter('second-by-date',15,36),
  sampleChapter('earlier-by-date',8,21),
  sampleChapter('retrospective',1,24,{kind:'retrospective'}),
  sampleChapter('thematic',8,30,{kind:'thematic',recommendation:{priority:5,range:{from:18,to:21}}}),
  ...Array.from({length:30},(_,i)=>sampleChapter('later-'+i,80+i,80+i)),
  sampleChapter('aftermath',112,122,{kind:'epilogue',scope:'政权结束后的存续影响'}),
],1,110);
const withBooks = new Map(files);
withBooks.set('data/books/test-brief.json',brief);
withBooks.set('data/books/test-flexible.json',flexible);
const topic = structuredClone(model.topics[0]);
topic.id = 'test-single-topic';
topic.connections = [];
topic.chapters = [{
  id:'test-section',title:'一节专题',summary:'题要',year:topic.from,place:{label:'资料点',lon:0,lat:0},
  openingBlockId:'opening-summary',sources:brief.sources,sections:[{id:'short',title:'短节',text:'独立短专题。',refs:['one']}],
}];
withBooks.set('data/topics/test-single-topic.json',topic);
const accepted = loadHistoryModel(root,withBooks);
assert.equal(accepted.books.find(book=>book.id===brief.id).chapters.length,1);
assert.equal(accepted.topics.find(item=>item.id===topic.id).chapters[0].sections.length,1);
assert.equal(flexible.chapters.length,35);
assert.deepEqual(ids(accepted.books.find(book=>book.id===flexible.id).chapters),ids(flexible.chapters));
assert.deepEqual(choose(brief,-1),['bce-ce']);
assert.deepEqual(choose(brief,1),['bce-ce']);
assert.deepEqual(choose(brief,0),[]);
assert.deepEqual(choose(flexible,16),['second-by-date','earlier-by-date']);
assert.deepEqual(choose(flexible,19),['thematic']);
assert.deepEqual(choose(flexible,43),[]);
assert.deepEqual(choose(flexible,120),[]);
assert.deepEqual(choose(ming,1400),['two-capitals']);
assert.deepEqual(choose(ming,1500),['court-paperwork']);
assert.deepEqual(choose(ming,1600),['wanli-imjin']);
assert.deepEqual(model.eventLinks.get('i-040'),['ming']);
assert.deepEqual(model.eventLinks.get('i-013'),['ming','coastal-frontier']);
assert.deepEqual(model.eventLinks.get('i-010'),['ming','indian-ocean']);
assert.deepEqual(model.eventLinks.get('i-tr-constantinople-1453'),['roman','crusades-commercial-bleed-1453']);
assert.equal(model.eventLinks.size,46 + model.books.flatMap(book=>book.chapters.flatMap(ch=>ch.eventIds || [])).length);
const eventKey = 'i-tr-constantinople-1453';
const bookWithGap = sampleBook('test-event-gap',[
  sampleChapter('before-gap',1400,1440),
  sampleChapter('after-gap',1460,1490),
],1400,1490);
const gapEventFiles = fixture('data/world-reading.json',data=>{data[eventKey]=bookWithGap.id;});
gapEventFiles.set('data/books/test-event-gap.json',bookWithGap);
assert.deepEqual(loadHistoryModel(root,gapEventFiles).eventLinks.get(eventKey),[bookWithGap.id]);
assert.deepEqual(choose(bookWithGap,1453),[]);
gapEventFiles.get('data/world-reading.json')[eventKey] += '/before-gap';
assert.throws(()=>loadHistoryModel(root,gapEventFiles),/事件与叙事年代不相交/);
assert.equal(model.scenes.length,48);
assert.deepEqual(new Set(model.books.flatMap(book=>book.chapters.flatMap(ch=>(ch.sceneRefs || []).map(ref=>ref.id)))),
  new Set(model.scenes.map(scene=>scene.id)));

const map = new Map(model.mapBindings);
const at = (type,key,year) => (map.get(type+':'+key) || []).filter(([,from,to])=>historyIncludes({from,to},year));
for (const year of [1400,1500,1600]) assert.equal(at('polity','Ming Dynasty',year)[0][0],'ming');
assert.equal(at('country','CN',1948)[0][0],'roc');
assert.equal(at('country','CN',1949)[0][0],'prc');
assert.equal(at('country','IN',2000)[0][3],'primary');
assert.equal(at('country','PK',2000)[0][3],'related');
assert.equal(at('country','LK',2000)[0][5],'maurya-ashoka-kushan');
assert.deepEqual(at('country','BD',2000),[]);
assert.equal(at('country','KZ',2000)[0][0],'central-asia-silk-road');
const withRelated = fixture(bindingsPath,data=>data.bindings.push({
  map:{type:'polity',key:'Ming Dynasty'},target:{bookId:'qing'},range:{from:1620,to:1644},
  relation:'related',scope:'关系模型测试',audit:{status:'unreviewed'},
}));
assert.deepEqual(new Map(loadHistoryModel(root,withRelated).mapBindings).get('polity:Ming Dynasty').map(row=>row[3]),
  ['primary','related']);
reject(bindingsPath,data=>data.bindings.push({...data.bindings.find(row=>row.map.key==='Ming Dynasty'),target:{bookId:'qing'}}),/主入口冲突/);
reject(bindingsPath,data=>{const row=data.bindings.find(r=>r.map.type==='polity');row.range={from:-3400,to:-3350};},/底图覆盖年代不相交/);
reject(bindingsPath,data=>{data.bindings[0].map.key='Nonexistent Map Object';},/入口无效/);
reject(bindingsPath,data=>{data.bindings[0].target.bookId='missing-book';},/不存在的目标/);
reject(mingPath,book=>{book.chapters[0].from=0;},/年代非法/);
reject(mingPath,book=>{book.chapters[0].paragraphs[0].id='';},/正文块 ID/);
reject(mingPath,book=>{book.chapters[0].paragraphs[1].id=book.chapters[0].paragraphs[0].id;},/正文块 ID/);
reject(mingPath,book=>{book.chapters[0].paragraphs[0].refs=['source-missing'];},/来源引用无效/);
reject(mingPath,book=>{book.sources[0].url='data:text/html,x';},/来源.*结构无效/);
reject(mingPath,book=>{book.chapters.find(c=>c.id==='founding').sceneRefs[0].afterBlockId='absent';},/正文块 absent/);
reject(mingPath,book=>{book.audit={status:'checked'};},/已核对需注明范围及日期/);
reject(topicPath,data=>{data.chapters[0].place.lat=91;},/定位无效/);
reject(topicPath,data=>{data.chapters[0].sections[1].text=data.chapters[0].sections[0].text;},/正文完全相同/);
reject(scenesPath,data=>{data[0].places[0].lon=181;},/地点/);
reject('data/world-reading.json',data=>{data['i-tr-constantinople-1453']='roman/fake-chapter';},/不存在的目标/);
const existing = model.books.flatMap(book=>book.chapters.flatMap(ch=>ch.eventIds || []))[0];
reject('data/world-reading.json',data=>{data[existing]=model.eventLinks.get(existing).join('/');},/多个主入口/);
const eventIdsPath = 'data/history/event-identities.json';
reject(eventIdsPath,data=>{data.confirmedDuplicates[0].canonicalEntryId='missing-event-id';},/重复事件组成员或说明无效/);
reject(eventIdsPath,data=>{data.confirmedDuplicates[1].memberIds.push(data.confirmedDuplicates[0].memberIds[0]);},/属于多个重复组/);

const stable = fixture(mingPath,book=>{
  const chapter = book.chapters[1], p = chapter.paragraphs[0];
  chapter.paragraphs.unshift({id:'new-previous',text:'测试插入的新段落。',refs:[]});
  chapter.paragraphs.push(chapter.paragraphs.splice(1,1)[0]);
  p.text += '测试改写同一段内容。';
  p.refs[0] = {sourceId:referenceId(p.refs[0]),locator:'第 1 页',note:'定位结构测试'};
  book.sources.reverse();
});
const reordered = loadHistoryModel(root,stable).books.find(book=>book.id==='ming');
const targetBlock = ming.chapters[1].paragraphs[0];
const stableBlock = reordered.chapters[1].paragraphs.at(-1);
assert.equal(stableBlock.id,targetBlock.id);
assert.equal(reordered.sources.find(source=>source.id===referenceId(stableBlock.refs[0])).url,
  ming.sources.find(source=>source.id===referenceId(targetBlock.refs[0])).url);
assert.deepEqual(reordered.chapters[1].sceneRefs,ming.chapters[1].sceneRefs);

assert.deepEqual(migrateHistory(files).result,files);
const backup = process.argv[2];
if (backup) {
  const original = readHistorySources(backup);
  const migrated = migrateHistory(original).result;
  const acceptedMigration = process.argv[3] ? readHistorySources(process.argv[3]) : files;
  assert.deepEqual(migrated,acceptedMigration);
  assert.deepEqual(migrateHistory(migrated).result,migrated);
  const evidence = migrationEvidence(original,acceptedMigration);
  assert.equal(evidence.legacyContentSha256,evidence.migratedContentSha256);
  assert.equal(evidence.bindings.intentionalChanges.length,6);
  const lost = new Map(acceptedMigration);
  const edited = structuredClone(lost.get(mingPath));
  edited.chapters[0].paragraphs[0].text += '意外改写';
  lost.set(mingPath,edited);
  assert.throws(()=>migrationEvidence(original,lost),/改变了正文/);
}
console.log('History model: flexible chapter structure and recommendation, map identity/conflicts, scoped sources, scene references, audit checks and idempotence passed' +
  (backup ? ' against the tracked Phase 04 source snapshot.' : '.'));
