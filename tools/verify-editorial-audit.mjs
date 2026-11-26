import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventory} from './history-audit-inventory.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const ledger = join(root,'docs/progress/phase-07');
const baselineRef = '5bae983a9510987b63f4bb4b2af07ab8d9e5ecdd';
const read = path => JSON.parse(readFileSync(path,'utf8'));
const text = value => typeof value==='string' && value.trim().length>0;
const date = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const status = new Set(['legacy','unreviewed','issues','checked','insufficient','disputed']);
const accessStatus = new Set(['read','irrelevant','abstract','restricted','temporary-failure','rate-limited','dead','replacement']);
const claimsStatus = new Set(['supported','limited','insufficient','disputed','incorrect']);
const actions = new Set(['retain','revise','qualify','pause','pending']);
const baselineArg = process.argv[2];
const update = process.argv.includes('--write');
const phaseEightFlag = process.argv.indexOf('--phase-08');
const phaseEightBaseline = phaseEightFlag === -1 ? null : process.argv[phaseEightFlag+1];
assert(baselineArg && !baselineArg.startsWith('--'),'传入 Phase 06 归档目录，然后可选 --write');
assert(phaseEightFlag===-1 || phaseEightBaseline && !phaseEightBaseline.startsWith('--'),
  '--phase-08 需要暂存检查点的归档目录');
const old = inventory(baselineArg);
const current = inventory(phaseEightBaseline || root);
const write = (name,data) => {
  const file = join(ledger,name);
  const serialized = JSON.stringify(data,null,2)+'\n';
  if (update && !phaseEightBaseline) {
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

if (phaseEightBaseline) {
  const exemplarLedger = join(root,'docs/progress/phase-08');
  const exemplar = inventory(root);
  const records = new Map();
  const trace = new Map();
  const exemplarBatches = readdirSync(join(exemplarLedger,'batches')).filter(name=>name.endsWith('.json')).sort()
    .map(file=>read(join(exemplarLedger,'batches',file)));
  for (const batch of exemplarBatches) {
    for (const entry of batch.access) {
      assert(/^https:\/\//.test(entry.url) && accessStatus.has(entry.status) && text(entry.material) &&
        text(entry.locator) && text(entry.supports) && date(entry.date),'标杆来源访问记录无效 '+entry.url);
      const key = JSON.stringify([entry.url,entry.locator,entry.supports]);
      trace.set(key,entry);
    }
  }
  for (const batch of exemplarBatches) {
    for (const record of batch.reviews) {
      assert(exemplar.rows.has(record.id) && !records.has(record.id) && text(record.scope) &&
        date(record.date) && actions.has(record.action) && status.has(record.status),'标杆对象审校记录无效 '+record.id);
      if (record.status==='checked') assert(record.claims?.some(claim=>claim.result==='supported'),
        '标杆已核对对象缺少有支持的论断 '+record.id);
      else assert(text(record.limit),'标杆待核对对象缺少限制 '+record.id);
      if (record.secondPass) assert(record.status==='checked' && date(record.secondPass.date) &&
        record.secondPass.date>=record.date && text(record.secondPass.scope),'标杆第二遍复核无效 '+record.id);
      for (const claim of record.claims || []) {
        assert(text(claim.statement) && claimsStatus.has(claim.result) && text(claim.limit),'标杆论断无效 '+record.id);
        if (claim.result==='supported') assert(claim.evidence?.length,'标杆有支持的论断缺少出处 '+record.id);
        for (const citation of claim.evidence || []) {
          const source = exemplar.rows.get(citation.source)?.data;
          const readAt = source && trace.get(JSON.stringify([source.url,citation.locator,citation.supports]));
          assert(readAt && ['read','abstract','replacement'].includes(readAt.status) &&
            (readAt.status!=='abstract' || citation.locator.includes('摘要')),'标杆出处未实际查阅 '+record.id+' '+citation.source);
        }
      }
      records.set(record.id,{batch:batch.id,record});
    }
  }
  const changesSinceDeferral = [];
  for (const id of current.rows.keys()) assert(exemplar.rows.has(id),'标杆丢失原稳定身份 '+id);
  for (const [id,after] of exemplar.rows) {
    const before = current.rows.get(id);
    if (before?.digest===after.digest) continue;
    if (after.kind==='source' && !before) {
      assert([...trace.values()].some(item=>item.url===after.data.url && ['read','abstract','replacement'].includes(item.status)),
        '标杆新增来源缺少实际访问 '+id);
    } else {
      assert(records.has(id) && ['revise','qualify','pause','pending'].includes(records.get(id).record.action),
        '标杆变更缺少重新审校的处置记录 '+id);
    }
    changesSinceDeferral.push({id,before:before?.data ?? null,after:after.data,...(records.has(id)&&{batch:records.get(id).batch})});
  }
  const phaseEightSummary = {
    contentBaseline: '2d8233be8fc5c54cffc5ddf7dc806c711ca8a7bc',
    deferredPhase07: {coverage:summary.coverage,severityOnePending:summary.severityOnePending},
    revisedExisting: changesSinceDeferral.filter(change=>change.before!==null).length,
    introduced: changesSinceDeferral.filter(change=>change.before===null).length,
    reviewed: records.size,
    secondPass: [...records.values()].filter(item=>item.record.secondPass).length,
  };
  for (const [name,data] of Object.entries({'changes.json':changesSinceDeferral,'summary.json':phaseEightSummary})) {
    const file = join(exemplarLedger,name);
    const serialized = JSON.stringify(data,null,2)+'\n';
    if (update) writeFileSync(file,serialized);
    else assert.equal(readFileSync(file,'utf8').replaceAll('\r\n','\n'),serialized,'标杆审校产物与记录不符 '+name);
  }
  console.log(JSON.stringify(phaseEightSummary,null,2));
}
