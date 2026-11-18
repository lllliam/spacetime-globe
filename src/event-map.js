const eventMapTargets = new Map(TOPICS.flatMap((topic) => topic.chapters
  .filter((chapter) => chapter.mapStory?.worldEntryId)
  .map((chapter) => [chapter.mapStory.worldEntryId, { topic, chapter }])));
const eventMapPanel = el('event-map-panel'), eventMapPoints = el('event-map-points'), eventMapNote = el('event-map-note');
const eventMapReturn = el('event-map-return'), eventMapTitle = el('event-map-title'), eventMapRead = el('event-map-read');
const eventMapParticipants = el('event-map-participants');
const eventMapDistance = el('event-map-distance');
const eventMapTop = el('event-map-top'), eventMapYear = el('event-map-year');
const scenesByEvent = new Map([...historicalScenes.values()].filter(scene => scene.topicEvent).map(scene => [scene.topicEvent, scene]));
let worldEvent = null;

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
  };
}
function chapterPlaces(chapter) {
  const story = chapter.mapStory;
  const [name, role] = chapter.place.label.split(' · ', 2);
  return [{ ...chapter.place, id: 'main', name, role }, ...story.places];
}

function prepareWorldEventPlaces(places) {
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
  worldEvent.points = points;
  eventMapPoints.hidden = false;

  const vectors = [...points.values()].map((p) => p.vector);
  const center = vectors.reduce((sum, vector) => sum.map((value, i) => value + vector[i]), [0, 0, 0]);
  const centerLength = Math.hypot(...center);
  const direction = centerLength > .01 ? center.map((v) => v / centerLength) : vectors[0];
  const maxAngle = Math.max(...vectors.map((v) => Math.acos(clamp(v.reduce((dot, n, i) => dot + n * direction[i], 0), -1, 1))));
  state.yaw = -Math.atan2(direction[0], direction[2]);
  state.tilt = Math.asin(clamp(direction[1], -1, 1));
  state.zoom = worldEvent.sceneId
    ? clamp(.45 / Math.max(maxAngle, .02), 1, 5)
    : clamp(.5 / Math.max(maxAngle, .02), 1, 6);
}
function drawWorldEventPlaces(points, rotationMatrix, hudBounds) {
  const occupied = [];
  const bottom = eventMapPanel.getBoundingClientRect().top - 8;
  const visible = [...points.values()].map((entry) => ({
    entry, p: projectReadingPlace(entry.vector, rotationMatrix),
  }));
  for (const { entry, p } of visible) {
    const { mark, leader, button } = entry;
    mark.hidden = !p.front || p.x < 14 || p.x > view.w - 14 || p.y < view.safeTop + 12 || p.y > bottom ||
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
      return x > 4 && x + w < view.w - 4 && y > view.safeTop + 6 && y + h < bottom &&
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
  if (!worldEvent || reading.active) return;
  const matrix = rotation();
  if (worldEvent.points) {
    drawWorldEventPlaces(worldEvent.points, matrix, hudBounds);
    return;
  }
  if (!worldEvent.regionVector) return;
  const point = projectReadingPlace(worldEvent.regionVector, matrix);
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

function showEventMap({year, title, summary, back, places, participants, distanceLabel, historical = false, ...route}) {
  worldEvent = {
    ...route, summary, selected: null, points: null, regionVector: null,
    camera: {
      year: state.year, layerId: state.layerId, focus: state.focus, yaw: state.yaw, tilt: state.tilt,
      zoom: state.zoom, panX: state.panX, panY: state.panY, lift: state.lift,
    },
    natural: chrome.natural,
  };
  pauseGlobe();
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
  state.panX = state.panY = state.lift = 0;
  eventMapTitle.textContent = title;
  eventMapRead.hidden = !route.readingTarget;
  eventMapReturn.querySelector('span').textContent = back;
  eventMapYear.textContent = fmtYear(year);
  eventMapTop.hidden = false;
  eventMapNote.textContent = summary;
  eventMapDistance.textContent = distanceLabel || '';
  eventMapDistance.hidden = !distanceLabel;
  renderEventParticipants(participants || []);
  if (places?.length) {
    prepareWorldEventPlaces(places);
  } else if (Number.isFinite(route.event?.px) && Number.isFinite(route.event?.py)) {
    const lon = (route.event.px / MAPW - .5) * 360, lat = (.5 - route.event.py / MAPH) * 180;
    worldEvent.regionVector = readingPlaceVector({ lon, lat });
    state.yaw = -lon * Math.PI / 180;
    state.tilt = lat * Math.PI / 180;
    state.zoom = 1.45;
  }
  eventMapPanel.hidden = false;
  onYearChanged();
  layout();
  eventMapReturn.focus({ preventScroll: true });
}

function openWorldEvent(event, row) {
  if (!event || worldEvent || reading.active) return;
  const year = clamp(state.year, event.start, event.point ? event.start : event.end);
  const target = worldEventTarget(event, year);
  const story = target?.chapter.mapStory;
  const scene = target && scenesByEvent.get(event.id);
  const region = event.regionRef || regionById.get(event.region);
  showEventMap({ event, target, row, scroll: overlayBody.scrollTop, year,
    readingTarget: worldReadingTarget(event, year),
    title: timelineItem(event).title || event.zh,
    summary: scene?.summary || story?.summary || (region?.zh ? '相关地区 · ' + region.zh : '地点未详'),
    participants: story?.participants, places: scene?.places || (target && chapterPlaces(target.chapter)),
    back: state.year >= YMAX ? '返回近 ' + TODAY_SPAN + ' 年' : '返回 ' + fmtYear(state.year) + ' 年' });
}

function openReadingScene(scene, trigger) {
  if (!scene || worldEvent || !reading.active) return;
  rememberReading();
  const session = { ...readingFrame(), snapshot: reading.snapshot, trigger: reading.trigger, trail: reading.trail, returnTo: reading.returnTo };
  const width = bookBody.clientWidth;
  const paragraph = trigger.previousElementSibling?.matches('p') ? trigger.previousElementSibling : trigger;
  const offsetInReader = node => node.getBoundingClientRect().top - bookBody.getBoundingClientRect().top;
  const paragraphOffset = offsetInReader(paragraph);
  closeReader({restore: false});
  showEventMap({ ...scene, sceneId: scene.id, historical: scene.year >= -3400 && scene.year <= POLITY_END, back: '返回正文',
    resume() {
      Object.assign(reading, session, {active:true});
      showReader(sheetDetents().hidden);
      const button = [...bookBody.querySelectorAll('[data-subject-scene]')].find(node => node.dataset.subjectScene === scene.id);
      if (button) {
        const anchor = paragraph === trigger ? button : button.previousElementSibling;
        if (bookBody.clientWidth === width || !anchor) bookBody.scrollTop = session.detailScroll;
        else bookBody.scrollTop += offsetInReader(anchor) - paragraphOffset;
        button.focus({preventScroll:true});
      }
    },
  });
}

function returnToWorld() {
  if (!worldEvent || reading.active) return;
  const { camera, natural, row, scroll, resume } = worldEvent;
  worldEvent = null;
  pauseGlobe();
  document.body.classList.remove('event-map-open', 'scene-observation');
  eventMapTop.hidden = eventMapPanel.hidden = eventMapPoints.hidden = true;
  eventMapPoints.replaceChildren();
  Object.assign(state, camera);
  chrome.natural = natural;
  onYearChanged();
  layout();
  if (resume) { resume(); return; }
  restoreWorld(row, scroll);
}

eventMapReturn.addEventListener('click', returnToWorld);
eventMapRead.addEventListener('click', () => {
  const target = worldEvent?.readingTarget;
  if (target) beginReading(null, null, target.chapter.id, sheetDetents().hidden, target.book, { entryYear:target.year });
});
function selectEventPlace(id) {
  if (!worldEvent?.points) return;
  worldEvent.selected = worldEvent.selected === id ? null : id;
  const selected = worldEvent.points.get(worldEvent.selected);
  eventMapNote.textContent = selected ? selected.name + ' · ' + selected.role : worldEvent.summary;
  for (const [key, place] of worldEvent.points) {
    place.mark.classList.toggle('selected', key === worldEvent.selected);
    place.button.setAttribute('aria-pressed', String(key === worldEvent.selected));
  }
  invalidate();
}
eventMapPoints.addEventListener('click', (event) => {
  const mark = event.target.closest('[data-place]');
  if (mark) selectEventPlace(mark.dataset.place);
});
eventMapParticipants.addEventListener('toggle', invalidate);
