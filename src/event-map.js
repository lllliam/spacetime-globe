const eventMapTargets = new Map(TOPICS.flatMap((topic) => topic.chapters
  .filter((chapter) => chapter.mapStory?.worldEntryId)
  .map((chapter) => [chapter.mapStory.worldEntryId, { topic, chapter }])));
const eventMapPanel = el('event-map-panel'), eventMapPoints = el('event-map-points'), eventMapNote = el('event-map-note');
const eventMapScroll = el('event-map-scroll');
const eventMapReturn = el('event-map-return'), eventMapTitle = el('event-map-title'), eventMapRead = el('event-map-read');
const eventMapParticipants = el('event-map-participants');
const eventMapDistance = el('event-map-distance');
const eventMapSteps = el('event-map-steps');
const eventMapTop = el('event-map-top'), eventMapYear = el('event-map-year');
const eventMapPlaces = el('event-map-places'), eventMapSources = el('event-map-sources');
const eventMapPlaceNote = el('event-map-place-note');
const scenesByEvent = new Map([...historicalScenes.values()].filter(scene => scene.topicEvent && scene.status==='available').map(scene => [scene.topicEvent, scene]));
let worldEvent = null;
let globeFlyRaf = 0;

const ROUTE_STYLES = {
  attested: { label:'有资料支持的路线', color:'#a3d2b3', dash:[], width:2.5 },
  approximate: { label:'近似路线', color:'#95c6ec', dash:[7,4], width:2.5 },
  schematic: { label:'示意联系', color:'#ebce98', dash:[2,5], width:2.7 },
};
const placePrecisionLabels = {site:'有定位依据', approximate:'近似地点', reference:'现代定位参照', region:'区域定位', unknown:'地点未详'};

function worldEventTarget(event, year) {
  const target = eventMapTargets.get(event.id);
  return target?.chapter.year === year ? target : null;
}

function readingPlaceVector({ lon, lat }) {
  const longitude = lon * Math.PI / 180, latitude = lat * Math.PI / 180;
  return [Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)];
}
function projectReadingPlace([x, y, z], m) {
  return {
    x: view.cx + state.panX + (m[0] * x + m[3] * y + m[6] * z) * view.Rz,
    y: view.cy + state.panY - (m[1] * x + m[4] * y + m[7] * z) * view.Rz,
    front: m[2] * x + m[5] * y + m[8] * z > 0,
    z: m[2] * x + m[5] * y + m[8] * z,
  };
}
function chapterPlaces(chapter) {
  const story = chapter.mapStory;
  const [name, role] = chapter.place.label.split(' · ', 2);
  return [{ ...chapter.place, id: 'main', name, role }, ...story.places];
}

function shortestYawDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function cancelGlobeFly() {
  cancelAnimationFrame(globeFlyRaf);
  globeFlyRaf = 0;
}

function captureGlobeView() {
  const { year, layerId, focus, yaw, tilt, zoom, panX, panY, lift } = state;
  return { year, layerId, focus: focus && { ...focus }, yaw, tilt, zoom, panX, panY, lift, natural: chrome.natural };
}

function projectGlobeView({ natural, ...globe }) {
  Object.assign(state, globe);
  chrome.natural = natural;
  onYearChanged();
  layout();
}

function resumeEventMap() {
  const { readingView, readingMap, phaseId, place } = session.observe;
  if (!worldEvent && readingMap) {
    showEventMap({...readingMap, initialStageId:phaseId, initialPlaceId:place}, {animate:false});
  }
  const markers = [...(worldEvent.points?.values() || [])].map(place => place.mark);
  eventMapPoints.replaceChildren(...markers);
  eventMapPoints.hidden = !markers.length;
  projectGlobeView(readingView);
  syncObservationMap(worldEvent, session.observe.year);
  session.updateObserve({ camera: session.camera(state) });
  eventMapRead.focus({ preventScroll: true });
}

function flyGlobeTo({ yaw, tilt, zoom, panX = 0, panY = 0, duration = 620 }) {
  pauseGlobe();
  cancelGlobeFly();
  if (reducedGlobeMotion.matches || duration <= 0) {
    state.yaw = yaw;
    state.tilt = tilt;
    state.zoom = zoom;
    state.panX = panX;
    state.panY = panY;
    view.Rz = view.R * state.zoom;
    invalidate();
    cameraSettled();
    return;
  }
  const y0 = state.yaw, t0 = state.tilt, z0 = state.zoom;
  const px0 = state.panX, py0 = state.panY;
  const dy = shortestYawDelta(y0, yaw), dt = tilt - t0, dz = zoom - z0;
  const start = performance.now();
  const step = (now) => {
    const p = clamp((now - start) / duration, 0, 1);
    const e = 1 - Math.pow(1 - p, 3);
    state.yaw = p < 1 ? y0 + dy * e : yaw;
    state.tilt = p < 1 ? t0 + dt * e : tilt;
    state.zoom = p < 1 ? z0 + dz * e : zoom;
    state.panX = lerp(px0, panX, e);
    state.panY = lerp(py0, panY, e);
    view.Rz = view.R * state.zoom;
    invalidate();
    if (p < 1) globeFlyRaf = requestAnimationFrame(step);
    else { globeFlyRaf = 0; cameraSettled(); }
  };
  globeFlyRaf = requestAnimationFrame(step);
}

function cameraForVectors(vectors, isScene = true) {
  if (!vectors.length) return { yaw: state.yaw, tilt: state.tilt, zoom: 1.8 };
  if (vectors.length === 1) {
    const [x, y, z] = vectors[0];
    return { yaw: -Math.atan2(x, z), tilt: Math.asin(clamp(y, -1, 1)), zoom: 3.1 };
  }
  const center = vectors.reduce((sum, v) => [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]], [0, 0, 0]);
  const len = Math.hypot(...center);
  const dir = len > 0.01 ? center.map((v) => v / len) : vectors[0];
  const maxAngle = Math.max(...vectors.map((v) => Math.acos(clamp(v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2], -1, 1))));
  const yaw = -Math.atan2(dir[0], dir[2]);
  const tilt = Math.asin(clamp(dir[1], -1, 1));
  const zoom = isScene
    ? clamp(0.45 / Math.max(maxAngle, 0.02), 1.05, 4.6)
    : clamp(0.5 / Math.max(maxAngle, 0.02), 1.05, 5.5);
  return { yaw, tilt, zoom };
}

function slerpSegment(a, b, samples = 24) {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const omega = Math.acos(dot);
  const pts = [];
  if (omega < 0.001) return [a, b];
  const sinO = Math.sin(omega);
  if (sinO < 1e-6) return [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const w1 = Math.sin((1 - t) * omega) / sinO;
    const w2 = Math.sin(t * omega) / sinO;
    pts.push([a[0] * w1 + b[0] * w2, a[1] * w1 + b[1] * w2, a[2] * w1 + b[2] * w2]);
  }
  return pts;
}

function resolveRouteVectors(route, pointsMap) {
  const toVec = (end) => {
    if (typeof end === 'string') {
      const p = pointsMap?.get(end);
      return p ? p.vector : null;
    }
    return Array.isArray(end) ? readingPlaceVector({ lon: end[0], lat: end[1] }) : null;
  };
  const nodes = [toVec(route.from), ...(route.via || []).map(([lon, lat]) => readingPlaceVector({ lon, lat })), toVec(route.to)].filter(Boolean);
  if (nodes.length < 2) return [];
  const all = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const seg = slerpSegment(nodes[i], nodes[i + 1], 20);
    if (i > 0) seg.shift();
    all.push(...seg);
  }
  return all;
}

function drawSceneRoutes(ctxObj, matrix) {
  const routes = ctxObj?.routes;
  if (!routes?.length) return;
  const cx = view.cx + state.panX, cy = view.cy + state.panY, Rz = view.Rz;

  vctx.save();
  vctx.beginPath();
  vctx.arc(cx, cy, Rz - 0.5, 0, TAU);
  vctx.clip();
  vctx.lineJoin = 'round';
  vctx.lineCap = 'round';

  routes.forEach((route) => {
    const vecs = route._vecs || (route._vecs = resolveRouteVectors(route, ctxObj.points));
    if (vecs.length < 2) return;
    const style = ROUTE_STYLES[route.precision];
    if (!style) return;
    const screenPts = [];
    let currentRun = [];
    for (const v of vecs) {
      const p = projectReadingPlace(v, matrix);
      if (p.z > 0.015) {
        currentRun.push(p);
      } else if (currentRun.length) {
        screenPts.push(currentRun);
        currentRun = [];
      }
    }
    if (currentRun.length) screenPts.push(currentRun);
    if (!screenPts.length) return;

    vctx.save();

    // Dark casing for readability
    vctx.setLineDash([]);
    vctx.strokeStyle = 'rgba(6,10,16,.72)';
    vctx.lineWidth = style.width + 2.4;
    vctx.beginPath();
    for (const run of screenPts) {
      if (run.length < 2) continue;
      vctx.moveTo(run[0].x, run[0].y);
      for (let i = 1; i < run.length; i++) vctx.lineTo(run[i].x, run[i].y);
    }
    vctx.stroke();

    // Styled route stroke
    vctx.setLineDash(style.dash);
    vctx.strokeStyle = style.color;
    vctx.lineWidth = style.width;
    vctx.stroke();
    vctx.setLineDash([]);

    // Directional arrowheads along visible runs
    if (route.directed === true && route.directionEvidence?.length) {
      for (const run of screenPts) {
        if (run.length < 6) continue;
        const marks = run.length > 22 ? [Math.floor(run.length * 0.45), Math.floor(run.length * 0.82)] : [Math.floor(run.length * 0.65)];
        for (const mi of marks) {
          const a = run[Math.max(0, mi - 2)], b = run[Math.min(run.length - 1, mi + 1)];
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const sz = 6.5;
          vctx.fillStyle = style.color;
          vctx.beginPath();
          vctx.moveTo(b.x, b.y);
          vctx.lineTo(b.x - sz * Math.cos(angle - 0.52), b.y - sz * Math.sin(angle - 0.52));
          vctx.lineTo(b.x - sz * Math.cos(angle + 0.52), b.y - sz * Math.sin(angle + 0.52));
          vctx.closePath();
          vctx.fill();
        }
      }
    }
    vctx.restore();
  });
  vctx.restore();
}

function activeSceneFocusPolities() {
  const ctxObj = session.mode === 'Observe' ? worldEvent : null;
  if (!ctxObj || chrome.natural || partition?.layerId!=='polity' || partition.year!==session.observe.year) return null;
  const list = ctxObj.activeFocusPolities;
  return list?.length ? new Set(list) : null;
}

function buildPlaceMarkers(places, targetObj) {
  eventMapPoints.replaceChildren();
  const points = new Map(places.map((place) => {
    const mark = document.createElement('div');
    mark.className = 'event-map-point';
    mark.dataset.place = place.id;
    mark.dataset.precision = place.precision || 'approximate';
    const leader = document.createElement('i');
    leader.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = place.name;
    button.dataset.place = place.id;
    button.setAttribute('aria-pressed', 'false');
    mark.append(leader, button);
    eventMapPoints.append(mark);
    return [place.id, { ...place, mark, leader, button, vector: readingPlaceVector(place) }];
  }));
  targetObj.points = points;
  eventMapPoints.hidden = false;
  return points;
}

function drawWorldEventPlaces(points, rotationMatrix, hudBounds) {
  const occupied = [];
  const leftEdge = 14;
  const bottom = eventMapPanel.getBoundingClientRect().top - 8;
  const visible = [...points.values()].map((entry) => ({
    entry, p: projectReadingPlace(entry.vector, rotationMatrix),
  }));
  for (const { entry, p } of visible) {
    const { mark, leader, button } = entry;
    mark.hidden = !p.front || p.x < leftEdge || p.x > view.w - 14 || p.y < view.safeTop + 12 || p.y > bottom ||
      overlapsGlobeHud(hudBounds, p.x - 6, p.y - 6, 12, 12);
    if (mark.hidden) continue;
    const w = 18 + entry.name.length * 13, h = 32;
    const left = p.x < view.cx ? [-w - 10, 10] : [10, -w - 10];
    const options = [
      ...left.map((dx) => [dx, -h / 2]),
      [-w / 2, -h - 11], [-w / 2, 11],
      ...left.flatMap((dx) => [[dx, 8], [dx, -h - 8]]),
    ];
    const fits = ([dx, dy]) => {
      const x = p.x + dx, y = p.y + dy;
      return x > leftEdge - 8 && x + w < view.w - 4 && y > view.safeTop + 6 && y + h < bottom &&
        !overlapsGlobeHud(hudBounds, x, y, w, h) &&
        !occupied.some((box) => x < box.x + box.w + 4 && x + w + 4 > box.x && y < box.y + box.h && y + h > box.y) &&
        !visible.some(({ entry: other, p: point }) => other !== entry && point.front &&
          point.x > x - 6 && point.x < x + w + 6 && point.y > y - 6 && point.y < y + h + 6);
    };
    const label = options.find(fits);
    leader.hidden = button.hidden = !label;
    if (label) {
      const [dx, dy] = label;
      occupied.push({ x: p.x + dx, y: p.y + dy, w, h });
      button.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      const endX = clamp(0, dx, dx + w), endY = clamp(0, dy, dy + h);
      leader.style.width = Math.hypot(endX, endY) + 'px';
      leader.style.transform = 'rotate(' + Math.atan2(endY, endX) + 'rad)';
    }
    mark.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
  }
}

function drawEventMap(hudBounds) {
  const ctxObj = session.mode === 'Observe' ? worldEvent : null;
  if (!ctxObj) return;
  const matrix = rotation();
  if (ctxObj.routes?.length) {
    drawSceneRoutes(ctxObj, matrix);
  }
  if (ctxObj.points) {
    drawWorldEventPlaces(ctxObj.points, matrix, hudBounds);
    return;
  }
  if (!ctxObj.regionVector) return;
  const point = projectReadingPlace(ctxObj.regionVector, matrix);
  if (!point.front) return;
  const radius = clamp(view.Rz * .20, 18, 58);
  vctx.save();
  vctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const glow = vctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
  glow.addColorStop(0, '#edc68a40');
  glow.addColorStop(.55, '#edc68a2c');
  glow.addColorStop(1, '#edc68a00');
  vctx.fillStyle = glow;
  vctx.beginPath();
  vctx.arc(point.x, point.y, radius, 0, TAU);
  vctx.fill();
  vctx.restore();
}

function renderEventParticipants(participants) {
  eventMapParticipants.open = false;
  eventMapParticipants.hidden = !participants.length;
  el('event-participant-names').textContent = participants.map((p) => p.name).join('、');
  el('event-participant-roles').innerHTML = participants.map((p) =>
    '<dt>' + esc(p.name) + '</dt><dd>' + esc(p.role) +
      (p.members?.length ? '<span>' + esc(p.members.join('、')) + '</span>' : '') + '</dd>').join('');
}

function renderStepsBar(steps, activeIdx) {
  eventMapSteps.hidden = !steps.length;
  if (eventMapSteps.children.length !== steps.length) {
    eventMapSteps.innerHTML = steps.map((step,i) =>
      '<button type="button" class="step-chip" data-scene-step="' + i + '"><span>' +
      esc(step.dateLabel || fmtYear(step.year)) + '</span> ' + esc(step.title) + '</button>').join('');
  }
  for (const button of eventMapSteps.children)
    button.setAttribute('aria-pressed',String(Number(button.dataset.sceneStep)===activeIdx));
  const active = eventMapSteps.children[activeIdx];
  if (active && (active.offsetLeft < eventMapSteps.scrollLeft ||
      active.offsetLeft + active.offsetWidth > eventMapSteps.scrollLeft + eventMapSteps.clientWidth))
    eventMapSteps.scrollLeft = active.offsetLeft - eventMapSteps.offsetLeft;
}

function renderObservationLegend(ctxObj) {
  const styles = [...new Set(ctxObj.routes.map(route=>route.precision))];
  const points = [...new Set([...ctxObj.points?.values() || []].map(place=>place.precision))];
  const legend = el('event-map-legend');
  const map = chrome.natural ? '自然地理底图' : '历史疆域参考 · ' + yearLabel(session.observe.year);
  legend.innerHTML = '<span>' + map + '</span>' +
    styles.map(style=>'<span><i data-route-precision="' + style + '"></i>' + ROUTE_STYLES[style].label + '</span>').join('') +
    points.filter(point=>placePrecisionLabels[point]).map(point=>'<span><i data-place-precision="' + point + '"></i>' +
      placePrecisionLabels[point] + '</span>').join('') + (ctxObj.regionVector || ctxObj.spec.kind==='location' ? '<span>区域定位</span>' : '');
}

function syncObservationMap(ctxObj, year) {
  const request = ctxObj.mapRequest = (ctxObj.mapRequest || 0) + 1;
  const supported = !ctxObj.naturalOnly && hasHistoricalCoverage(year);
  state.year = year;
  state.layerId = supported ? 'polity' : 'country';
  chrome.natural = !supported || !polityState.loaded;
  onYearChanged();
  renderObservationLegend(ctxObj);
  if (supported && !polityState.loaded) ensurePolity().then(() => {
    if (session.mode !== 'Observe' || worldEvent !== ctxObj || request !== ctxObj.mapRequest || session.observe.year !== year) return;
    chrome.natural = !polityState.loaded;
    onYearChanged();
    renderObservationLegend(ctxObj);
  });
}

function renderObservationSources(ctxObj, step) {
  const sources = new Map((ctxObj.spec.sources || []).map(source=>[source.id,source]));
  const list = [...sources.values()].map(source=>'<li><a href="' + esc(source.url) +
    '" target="_blank" rel="noopener noreferrer">' + esc(source.title) + '</a></li>').join('');
  const detail = (label,evidence) => evidence?.length ? '<li><strong>' + esc(label) + '：</strong>' +
    evidence.map(ref => {
      const source = sources.get(referenceId(ref));
      return '<a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' + esc(source.title) +
        '</a>' + (ref.locator ? ' · ' + esc(ref.locator) : '') + (ref.note ? ' · ' + esc(ref.note) : '');
    }).join('；') + '</li>' : '';
  const evidence = detail('空间解释',ctxObj.spec.evidence) + detail(step?.title || '',step?.evidence) +
    [...ctxObj.points?.values() || []].map(place=>detail(place.name,place.evidence)).join('') +
    ctxObj.routes.map(route=>detail(route.label,route.evidence) + detail(route.label + '方向',route.directionEvidence)).join('');
  const status = ctxObj.spec.audit;
  const statusText = status?.status==='checked' ? '已核查范围：' + status.scope : '地理证据待逐项核查。';
  const mapNote = hasHistoricalCoverage(session.observe.year) && !ctxObj.naturalOnly
    ? '历史疆域来自 Cliopatria，用于该观察年的范围参考。加载失败时使用自然地理底图。'
    : '此观察仅使用自然地理底图。';
  el('event-map-source-content').innerHTML = '<p>' + esc(ctxObj.spec.limit || '代表点用于大致地理定位。') +
    '</p><p>' + esc(mapNote) + '</p>' + (ctxObj.sceneId ? '<p>' + esc(statusText) + '</p>' : '') +
    ctxObj.routes.map(route=>'<p><strong>' + esc(route.label) + '</strong> · ' + esc(route.note) + '</p>').join('') +
    (list ? '<ul class="observation-sources-list">' + list + '</ul>' : '') +
    (evidence ? '<ul class="observation-evidence">' + evidence + '</ul>' : '');
}

function applySceneStep(ctxObj, stepIdx, { animate = true } = {}) {
  const steps = ctxObj.spec.steps || [];
  const step = steps[stepIdx];
  const frame = observationFrame(ctxObj.spec, step);
  session.updateObserve({ year:frame.year, phase:step ? stepIdx : -1, phaseId:step?.id ?? null, place:null });
  ctxObj.routes = frame.routes;
  ctxObj.activeFocusPolities = frame.focusPolities;
  ctxObj.points = null;
  eventMapPoints.replaceChildren();
  if (frame.places.length) buildPlaceMarkers(frame.places,ctxObj);
  else eventMapPoints.hidden = true;
  const placeList = el('event-map-place-chips');
  const unknownPlaces = (ctxObj.spec.unknownPlaces || []).filter(place=>step?.places===undefined || step.places.includes(place.id));
  eventMapPlaces.hidden = !frame.places.length && !unknownPlaces.length;
  placeList.innerHTML = frame.places.map(place=>'<button type="button" data-scene-place="' + esc(place.id) +
    '" aria-pressed="false"><strong>' + esc(place.name) + '</strong><small>' +
    esc(placePrecisionLabels[place.precision] || placePrecisionLabels.approximate) + '</small></button>').join('') +
    unknownPlaces.map(place=>'<p>' + esc(place.name) + ' · 地点未详</p>').join('');
  eventMapYear.textContent = step?.dateLabel || ctxObj.spec.dateLabel || yearLabel(frame.year);
  eventMapNote.textContent = step ? step.title + ' · ' + step.note : ctxObj.spec.note;
  eventMapPlaceNote.hidden = true;
  eventMapPlaceNote.textContent = '';
  const distance = ctxObj.spec.distance;
  eventMapDistance.hidden = !distance || !distance.ids.every(id=>ctxObj.points?.has(id));
  eventMapDistance.textContent = eventMapDistance.hidden ? '' : distance.label;
  renderStepsBar(steps,step ? stepIdx : -1);
  syncObservationMap(ctxObj,frame.year);
  renderObservationSources(ctxObj,step);
  resetObservationCamera(ctxObj,animate);
}

function resetObservationCamera(ctxObj, animate = true) {
  const vectors = [...ctxObj.points?.values() || []].map(place=>place.vector);
  const camera = cameraForVectors(vectors.length ? vectors : ctxObj.regionVector ? [ctxObj.regionVector] : [], Boolean(ctxObj.sceneId));
  if (ctxObj.regionVector && !vectors.length) camera.zoom = 1.4;
  flyGlobeTo({...camera,duration:animate ? 560 : 0});
}

function showEventMap(spec, {animate = true} = {}) {
  const {year,title,back,event,sceneId,initialPlaceId,initialStageId} = spec;
  pauseGlobe();
  cancelGlobeFly();
  closeYearControl();
  closeWorld();
  document.body.classList.add('event-map-open');
  document.body.classList.toggle('scene-observation', Boolean(sceneId));
  state.focus = null;
  state.lift = 0;
  sheetState.detent = 'hidden';
  applySheetOffset(sheetDetents().hidden,false);
  worldEvent = { spec, event, target:spec.target, sceneId, readingTarget:spec.readingTarget, naturalOnly:spec.naturalOnly, routes:[], points:null };
  session.updateObserve({ id:sceneId || String(event.id), year, phase:-1, phaseId:null, place:null });
  if (!spec.places?.length && Number.isFinite(event?.px) && Number.isFinite(event?.py)) {
    const lon = (event.px / MAPW - .5) * 360, lat = (.5 - event.py / MAPH) * 180;
    worldEvent.regionVector = readingPlaceVector({lon,lat});
  }
  eventMapTitle.textContent = title;
  el('event-map-question').textContent = spec.question || '';
  el('event-map-question').hidden = !spec.question;
  eventMapRead.hidden = !spec.readingTarget;
  eventMapReturn.querySelector('span').textContent = back;
  eventMapTop.hidden = eventMapPanel.hidden = false;
  eventMapScroll.scrollTop = 0;
  eventMapSteps.replaceChildren();
  eventMapPlaces.open = eventMapSources.open = false;
  renderEventParticipants(spec.participants || []);
  applySceneStep(worldEvent,Math.max(0,(spec.steps || []).findIndex(step=>step.id===initialStageId)),{animate});
  if (initialPlaceId && worldEvent.points?.has(initialPlaceId)) selectEventPlace(initialPlaceId,true,animate);
  layout();
  session.updateObserve({ camera:session.camera(state) });
  eventMapReturn.focus({preventScroll:true});
  saveSession(true);
}

function openWorldEvent(event) {
  if (!event || session.mode !== 'Explore') return;
  claimSession();
  event = canonicalEventById.get(event.id) || event;
  const memberIds = event.memberIds || [event.id];
  const year = worldEventYear(event);
  const target = worldEventTarget(event,year);
  const story = target?.chapter.mapStory;
  const scene = target && scenesByEvent.get(event.id);
  const regionNames = [...new Set((event.regions || [event.region])
    .map(rid => regionById.get(rid)?.zh || event.regionRef?.zh).filter(Boolean))];
  const fromList = !overlay.hidden;
  const source = fromList ? worldSource(String(event.id),'map') : session.source({kind:'map'});
  rememberExplore();
  if (!session.enterObserve({kind:'event',source})) return;
  const topicPlaces = target && ![...historicalScenes.values()].some(scene=>scene.topicEvent===event.id) ? chapterPlaces(target.chapter) : [];
  const places = topicPlaces.map(p=>({...p,precision:'approximate'}));
  const articleSources = story && story.refs.map(ref=>target.chapter.sources.find(s=>s.id===referenceId(ref)));
  const memberSources = (event.sources || (event.source ? [event.source] : [])).map((url, idx) => ({
    id: 'event-source-' + idx, title: (titleFromEventNote(event) || event.zh) + (regionNames[idx] ? ' · ' + regionNames[idx] : ''), url,
  }));
  showEventMap({ note:story?.summary || (regionNames.length ? '相关地区 · ' + regionNames.join('、') : '地点未详'),
    ...scene, event, target, year,
    readingTarget:worldReadingTarget(event,year),
    title:timelineItem(event).title || event.zh, participants:story?.participants,
    places:scene?.places || places, sources:scene?.sources || articleSources || (memberSources.length ? memberSources : undefined),
    back:fromList ? '返回史事' : '返回探索' });
}

function titleFromEventNote(event) {
  return timelineItem(event)?.title || event?.zh || '';
}

function openReadingScene(scene, trigger, {initialPlaceId = null, initialStageId = null} = {}) {
  if (scene?.status!=='available' || !reading.active) return;
  claimSession();
  rememberReading();
  const returnView = captureGlobeView();
  if (!session.enterObserve({ kind:'scene', returnView,
    source:{sceneId:scene.id, triggerPlace:trigger?.dataset.pinPlace || null, triggerBlock:trigger?.closest('[data-block-id]')?.dataset.blockId} })) return;
  hideReader();
  showEventMap({...scene, sceneId:scene.id, initialStageId, initialPlaceId, back:'返回正文'});
}

function returnToWorld() {
  if (session.mode !== 'Observe' || closeTopNavigationPanel()) return;
  claimSession();
  const previous = session.returnFromObserve();
  worldEvent = null;
  pauseGlobe();
  cancelGlobeFly();
  document.body.classList.remove('event-map-open','scene-observation');
  eventMapTop.hidden = eventMapPanel.hidden = eventMapPoints.hidden = eventMapSteps.hidden = true;
  syncTopChrome();
  el('event-map-place-chips').replaceChildren();
  eventMapPoints.replaceChildren();
  eventMapSteps.replaceChildren();
  if (previous.origin==='Read') {
    projectGlobeView(previous.returnView);
    showReader();
    const {sceneId,triggerPlace,triggerBlock} = previous.source;
    const buttons = [...bookBody.querySelectorAll(triggerPlace ? '[data-pin-scene]' : '[data-subject-scene]')];
    const button = buttons.find(node=>triggerPlace ? node.dataset.pinScene===sceneId && node.dataset.pinPlace===triggerPlace &&
      (!triggerBlock || node.closest('[data-block-id]')?.dataset.blockId===triggerBlock) : node.dataset.subjectScene===sceneId);
    (button || el('reading-title')).focus({preventScroll:true});
  } else {
    restoreExploreView();
    if (previous.source.kind==='events') restoreWorldSource(previous.source);
    else canvas.focus({preventScroll:true});
  }
  saveSession(true);
}

eventMapReturn.addEventListener('click',returnToWorld);
eventMapRead.addEventListener('click',() => {
  const target = worldEvent?.readingTarget;
  if (session.mode==='Observe' && target) beginReading(null,null,target.chapter?.id,target.book,
    {entryYear:target.year,source:session.observe.source});
});
el('event-map-reset').addEventListener('click',() => {
  if (session.mode==='Observe' && worldEvent) resetObservationCamera(worldEvent);
});

function selectEventPlace(id, forceSelect = false, animate = true) {
  const ctxObj = session.mode==='Observe' ? worldEvent : null;
  if (!ctxObj?.points || id!==null && !ctxObj.points.has(id)) return;
  const selected = id===null || !forceSelect && session.observe.place===id ? null : ctxObj.points.get(id);
  session.updateObserve({place:selected?.id ?? null});
  eventMapPlaceNote.hidden = !selected;
  eventMapPlaceNote.textContent = selected ? selected.name + ' · ' + selected.role +
    '（' + (placePrecisionLabels[selected.precision] || placePrecisionLabels.approximate) + '）' : '';
  for (const chip of el('event-map-place-chips').querySelectorAll('[data-scene-place]'))
    chip.setAttribute('aria-pressed',String(chip.dataset.scenePlace===selected?.id));
  if (selected) {
    const cam = cameraForVectors([selected.vector],true);
    flyGlobeTo({...cam,zoom:Math.min(4,Math.max(2.2,cam.zoom)),duration:animate ? 460 : 0});
  }
  for (const [key,place] of ctxObj.points) {
    place.mark.classList.toggle('selected',key===selected?.id);
    place.button.setAttribute('aria-pressed',String(key===selected?.id));
  }
  invalidate();
}

eventMapPoints.addEventListener('click',event => {
  const mark = event.target.closest('[data-place]');
  if (mark) selectEventPlace(mark.dataset.place);
});
eventMapSteps.addEventListener('click',event => {
  const button = event.target.closest('[data-scene-step]');
  if (button && session.mode==='Observe') applySceneStep(worldEvent,Number(button.dataset.sceneStep));
});
el('event-map-place-chips').addEventListener('click',event => {
  const chip = event.target.closest('[data-scene-place]');
  if (chip) selectEventPlace(chip.dataset.scenePlace);
});
for (const details of [eventMapParticipants,eventMapPlaces,eventMapSources]) details.addEventListener('toggle',invalidate);
eventMapScroll.addEventListener('scroll',invalidate,{passive:true});
