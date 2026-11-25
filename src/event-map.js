const eventMapTargets = new Map(TOPICS.flatMap((topic) => topic.chapters
  .filter((chapter) => chapter.mapStory?.worldEntryId)
  .map((chapter) => [chapter.mapStory.worldEntryId, { topic, chapter }])));
const eventMapPanel = el('event-map-panel'), eventMapPoints = el('event-map-points'), eventMapNote = el('event-map-note');
const eventMapReturn = el('event-map-return'), eventMapTitle = el('event-map-title'), eventMapRead = el('event-map-read');
const eventMapParticipants = el('event-map-participants');
const eventMapDistance = el('event-map-distance');
const eventMapSteps = el('event-map-steps');
const eventMapTop = el('event-map-top'), eventMapYear = el('event-map-year');
const scenesByEvent = new Map([...historicalScenes.values()].filter(scene => scene.topicEvent).map(scene => [scene.topicEvent, scene]));
let worldEvent = null;
let globeFlyRaf = 0;

const ROUTE_STYLES = {
  military: { color: '#d65a3e', glow: 'rgba(214,90,62,.31)', dash: [7, 4], width: 2.3 },
  trade:    { color: '#e5dac7', glow: 'rgba(229,218,199,.28)', dash: [], width: 2.3 },
  canal:    { color: '#5893c4', glow: 'rgba(88,147,196,.32)', dash: [], width: 2.5 },
  frontier: { color: '#cfa05e', glow: 'rgba(207,160,94,.28)', dash: [3, 4], width: 2.2 },
};

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
  const { readingView, readingMap, phase, place } = session.observe;
  if (!worldEvent && readingMap) {
    showEventMap(readingMap);
    if (phase >= 0) applySceneStep(worldEvent, phase, { animate: false });
    if (place) selectEventPlace(place, true);
    cancelGlobeFly();
  }
  const markers = [...(worldEvent.points?.values() || [])].map(place => place.mark);
  eventMapPoints.replaceChildren(...markers);
  eventMapPoints.hidden = !markers.length;
  projectGlobeView(readingView);
  session.updateObserve({ camera: session.camera(state) });
  eventMapRead.focus({ preventScroll: true });
}

function flyGlobeTo({ yaw, tilt, zoom, panX = 0, panY = 0, duration = 620 }) {
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
      const p = pointsMap.get(end);
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
  if (!routes?.length || !ctxObj.points) return;
  const cx = view.cx + state.panX, cy = view.cy + state.panY, Rz = view.Rz;
  const activeRouteIndices = ctxObj.activeRouteIndices;

  vctx.save();
  vctx.beginPath();
  vctx.arc(cx, cy, Rz - 0.5, 0, TAU);
  vctx.clip();
  vctx.lineJoin = 'round';
  vctx.lineCap = 'round';

  routes.forEach((route, idx) => {
    const dimmed = activeRouteIndices && !activeRouteIndices.has(idx);
    const vecs = route._vecs || (route._vecs = resolveRouteVectors(route, ctxObj.points));
    if (vecs.length < 2) return;
    const style = ROUTE_STYLES[route.kind] || ROUTE_STYLES.trade;
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
    vctx.globalAlpha = dimmed ? 0.24 : 0.96;

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

    // Soft glow
    if (!dimmed) {
      vctx.strokeStyle = style.glow;
      vctx.lineWidth = style.width + 4.5;
      vctx.stroke();
    }

    // Styled route stroke
    vctx.setLineDash(style.dash);
    vctx.strokeStyle = style.color;
    vctx.lineWidth = style.width;
    vctx.stroke();
    vctx.setLineDash([]);

    // Directional arrowheads along visible runs
    if (route.directed !== false && !dimmed) {
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
  if (!ctxObj) return null;
  const list = ctxObj.activeFocusPolities || ctxObj.focusPolities;
  return list?.length ? new Set(list) : null;
}

function buildPlaceMarkers(places, targetObj) {
  eventMapPoints.replaceChildren();
  const points = new Map(places.map((place) => {
    const mark = document.createElement('div');
    mark.className = 'event-map-point';
    mark.dataset.place = place.id;
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

function prepareWorldEventPlaces(places) {
  const points = buildPlaceMarkers(places, worldEvent);
  const vectors = [...points.values()].map((p) => p.vector);
  return cameraForVectors(vectors, Boolean(worldEvent.sceneId));
}

function drawWorldEventPlaces(points, rotationMatrix, hudBounds, activePlaceIds = null) {
  const occupied = [];
  const leftEdge = 14;
  const bottom = eventMapPanel.getBoundingClientRect().top - 8;
  const visible = [...points.values()].map((entry) => ({
    entry, p: projectReadingPlace(entry.vector, rotationMatrix),
  }));
  for (const { entry, p } of visible) {
    const { mark, leader, button } = entry;
    const dimmed = activePlaceIds && !activePlaceIds.has(entry.id);
    mark.classList.toggle('dimmed', Boolean(dimmed));
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
  if (ctxObj.routes?.length && ctxObj.points) {
    drawSceneRoutes(ctxObj, matrix);
  }
  if (ctxObj.points) {
    drawWorldEventPlaces(ctxObj.points, matrix, hudBounds, ctxObj.activePlaceIds);
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

function renderStepsBar(container, steps, activeIdx) {
  if (!steps?.length) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;
  const chips = [
    '<button type="button" class="step-chip" data-scene-step="-1" aria-pressed="' + (activeIdx === -1) + '">全景</button>',
    ...steps.map((s, i) => '<button type="button" class="step-chip" data-scene-step="' + i + '" aria-pressed="' + (activeIdx === i) + '"><span>' +
      esc(fmtYear(s.year)) + '</span> ' + esc(s.title) + '</button>'),
  ];
  container.innerHTML = chips.join('');
}

function applySceneStep(ctxObj, stepIdx, { animate = true } = {}) {
  const steps = ctxObj.steps || [];
  const step = stepIdx >= 0 && stepIdx < steps.length ? steps[stepIdx] : null;
  ctxObj.stepIdx = step ? stepIdx : -1;
  ctxObj.selected = null;

  const year = step ? step.year : ctxObj.baseYear;
  session.updateObserve({ year });
  ctxObj.activePlaceIds = step?.places?.length ? new Set(step.places) : null;
  ctxObj.activeRouteIndices = step?.routes?.length ? new Set(step.routes) : null;
  ctxObj.activeFocusPolities = step?.focusPolities?.length ? step.focusPolities : (ctxObj.focusPolities || null);

  if (state.year !== year) {
    state.year = year;
    onYearChanged();
  }
  if (ctxObj.points) {
    for (const [, place] of ctxObj.points) {
      place.mark.classList.remove('selected');
      place.button.setAttribute('aria-pressed', 'false');
    }
    const targetVectors = [...ctxObj.points.values()]
      .filter((p) => !ctxObj.activePlaceIds || ctxObj.activePlaceIds.has(p.id))
      .map((p) => p.vector);
    const cam = cameraForVectors(targetVectors.length ? targetVectors : [...ctxObj.points.values()].map((p) => p.vector), true);
    flyGlobeTo({ ...cam, duration: animate ? 560 : 0 });
  }

  eventMapYear.textContent = fmtYear(year);
  eventMapNote.textContent = step ? step.title + ' · ' + step.note : ctxObj.summary;
  renderStepsBar(eventMapSteps, steps, ctxObj.stepIdx);
  invalidate();
}

function showEventMap(spec) {
  const {year, title, summary, back, places, participants, distanceLabel, routes, steps, focusPolities, initialPlaceId = null, historical = false, ...route} = spec;
  session.updateObserve({ id: route.sceneId || String(route.event.id), year, phase: -1, place: null });
  worldEvent = {
    ...route, spec, baseYear: year, summary, points: null, regionVector: null,
    routes: routes ? routes.map((r) => ({ ...r })) : [],
    steps: steps || [],
    focusPolities: focusPolities || null,
    activeFocusPolities: focusPolities || null,
    activePlaceIds: null,
    activeRouteIndices: null,
    get stepIdx() { return session.observe?.phase ?? -1; },
    set stepIdx(phase) { session.updateObserve({ phase }); },
    get selected() { return session.observe?.place ?? null; },
    set selected(place) { session.updateObserve({ place }); },
  };
  pauseGlobe();
  cancelGlobeFly();
  closeYearControl();
  closeWorld();
  document.body.classList.add('event-map-open');
  document.body.classList.toggle('scene-observation', Boolean(route.sceneId));
  state.focus = null;
  sheetState.detent = 'hidden';
  applySheetOffset(sheetDetents().hidden, false);
  state.year = year;
  chrome.natural = !historical;
  if (historical) {
    state.layerId = 'polity';
    if (!polityState.loaded) ensurePolity();
  }
  state.lift = 0;
  eventMapTitle.textContent = title;
  const kind = routes?.[0]?.type || routes?.[0]?.kind || 'trade';
  const types = {canal:'漕运',military:'军事',frontier:'边防',trade:'贸易'};
  el('event-map-type').textContent = types[kind] || '历史现场';
  el('event-map-type').dataset.routeType = kind;
  el('event-map-navigation').hidden = !route.sceneId;
  el('event-map-place-chips').replaceChildren();
  eventMapRead.hidden = !route.readingTarget;
  eventMapReturn.querySelector('span').textContent = back;
  eventMapYear.textContent = fmtYear(year);
  eventMapTop.hidden = false;
  eventMapNote.textContent = summary;
  eventMapDistance.textContent = distanceLabel || '';
  eventMapDistance.hidden = !distanceLabel;
  renderStepsBar(eventMapSteps, worldEvent.steps, -1);
  renderEventParticipants(participants || []);
  let targetCamera;
  if (places?.length) {
    targetCamera = prepareWorldEventPlaces(places);
    if (route.sceneId) {
      el('event-map-place-chips').innerHTML = places.map(p => '<button type="button" data-scene-place="' + esc(p.id) +
        '"><strong>' + esc(p.name) + '</strong><small>' + esc(p.role) + '</small></button>').join('');
    }
  } else if (Number.isFinite(route.event?.px) && Number.isFinite(route.event?.py)) {
    const lon = (route.event.px / MAPW - .5) * 360, lat = (.5 - route.event.py / MAPH) * 180;
    worldEvent.regionVector = readingPlaceVector({ lon, lat });
    targetCamera = { yaw:-lon * Math.PI / 180, tilt:lat * Math.PI / 180, zoom:1.45 };
  }
  eventMapPanel.style.transform = '';
  eventMapPanel.hidden = false;
  if (route.sceneId) {
    const list = route.sceneOrder || [];
    const index = list.indexOf(route.sceneId);
    el('event-map-prev').disabled = index <= 0;
    el('event-map-next').disabled = index < 0 || index >= list.length - 1;
    el('event-map-counter').textContent = index < 0 ? '' : (index + 1) + ' / ' + list.length;
  }
  onYearChanged();
  layout();
  if (targetCamera) flyGlobeTo(targetCamera);
  if (initialPlaceId && worldEvent.points?.has(initialPlaceId)) {
    selectEventPlace(initialPlaceId);
  }
  session.updateObserve({ camera: session.camera(state) });
  eventMapReturn.focus({ preventScroll: true });
  saveSession(true);
}

function openWorldEvent(event) {
  if (!event || session.mode !== 'Explore') return;
  const year = worldEventYear(event);
  const target = worldEventTarget(event, year);
  const story = target?.chapter.mapStory;
  const scene = target && scenesByEvent.get(event.id);
  const region = event.regionRef || regionById.get(event.region);
  rememberExplore();
  if (!session.enterObserve({ kind: 'event', source: worldSource(String(event.id), 'map') })) return;
  showEventMap({ event, target, year,
    readingTarget: worldReadingTarget(event, year),
    title: timelineItem(event).title || event.zh,
    summary: scene?.summary || story?.summary || (region?.zh ? '相关地区 · ' + region.zh : '地点未详'),
    participants: story?.participants, places: scene?.places || (target && chapterPlaces(target.chapter)),
    routes: scene?.routes, steps: scene?.steps, focusPolities: scene?.focusPolities,
    back: '返回 ' + yearLabel(state.year) });
}

function openReadingScene(scene, trigger, { initialPlaceId = null } = {}) {
  if (!scene || !reading.active) return;
  rememberReading();
  const returnView = captureGlobeView();
  if (!session.enterObserve({ kind: 'scene', returnView,
    source: { sceneId: scene.id, triggerPlace: trigger?.dataset.pinPlace || null } })) return;
  hideReader();
  const sceneOrder = [...new Set(reading.subject?.chapters.flatMap(c => (c.sceneRefs || []).map(r => r.id)) || [])];
  showEventMap({ ...scene, sceneId: scene.id, sceneOrder, initialPlaceId,
    historical: hasHistoricalCoverage(scene.year), back: '返回正文' });
}

function returnToWorld() {
  if (session.mode !== 'Observe' || closeTopNavigationPanel()) return;
  const previous = session.returnFromObserve();
  worldEvent = null;
  pauseGlobe();
  cancelGlobeFly();
  document.body.classList.remove('event-map-open', 'scene-observation');
  eventMapPanel.style.transform = '';
  eventMapTop.hidden = eventMapPanel.hidden = eventMapPoints.hidden = eventMapSteps.hidden = true;
  el('event-map-place-chips').replaceChildren();
  el('event-map-navigation').hidden = true;
  eventMapPoints.replaceChildren();
  eventMapSteps.replaceChildren();
  if (previous.origin === 'Read') {
    projectGlobeView(previous.returnView);
    showReader();
    const { sceneId, triggerPlace } = previous.source;
    const buttons = [...bookBody.querySelectorAll(triggerPlace ? '[data-pin-scene]' : '[data-subject-scene]')];
    const button = buttons.find(node => triggerPlace
      ? node.dataset.pinScene === sceneId && node.dataset.pinPlace === triggerPlace
      : node.dataset.subjectScene === sceneId);
    (button || el('reading-title')).focus({ preventScroll: true });
  } else {
    restoreExploreView();
    restoreWorldSource(previous.source);
  }
  saveSession(true);
}

eventMapReturn.addEventListener('click', returnToWorld);
eventMapRead.addEventListener('click', () => {
  const target = worldEvent?.readingTarget;
  if (session.mode === 'Observe' && target) beginReading(null, null, target.chapter?.id, target.book,
    { entryYear:target.year, source:session.observe.source });
});

function selectEventPlace(id, forceSelect = false) {
  const ctxObj = session.mode === 'Observe' ? worldEvent : null;
  if (!ctxObj?.points) return;
  ctxObj.selected = (!forceSelect && ctxObj.selected === id) ? null : id;
  const selected = ctxObj.points.get(ctxObj.selected);
  eventMapNote.textContent = selected ? selected.name + ' · ' + selected.role : ctxObj.summary;
  for (const chip of el('event-map-place-chips').querySelectorAll('[data-scene-place]'))
    chip.setAttribute('aria-pressed', String(chip.dataset.scenePlace === ctxObj.selected));
  if (selected) {
    const cam = cameraForVectors([selected.vector], true);
    flyGlobeTo({...cam, zoom:Math.min(4,Math.max(2.2,cam.zoom)),duration:460});
  }
  for (const [key, place] of ctxObj.points) {
    place.mark.classList.toggle('selected', key === ctxObj.selected);
    place.button.setAttribute('aria-pressed', String(key === ctxObj.selected));
  }
  invalidate();
}

eventMapPoints.addEventListener('click', (event) => {
  const mark = event.target.closest('[data-place]');
  if (mark) selectEventPlace(mark.dataset.place);
});
eventMapSteps.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-scene-step]');
  if (btn && session.mode === 'Observe') applySceneStep(worldEvent, Number(btn.dataset.sceneStep));
});
eventMapParticipants.addEventListener('toggle', invalidate);

/* v7 · Archival place legends and adjacent book scenes. */
el('event-map-place-chips').addEventListener('click', event => {
  const chip = event.target.closest('[data-scene-place]');
  if (chip && worldEvent) selectEventPlace(chip.dataset.scenePlace, true);
});
function navigateReadingScene(delta) {
  if (session.mode !== 'Observe' || !worldEvent?.sceneId || !worldEvent.sceneOrder) return;
  const order = worldEvent.sceneOrder;
  const id = order[order.indexOf(worldEvent.sceneId) + delta];
  const scene = historicalScenes.get(id);
  if (!scene) return;
  showEventMap({...scene, sceneId:scene.id, sceneOrder:order,
    historical:hasHistoricalCoverage(scene.year), back:'返回正文'});
}
el('event-map-prev').addEventListener('click', () => navigateReadingScene(-1));
el('event-map-next').addEventListener('click', () => navigateReadingScene(1));


/* v8 · Dedicated scene caption card swipe (buttons and long text remain selectable). */
let captionSwipe = null;
eventMapPanel.addEventListener('touchstart', event => {
  if (session.mode !== 'Observe' || !worldEvent?.sceneId || event.touches.length !== 1 ||
      event.target.closest('button, a, summary, details, #event-map-steps, #event-map-place-chips') ||
      (event.target.closest('#event-map-note') &&
        ['auto', 'scroll'].includes(getComputedStyle(eventMapNote).overflowY) &&
        eventMapNote.scrollHeight > eventMapNote.clientHeight + 2)) { captionSwipe = null; return; }
  const t = event.touches[0];
  captionSwipe = {id:t.identifier,y:t.clientY,x:t.clientX,lastY:t.clientY,lastT:event.timeStamp,vy:0,active:false};
}, {passive:true});
eventMapPanel.addEventListener('touchmove', event => {
  const g = captionSwipe;
  if (!g || event.touches.length !== 1 || event.touches[0].identifier !== g.id) return;
  const t = event.touches[0];
  const dy = t.clientY-g.y, dx=t.clientX-g.x;
  if (!g.active) {
    if (Math.abs(dy)<13) return;
    if (Math.abs(dx)>Math.abs(dy)*.8) {captionSwipe=null;return;}
    g.active=true;
  }
  if (event.cancelable) event.preventDefault();
  const dt = Math.max(1,event.timeStamp-g.lastT);
  g.vy=.6*((t.clientY-g.lastY)/dt)+.4*g.vy;
  g.lastY=t.clientY;g.lastT=event.timeStamp;
  eventMapPanel.style.transform='translate3d(0,'+Math.min(55,Math.max(-24,dy*.32))+'px,0)';
}, {passive:false});
for (const kind of ['touchend','touchcancel']) eventMapPanel.addEventListener(kind,event=>{
  const g=captionSwipe;
  if (!g || !Array.from(event.changedTouches).some(t=>t.identifier===g.id)) return;
  captionSwipe=null;
  eventMapPanel.style.transform='';
  if (!g.active || kind!=='touchend') return;
  const dy=g.lastY-g.y;
  const up=dy < -55 || g.vy < -.42;
  const down=dy > 70 || g.vy > .42;
  if (!up && !down) return;
  returnToWorld();
});
