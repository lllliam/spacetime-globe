import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadHistoryModel} from './history-model.mjs';
import {readHistorySources} from './migrate-history-model.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const [baseline,output] = process.argv.slice(2);
assert(baseline,'Pass a Phase 05 source snapshot followed by an optional report filename');
const old = readHistorySources(baseline);
const current = readHistorySources(root);
const model = loadHistoryModel(root,current);
const without = (object,...keys) => Object.fromEntries(Object.entries(object).filter(([key])=>!keys.includes(key)));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const chapters = [];
const usages = new Map();
const relations = [];
const originalDates = new Map();
const currentDates = new Map();
const dates = owner => owner?.year !== undefined ? [owner.year,owner.year] : owner ? [owner.from,owner.to] : null;
const bucket = (items,key) => Object.fromEntries([...new Set(items.map(item=>item[key]))].sort()
  .map(value=>[value,items.filter(item=>item[key]===value).length]));

function addDates(files,index) {
  for (const [path,owner] of files) if (/^data\/(books|topics)\//.test(path)) {
    index.set(owner.id,dates(owner));
    for (const chapter of owner.chapters) index.set(owner.id+'/'+chapter.id,dates(chapter));
  }
}
addDates(old,originalDates);
addDates(current,currentDates);

function auditLinks(owner,kind,before = [],after = []) {
  assert.equal(after.length,before.length,owner + ' ' + kind);
  for (let i=0;i<before.length;i++) {
    const previous = before[i], link = after[i];
    const target = link.book ?? link.topic ?? link.topicId;
    const oldChapter = previous.chapter ?? previous.chapterId ?? null;
    const targetChapter = link.chapter ?? link.chapterId ?? null;
    assert.equal(target,previous.book ?? previous.topic ?? previous.topicId);
    for (const key of ['label','note','reason','year']) assert.deepEqual(link[key],previous[key],owner + ' ' + key);
    const originDates = currentDates.get(owner) || null;
    const targetDates = currentDates.get(target + (targetChapter ? '/'+targetChapter : ''));
    const legacyType = previous.relation ?? (kind==='contemporaries' ? '旧同期' : '旧延伸阅读');
    const basis = link.audit.status==='checked' ? '限定范围已查证' : link.relation==='compare' ? '按问题作对读，待复核正文中涉及的论断' :
      link.relation==='contemporary' ? '具体章节年代相交，保持为两地并置' :
      kind==='contemporaries' || previous.relation==='contemporary' ? '旧日期或说明不足以确认共时或因果，保留安全阅读路径' :
      '保留目标，沿用编辑导航；未查证旧关系论断';
    relations.push({owner,kind,id:link.id,target,oldChapter,targetChapter,originDates,previousTargetDates:
      originalDates.get(target + (oldChapter ? '/'+oldChapter : '')),targetDates,legacyType,
      formerYear:previous.year??null,originalExplanation:previous.note??previous.reason??previous.label??null,
      relation:link.relation,time:link.time??null,display:link.display??null,dimension:link.dimension??null,
      evidence:link.evidence||[],audit:link.audit,basis});
  }
}

for (const [path,previous] of old) {
  const next = current.get(path);
  if (/^data\/(books|topics)\//.test(path)) {
    assert.deepEqual(without(next,'chapters','connections','sources'),without(previous,'chapters','connections','sources'),path);
    assert.deepEqual(next.sources?.slice(0,previous.sources?.length),previous.sources,path + ' original sources');
    assert.equal(next.chapters.length,previous.chapters.length,path);
    auditLinks(previous.id,'connections',previous.connections,next.connections);
    const stable = new Set(['related','contemporaries','sceneRefs','connections']);
    for (const [index,chapter] of previous.chapters.entries()) {
      const updated = next.chapters[index];
      const baselineBody = without(chapter,...stable), body = without(updated,...stable);
      const owner = previous.id+'/'+chapter.id;
      assert.deepEqual(body,baselineBody,owner);
      chapters.push({path:owner,blocks:(chapter.paragraphs || chapter.sections).length,sha256:digest(body)});
      assert.deepEqual(updated.sceneRefs?.map(ref=>without(ref,'placeLinks','stageId')),chapter.sceneRefs,owner + ' scene links');
      for (const ref of updated.sceneRefs || []) {
        if (!usages.has(ref.id)) usages.set(ref.id,[]);
        usages.get(ref.id).push({bookId:previous.id,chapterId:chapter.id,blockId:ref.afterBlockId,
          ...(ref.placeLinks && {placeLinks:ref.placeLinks})});
      }
      for (const type of ['related','contemporaries','connections']) auditLinks(owner,type,chapter[type],updated[type]);
    }
  } else if (path==='data/reading-timeline.json') {
    assert.deepEqual(Object.keys(next),Object.keys(previous));
    for (const [id,note] of Object.entries(previous)) {
      assert.deepEqual(without(next[id],'related'),without(note,'related'),id + ' timeline');
      auditLinks('timeline/'+id,'timeline',note.related?[note.related]:[],next[id].related?[next[id].related]:[]);
    }
  } else if (path!=='data/scenes.json') assert.deepEqual(next,previous,path);
}
const previousScenes = old.get('data/scenes.json');
assert.deepEqual(current.get('data/scenes.json').map(scene=>without(scene,'observation')),previousScenes);
const scenes = previousScenes.map(record=>{
  const scene = model.scenes.find(row=>row.id===record.id);
  const oldStages = record.steps?.map(step=>({year:step.year,title:step.title,places:step.places,routes:step.routes})) || [];
  const disposition = scene.status==='paused' ? '暂停' : scene.routes.length ? '保留并降级连线' :
    record.routes?.length && !scene.steps.length ? '降级为地点或区域参照' : record.routes?.length ? '简化阶段并移除旧线' : '保留地点观察';
  const limits = scene.audit?.status==='checked' ? scene.audit.scope : '阶段、地点和空间论断待查';
  return {id:record.id,uses:usages.get(record.id)||[],topicEvent:record.topicEvent??null,title:scene.title,question:scene.question,
    originalYear:record.year??scene.year,originalRange:record.from===undefined ? null : [record.from,record.to],oldStages,
    kind:scene.kind,disposition,visible:scene.status==='available',note:scene.note,limit:scene.limit,
    year:scene.year,steps:scene.steps.map(step=>({id:step.id,year:step.year,places:step.places,routes:step.routes,evidence:step.evidence||[]})),
    sites:scene.places.map(place=>({id:place.id,precision:place.precision,evidence:place.evidence||[]})),
    previousRouteCount:record.routes?.length??0,routes:scene.routes,overspecifiedGeometry:Boolean(record.routes?.length),
    sameYearOverviewWasMixed:oldStages.length>0 && new Set(oldStages.map(step=>step.year)).size>1,
    sources:scene.sources.map(({id,title,url})=>({id,title,url})),evidence:scene.evidence||[],audit:scene.audit,phase07:limits+'。'+scene.limit};
});
assert.equal(chapters.length,345);
assert.equal(scenes.length,48);
assert.equal(relations.length,583);
const report = {baseline:'95ffc10',bookCount:model.books.length,topicCount:model.topics.length,comparisonSha256:digest(chapters),
  unchangedChapters:chapters,sceneCounts:bucket(scenes,'disposition'),scenes,
  relationCounts:bucket(relations,'relation'),relationAudit:bucket(relations.map(row=>row.audit),'status'),relations};
if (output) writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(without(report,'unchangedChapters','scenes','relations'),null,2));
