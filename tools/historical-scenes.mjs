import rules from '../src/history-rules.js';
const {isHistoryYear:validYear,historyIncludes,referenceId,observationFrame} = rules;

function distanceLabel(first, second) {
  const rad = Math.PI / 180;
  const haversine = Math.sin((second.lat - first.lat) * rad / 2) ** 2 +
    Math.cos(first.lat * rad) * Math.cos(second.lat * rad) *
    Math.sin((second.lon - first.lon) * rad / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(haversine)));
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km / 10) * 10;
  const distance = rounded ? '约 ' + rounded + ' 公里' : '不足 100 米';
  return first.name + '至' + second.name + ' · 地理直线距离' + distance;
}

const ROUTE_KINDS = new Set(['military', 'trade', 'canal', 'frontier']);
const validCoord = (pair) => Array.isArray(pair) && pair.length === 2 &&
  Number.isFinite(pair[0]) && Math.abs(pair[0]) <= 180 &&
  Number.isFinite(pair[1]) && Math.abs(pair[1]) <= 90;

const key = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const sceneKinds = new Set(['structure','change','connection','comparison','location']);
const pointPrecision = new Set(['site','approximate','reference','region','unknown']);
const linePrecision = new Set(['attested','approximate','schematic','legacy']);
const observationKeys = new Set(['kind','status','title','question','note','limit','dateLabel','naturalOnly','places',
  'placeNotes','routes','steps','focusPolities','sources','distanceBetween','evidence','audit']);

export function compileHistoricalScenes(records, books, topics, polityIds, { checkAudit, sourceList, references }) {
  const topicEvents = new Map(topics.flatMap(topic => topic.chapters.filter(chapter => chapter.mapStory)
    .map(chapter => [chapter.mapStory.worldEntryId, chapter])));
  const scenes = new Map();
  const linkedEvents = new Set();
  const require = (condition, label) => { if (!condition) throw new Error('data/scenes.json 场景校验失败：' + label); };

  for (const record of records) {
    const {id, topicEvent} = record;
    require(typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id) && !scenes.has(id), id);
    const obs = record.observation;
    let scene = record;
    if (topicEvent) {
      const chapter = topicEvents.get(topicEvent);
      require(chapter?.place && !linkedEvents.has(topicEvent), id + ' 专题事件');
      linkedEvents.add(topicEvent);
      const story = chapter.mapStory;
      const [name, role] = chapter.place.label.split(' · ', 2);
      scene = {
        id, topicEvent, year:chapter.year, title:story.title, summary:story.summary,
        places:[{id:'main', name, role, lon:chapter.place.lon, lat:chapter.place.lat}, ...story.places],
        sources:story.refs.map(ref => chapter.sources.find(source => source.id === referenceId(ref))),
      };
    }
    require(scene.title && scene.summary && validYear(scene.year) &&
      (scene.from === undefined && scene.to === undefined ||
        validYear(scene.from) && validYear(scene.to) && scene.from <= scene.year && scene.year <= scene.to), id + ' 年代');
    require(Array.isArray(scene.places) && scene.places.length && new Set(scene.places.map(p => p?.id)).size === scene.places.length &&
      scene.places.every(p => key(p?.id) && text(p.name) && text(p.role) &&
        (validCoord([p.lon,p.lat]) || obs?.placeNotes?.[p.id]?.precision==='unknown' && p.lon===undefined && p.lat===undefined)),id + ' 地点');
    require(scene.sources?.length && scene.sources.every(s => s?.title && /^https:\/\//.test(s.url)), id + ' 来源');
    const placeIds = new Set(scene.places.map(p => p.id));
    if (scene.routes !== undefined) {
      require(Array.isArray(scene.routes) && scene.routes.every(r =>
        r && (placeIds.has(r.from) || validCoord(r.from)) && (placeIds.has(r.to) || validCoord(r.to)) &&
        (r.via === undefined || (Array.isArray(r.via) && r.via.every(validCoord))) &&
        (r.kind === undefined || ROUTE_KINDS.has(r.kind)) &&
        (r.label === undefined || typeof r.label === 'string')
      ), id + ' 路线');
    }
    if (scene.focusPolities !== undefined) {
      require(Array.isArray(scene.focusPolities) && scene.focusPolities.every(name => typeof name === 'string' && name.length > 0), id + ' 关联政权');
    }
    if (scene.steps !== undefined) {
      const routeCount = scene.routes?.length || 0;
      require(Array.isArray(scene.steps) && scene.steps.length >= 2 && scene.steps.every(step =>
        step && validYear(step.year) && step.title && step.note &&
        (step.places === undefined || (Array.isArray(step.places) && step.places.every(pid => placeIds.has(pid)))) &&
        (step.routes === undefined || (Array.isArray(step.routes) && step.routes.every(idx => Number.isInteger(idx) && idx >= 0 && idx < routeCount))) &&
        (step.focusPolities === undefined || (Array.isArray(step.focusPolities) && step.focusPolities.every(name => typeof name === 'string' && name.length > 0)))
      ), id + ' 演进步骤');
    }
    if (scene.distanceBetween !== undefined) {
      require(Array.isArray(scene.distanceBetween) && scene.distanceBetween.length === 2, id + ' 距离地点');
      const [first, second] = scene.distanceBetween.map(key => scene.places.find(place => place.id === key));
      require(first && second && first !== second && (first.lat !== second.lat || first.lon !== second.lon), id + ' 距离地点');
    }
    const label = id + ' 观察';
    require(obs && Object.keys(obs).every(key=>observationKeys.has(key)) && sceneKinds.has(obs.kind) &&
      ['available','paused'].includes(obs.status) && text(obs.question) &&
      text(obs.note) && text(obs.limit) && (obs.title===undefined || text(obs.title)) &&
      (obs.dateLabel===undefined || text(obs.dateLabel)) && (obs.naturalOnly===undefined || typeof obs.naturalOnly==='boolean'),
      label + ' 类型、问题或限制缺失');
    checkAudit(obs.audit,label);
    const sources = [...scene.sources, ...(obs.sources || [])];
    const scope = sourceList(sources,label);
    const cite = (object, label) => {
      references(object.evidence,scope,label,false);
      checkAudit(object.audit,label);
    };
    cite(obs,label);
    const items = (array, valid, part) => require(Array.isArray(array) && new Set(array).size === array.length && array.every(valid),label + ' ' + part);
    const placeInfo = new Map(scene.places.map(p => [p.id,p]));
    for (const [pid, edit] of Object.entries(obs.placeNotes || {})) {
      require(placeInfo.has(pid) && pointPrecision.has(edit?.precision) && Object.keys(edit).every(key=>
        ['name','role','precision','note','evidence','audit'].includes(key)) && (edit.name===undefined || text(edit.name)) &&
        (edit.role===undefined || text(edit.role)) && (edit.note===undefined || text(edit.note)), label + ' 地点 ' + pid);
      cite(edit,label + '/' + pid);
      require(edit.precision!=='site' || edit.evidence?.length,label + ' 精确地点缺定位证据 ' + pid);
    }
    items(obs.places, pid => placeInfo.has(pid), '地点清单');
    const places = obs.places.map(pid => ({...placeInfo.get(pid), precision:'approximate', ...obs.placeNotes?.[pid]}));
    const plotIds = new Set(places.filter(p => p.precision!=='unknown').map(p=>p.id));
    const routes = obs.routes || [];
    require(Array.isArray(routes),label + ' 路线集合无效');
    items(routes.map(r=>r?.id),key,'路线 ID 重复或无效');
    for (const route of routes) {
      require(linePrecision.has(route.precision) && [route.from,route.to].every(end=>plotIds.has(end) || validCoord(end)) &&
        (route.via===undefined || Array.isArray(route.via) && route.via.every(validCoord)) && text(route.label),label + ' 路线 ' + route.id);
      cite(route,label + '/' + route.id);
      references(route.directionEvidence,scope,label,false);
      require(route.precision==='legacy' || route.evidence?.length && text(route.note),label + ' 可见路线缺地理证据或精度说明 ' + route.id);
      if (route.precision==='attested') require(route.evidence.some(ref=>text(ref?.locator) && text(ref?.note)) && route.audit?.status==='checked',
        label + ' 实际路线缺少经过核查的几何及用途证据 ' + route.id);
      require((route.directed===undefined || typeof route.directed==='boolean') &&
        (!route.directed || ['attested','approximate'].includes(route.precision) && route.directionEvidence?.length),
        label + ' 方向缺证据 ' + route.id);
      require(route.precision!=='schematic' || !route.via?.length,label + ' 示意联系不能有推定途经点 ' + route.id);
    }
    const checkPolities = value => { if (value !== undefined) items(value, name => polityIds.has(name), '关联政权无效'); };
    checkPolities(obs.focusPolities);
    const steps = obs.steps || [];
    items(steps.map(step=>step?.id),key,'阶段 ID 重复或无效');
    require(!steps.length || steps.length>=2,label + ' 多阶段至少需要两阶段');
    for (const step of steps) {
      require(validYear(step.year) && text(step.title) && text(step.note) &&
        (scene.from===undefined || historyIncludes(scene,step.year)) && (step.dateLabel===undefined || text(step.dateLabel)),label + ' 阶段年份或解释 ' + step.id);
      if (step.places!==undefined) items(step.places,pid=>places.some(place=>place.id===pid),'阶段地点 ' + step.id);
      if (step.placeNotes!==undefined) require(step.placeNotes && !Array.isArray(step.placeNotes) &&
        typeof step.placeNotes==='object' && Object.entries(step.placeNotes).every(([id,info])=>plotIds.has(id) &&
          (step.places===undefined || step.places.includes(id)) && info && Object.keys(info).every(key=>
            key==='precision' ? pointPrecision.has(info.precision) && info.precision!=='unknown' && info.precision!=='site'
              : ['name','role'].includes(key) && text(info[key]))),label + ' 阶段地点说明 ' + step.id);
      if (step.routes!==undefined) items(step.routes,rid=>routes.some(route=>route.id===rid),'阶段路线 ' + step.id);
      checkPolities(step.focusPolities);
      cite(step,label + '/' + step.id);
      const shown = observationFrame({year:scene.year, places, routes, focusPolities:obs.focusPolities},step);
      require(!step.routes?.some(rid=>routes.some(route=>route.id===rid && route.precision!=='legacy') &&
        !shown.routes.some(route=>route.id===rid)),label + ' 阶段路线端点未显示 ' + step.id);
    }
    require(obs.status==='paused' || plotIds.size > 0,label + ' 可用场景缺少定位');
    const [a,b] = (obs.distanceBetween || []).map(id=>places.find(p=>p.id===id));
    require(obs.distanceBetween===undefined || obs.distanceBetween.length===2 && a && b && a!==b &&
      (a.lon!==b.lon || a.lat!==b.lat) && plotIds.has(a.id) && plotIds.has(b.id),label + ' 观察距离端点');
    scenes.set(id, {id, topicEvent, title:obs.title || scene.title, year:steps[0]?.year ?? scene.year,
      from:steps.length ? (scene.from ?? Math.min(...steps.map(step=>step.year))) : undefined,
      to:steps.length ? (scene.to ?? Math.max(...steps.map(step=>step.year))) : undefined,
      ...obs, places:places.filter(p=>p.precision!=='unknown'), unknownPlaces:places.filter(p=>p.precision==='unknown'),
      routes, steps, sources, distance: a && b ? {ids:[a.id,b.id],label:distanceLabel(a,b)} : undefined,
      originalYear:scene.year});
  }

  const used = new Set();
  for (const book of books) {
    for (const chapter of book.chapters) {
      const seen = new Set(), linksByBlock = new Map();
      require(!chapter.map && (chapter.sceneRefs===undefined || Array.isArray(chapter.sceneRefs)),
        book.id + '/' + chapter.id + ' 应使用场景引用数组');
      const blockIds = new Set(chapter.paragraphs.map(p=>p.id));
      for (const ref of chapter.sceneRefs || []) {
        const scene = scenes.get(ref?.id);
        require(scene && !seen.has(ref.id) && ref.after===undefined && blockIds.has(ref.afterBlockId) &&
          (historyIncludes(chapter,scene.originalYear) || text(ref.scope)),
          'data/books/' + book.id + '/' + chapter.id + ' → ' + ref?.id + ' 正文块 ' + ref?.afterBlockId);
        seen.add(ref.id);
        used.add(ref.id);
        const step = ref.stageId === undefined ? undefined : scene.steps.find(step=>step.id===ref.stageId);
        require(ref.stageId===undefined || step && scene.status==='available',book.id + '/' + chapter.id + ' 场景阶段 ' + ref.stageId);
        if (ref.placeLinks !== undefined) {
          require(scene.status==='available' && Array.isArray(ref.placeLinks),book.id + '/' + chapter.id + ' 地名链接');
          for (const link of ref.placeLinks) {
            const paragraph = chapter.paragraphs.find(p=>p.id===link.blockId);
            const stage = scene.steps.find(s=>s.id===link.stageId);
            const stages = scene.steps.filter(s=>observationFrame(scene,s).places.some(p=>p.id===link.placeId));
            const effective = stage || (link.stageId===undefined && (stages.length===1 ? stages[0] : step));
            const linkKey = link.blockId + ':' + link.text;
            const from = paragraph?.text.indexOf(link.text);
            const to = from + (link.text?.length || 0);
            const spans = linksByBlock.get(link.blockId) || [];
            require(text(link.text) && paragraph?.text.split(link.text).length===2 && !spans.some(([a,b])=>a<to && from<b) &&
              (scene.steps.length ? effective : link.stageId===undefined) && (link.stageId===undefined || stage) &&
              observationFrame(scene,effective).places.some(p=>p.id===link.placeId),book.id + '/' + chapter.id + ' 地名链接 ' + linkKey);
            spans.push([from,to]);
            linksByBlock.set(link.blockId,spans);
          }
        }
      }
    }
  }
  for (const [id,scene] of scenes) require(used.has(id) || scene.topicEvent,id + ' 无有效进入路径');
  return [...scenes.values()];
}
