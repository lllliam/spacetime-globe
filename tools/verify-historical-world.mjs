import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inventory} from './history-audit-inventory.mjs';

const [checkpointPath,intakePath]=process.argv.slice(2).map(path=>resolve(path));
assert(checkpointPath && intakePath,'传入 2d8233b 和 acb675d 的 Git 归档目录');
const root=fileURLToPath(new URL('../',import.meta.url));
const progress=join(root,'docs/progress');
const work=join(progress,'historical-world');
const phase07=join(progress,'phase-07');
const phase08=join(progress,'phase-08');
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isHigh=row=>row?.flags?.some(flag=>flag.level===1);
const counted=record=>record.status==='checked' ||
  record.status==='issues' && ['revise','qualify','pause'].includes(record.action);
const ledger=dir=>readdirSync(join(dir,'batches')).filter(name=>name.endsWith('.json')).sort()
  .map(name=>read(join(dir,'batches',name)));
const checkpointModel=await import(pathToFileURL(join(checkpointPath,'tools/history-model.mjs')));
const prior=inventory(checkpointPath,checkpointModel.loadHistoryModel,true).rows;
const intake=inventory(intakePath,undefined,true).rows;
const current=inventory(root,undefined,true).rows;
const originals=read(join(phase07,'inventory.json')).rows;
const originalIDs=new Set(originals.map(row=>row.id));
const originalDigests=new Map(originals.map(row=>[row.id,row.digest]));
const oldSummary=read(join(phase07,'summary.json'));
const pending=new Set(read(join(phase07,'unresolved.json')).notSubstantivelyReviewed);
const priority=originals.filter(row=>isHigh(row) && pending.has(row.id)).map(row=>row.id);
assert.equal(originalIDs.size,5576);
assert.equal(oldSummary.coverage.disposed,387);
assert.equal(priority.length,106);

const exactRecords=new Map();
for(const {reviews} of ledger(phase07)) for(const record of reviews) {
  const row=prior.get(record.id);
  if(row && counted(record) && (record.status==='checked' || row.digest!==originalDigests.get(record.id))) {
    exactRecords.set(record.id,{digest:row.digest,stage:'phase-07'});
  }
}
assert.equal([...exactRecords.keys()].filter(id=>originalIDs.has(id)).length,387);
const exemplar=new Map(read(join(phase08,'changes.json')).map(change=>[change.id,change.after]));
for(const {reviews} of ledger(phase08)) for(const record of reviews) {
  if(!counted(record)) continue;
  const comparable=exemplar.has(record.id) ? digest(exemplar.get(record.id)) : prior.get(record.id)?.digest;
  if(comparable && comparable===intake.get(record.id)?.digest) {
    exactRecords.set(record.id,{digest:comparable,stage:'phase-08'});
  }
}

const batches=ledger(work);
const accessed=new Map();
const reviews=new Map();
for(const batch of batches) {
  for(const access of batch.access) {
    assert(access.status==='read' && access.url.startsWith('https://') &&
      access.locator && access.supports && access.limit && access.date,access.url);
    accessed.set(access.url,access);
  }
  for(const record of batch.reviews) {
    const row=current.get(record.id);
    assert(row && !reviews.has(record.id) && record.scope && record.disposition,record.id);
    assert.equal(record.before,intake.get(record.id)?.digest ?? null,record.id+' 原稿不符');
    assert.equal(record.after,row.digest,record.id+' 现稿不符');
    assert(record.claims?.length,record.id+' 无论断证据');
    if(priority.includes(record.id)) assert(record.secondPass?.scope,record.id+' 缺高风险复核');
    for(const citation of record.claims) {
      const source=current.get(citation.source)?.data;
      assert(source && accessed.has(source.url) && citation.locator && citation.supports && citation.limit,record.id+' 缺可追溯证据 '+citation.source);
    }
    exactRecords.set(record.id,{digest:row.digest,stage:'historical-world'});
    reviews.set(record.id,record);
  }
}
for(const [id,row] of current) {
  if(row.digest===intake.get(id)?.digest) continue;
  if(row.kind==='source') assert(accessed.has(row.data.url),id+' 新来源未查阅');
  else assert(reviews.has(id),id+' 缺本批处置');
}
for(const id of intake.keys()) assert(current.has(id),id+' 本批遗失稳定 ID');

const inheritedCurrent = id=>exactRecords.get(id)?.digest===current.get(id)?.digest && exactRecords.has(id);
const changeLevel=row=>isHigh(row) ? 1 : row?.flags?.some(flag=>flag.level===2) ? 2 : 3;
const intakeChanges=[];
for(const id of [...new Set([...prior.keys(),...intake.keys()])].sort()) {
  const before=prior.get(id), after=intake.get(id);
  if(before?.digest===after?.digest) continue;
  const stage=exactRecords.get(id)?.stage;
  const status=!after ? 'retired' :
    inheritedCurrent(id) ? stage : after.kind==='source' ? 'source-record' : 'needs-review';
  intakeChanges.push({id,change:!after?'removed':!before?'added':'modified',
    before:before?.digest ?? null,atIntake:after?.digest ?? null,level:Math.min(changeLevel(before),changeLevel(after)),status});
}
const remainingPriority=priority.filter(id=>!inheritedCurrent(id));
const count=(items,fn)=>items.filter(fn).length;
const counts={
  originalTotal:originalIDs.size, phase07Disposed:oldSummary.coverage.disposed,
  currentOriginalDisposed:count([...originalIDs],inheritedCurrent),
  priorityAtDeferral:priority.length, currentPriorityRemaining:remainingPriority.length,
  inheritedPhase08Priority:count(priority,id=>inheritedCurrent(id)&&exactRecords.get(id)?.stage==='phase-08'),
  currentBatchPriority:count(priority,id=>reviews.has(id)),
  intakeAdded:count(intakeChanges,change=>change.change==='added'),
  intakeModified:count(intakeChanges,change=>change.change==='modified'),
  intakeRemoved:count(intakeChanges,change=>change.change==='removed'),
  newHighRiskAtIntake:count(intakeChanges,change=>change.level===1&&change.status==='needs-review'),
  batchReviewed:reviews.size,
  batchNewNonSources:count([...reviews.values()],record=>record.before===null),
};
const result={
  phase06:'5bae983a9510987b63f4bb4b2af07ab8d9e5ecdd',
  checkpoint:'2d8233be8fc5c54cffc5ddf7dc806c711ca8a7bc',
  intake:'acb675dbbdf075a8b6d1e0466735226b28b4a28c',
  counts,remainingPriority,intakeChanges
};
const output=JSON.stringify(result,null,2)+'\n';
const target=join(work,'baseline.json');
if(process.argv.includes('--write')) writeFileSync(target,output);
else assert.equal(readFileSync(target,'utf8').replaceAll('\r\n','\n'),output,'Historical World 合账与台账不符');
console.log(JSON.stringify(counts));
