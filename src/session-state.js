/* Product navigation and the serializable session. The renderer owns live camera motion. */
const SESSION_KEY = 'globe.session.v1';
const SESSION_SCHEMA = 1;
const MAX_READING_TRAIL = 24;
const MAX_READING_PROGRESS = 120;

function createSession({ minYear, maxYear }) {
  const validYear = year => Number.isInteger(year) && year !== 0 && year >= minYear && year <= maxYear;
  const number = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : null;
  const camera = value => ({
    yaw: Number.isFinite(value?.yaw) ? value.yaw % (2 * Math.PI) : -1.42,
    tilt: number(value?.tilt, -.62, 1.02, .30), zoom: number(value?.zoom, 1, 6, 1),
    panX: number(value?.panX, -1e5, 1e5, 0), panY: number(value?.panY, -1e5, 1e5, 0),
  });
  function position(value) {
    const blockId = id(value?.blockId);
    return { top: number(value?.top, 0, 1e7, 0), block: id(value?.block), ...(blockId && {blockId}),
      index: Number.isInteger(value?.index) ? number(value.index, 0, 10000, 0) : 0,
      offset: number(value?.offset, -2, 2, 0) };
  }
  const disclosures = value => Array.isArray(value)
    ? value.filter(index => Number.isInteger(index) && index >= 0 && index < 128).slice(0, 24) : [];
  const entity = value => {
    if (value?.layerId === 'country' && typeof value.key === 'string' && /^[A-Z]{2,3}$/.test(value.key)) {
      return { layerId: 'country', key: value.key };
    }
    if (value?.layerId === 'polity' && Number.isSafeInteger(value.key) && value.key >= 0 && id(value.name)) {
      return { layerId: 'polity', key: value.key, name: value.name };
    }
    return null;
  };
  const source = value => {
    if (value?.kind === 'events' && validYear(value.year)) return {
      kind: 'events', year: value.year, eventId: id(value.eventId),
      action: ['read','topic'].includes(value.action) ? value.action : 'map', scroll: number(value.scroll, 0, 1e7, 0),
      disclosures: Array.isArray(value.disclosures) ? value.disclosures.slice(0, 8).map(open => open === true) : [],
    };
    return { kind: value?.kind === 'summary' ? 'summary' : 'map' };
  };
  const frame = value => ({
    bookId: id(value?.bookId), topicId: id(value?.topicId), entity: entity(value?.entity), detail: id(value?.detail),
    year: validYear(value?.year) ? value.year : maxYear,
    scroll: number(value?.scroll, 0, 1e7, 0),
    position: position(value?.position), disclosures: disclosures(value?.disclosures),
    linkEntry: value?.linkEntry === true, directory: value?.directory === true,
    ...(id(value?.returnFocus) && {returnFocus:id(value.returnFocus)}),
    catalog: value?.catalog === true, library: value?.library === true,
    catalogContinent: id(value?.catalogContinent) || '全部', catalogScroll: number(value?.catalogScroll, 0, 1e7, 0),
  });
  const readState = value => ({
    ...frame(value), source: source(value?.source),
    trail: Array.isArray(value?.trail) ? value.trail.slice(-MAX_READING_TRAIL).map(frame) : [],
  });
  const exploreState = value => {
    const layerId = value?.layerId === 'polity' ? 'polity' : 'country';
    const selection = entity(value?.selection);
    const point = value?.selection?.point;
    if (selection && point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 500) selection.point = { x: point.x, y: point.y };
    return {
      year: validYear(value?.year) ? value.year : maxYear, layerId, camera: camera(value?.camera),
      radius: number(value?.radius, 1, 1e5, null),
      natural: value?.natural === true, followTime: value?.followTime !== false,
      labels: value?.labels !== false, grid: value?.grid === true,
      selection: selection?.layerId === layerId ? selection : null,
      summary: { detent: ['peek', 'half', 'full', 'custom'].includes(value?.summary?.detent) ? value.summary.detent : 'peek',
        offset: number(value?.summary?.offset, 0, 1e5, 0), scroll: number(value?.summary?.scroll, 0, 1e7, 0) },
    };
  };

  let mode = 'Explore', explore = exploreState(), observe = null, lastRead = null;
  const read = readState();
  const progress = new Map();
  function restoreSavedReading(value) {
    if (value?.schemaVersion !== SESSION_SCHEMA) return;
    lastRead = value.read && typeof value.read === 'object' ? readState(value.read) : null;
    progress.clear();
    if (Array.isArray(value.progress)) for (const entry of value.progress.slice(-MAX_READING_PROGRESS)) {
      if (!Array.isArray(entry) || !id(entry[0]) || !entry[1]) continue;
      const [key, item] = entry;
      progress.set(key, { chapter: id(item.chapter), position: position(item.position), scroll: number(item.scroll, 0, 1e7, 0),
        disclosures: disclosures(item.disclosures) });
    }
  }
  return {
    get mode() { return mode; }, get explore() { return explore; }, get observe() { return observe; },
    read, validYear, camera, position, frame, source, restoreSavedReading,
    updateExplore(value) { if (mode === 'Explore') explore = exploreState(value); },
    enterRead(value) {
      if (mode === 'Read' || mode === 'Observe' && observe.origin !== 'Explore') return false;
      delete read.returnFocus;
      Object.assign(read, readState(value));
      mode = 'Read';
      return true;
    },
    navigateReading(value, returnFocus) {
      if (mode !== 'Read') return false;
      const next = frame({ ...read, ...value, returnFocus:null });
      if (next.bookId === read.bookId && next.topicId === read.topicId && next.detail === read.detail &&
          next.catalog === read.catalog && next.library === read.library && next.directory === read.directory &&
          next.entity?.layerId === read.entity?.layerId && next.entity?.key === read.entity?.key) return false;
      read.trail.push(frame({...read,returnFocus}));
      if (read.trail.length > MAX_READING_TRAIL) read.trail.shift();
      delete read.returnFocus;
      Object.assign(read, next);
      return true;
    },
    backReading() {
      if (mode !== 'Read' || !read.trail.length) return false;
      delete read.returnFocus;
      Object.assign(read, read.trail.pop());
      return true;
    },
    exitRead() {
      if (mode !== 'Read') return false;
      lastRead = readState(read);
      mode = observe ? 'Observe' : 'Explore';
      return true;
    },
    enterObserve(value) {
      if (observe && (mode !== 'Read' || observe.origin !== 'Explore')) return false;
      observe = { ...value, origin: mode, phase: -1, place: null, previous: observe };
      mode = 'Observe';
      return true;
    },
    updateObserve(value) { if (mode === 'Observe') Object.assign(observe, value); },
    returnFromObserve() {
      if (mode !== 'Observe') return null;
      const previous = observe;
      observe = previous.previous;
      mode = previous.origin;
      return previous;
    },
    readingProgress(key) { return progress.get(key); },
    updateReadingPosition(key, chapter, value, scroll = 0, opened = []) {
      if (mode !== 'Read' || !id(key)) return;
      progress.delete(key);
      progress.set(key, { chapter: id(chapter), position: position(value), scroll: number(scroll, 0, 1e7, 0),
        disclosures: disclosures(opened) });
      if (progress.size > MAX_READING_PROGRESS) progress.delete(progress.keys().next().value);
    },
    serialize() {
      const resumeRead = mode === 'Read' || mode === 'Observe' && observe.origin === 'Read';
      const eventList = mode==='Observe' && observe.origin==='Explore' && observe.source?.kind==='events' ? source(observe.source) : null;
      return { schemaVersion: SESSION_SCHEMA, mode: resumeRead ? 'Read' : 'Explore', explore,
        read: resumeRead ? readState(read) : lastRead, progress: [...progress], ...(eventList && {eventList}) };
    },
    restore(value) {
      if (value?.schemaVersion !== SESSION_SCHEMA) return null;
      if (value.explore && typeof value.explore === 'object') explore = exploreState({ ...explore, ...value.explore });
      restoreSavedReading(value);
      const eventList = source(value.eventList);
      return { explore, read: value.mode === 'Read' ? lastRead : null,
        ...(value.mode==='Explore' && eventList.kind==='events' && eventList.year===explore.year && {eventList}) };
    },
  };
}

const session = createSession({ minYear: YMIN, maxYear: YMAX });
let sessionReady = false, sessionWriteTimer = 0;
let storedSessionSnapshot = null, sessionBeforeAction = null;

// A deliberate interaction can resume saving from this page using the latest
// shared reading progress. Closing a page and reflowing its layout cannot.
function claimSession() {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored === storedSessionSnapshot) return;
    try { session.restoreSavedReading(JSON.parse(stored)); } catch {}
    storedSessionSnapshot = stored;
    sessionBeforeAction = JSON.stringify(session.serialize());
  } catch {}
}

function saveSession(immediate = false) {
  if (!sessionReady) return;
  clearTimeout(sessionWriteTimer);
  if (!immediate) {
    sessionWriteTimer = setTimeout(() => saveSession(true), 220);
    return;
  }
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored !== storedSessionSnapshot) return;
    const json = JSON.stringify(session.serialize());
    if (json === stored || json === sessionBeforeAction) return;
    localStorage.setItem(SESSION_KEY, json);
    storedSessionSnapshot = json;
    sessionBeforeAction = null;
  } catch {}
}

let exploreRevision = 0, pendingSessionSelection = null, pendingReadRestore = false;

function exploreIntent() {
  if (session.mode !== 'Explore') return;
  exploreRevision++;
  pendingSessionSelection = null;
  if (pendingReadRestore) {
    pendingReadRestore = false;
    sessionReady = true;
  }
}

function rememberExplore() {
  if (session.mode !== 'Explore') return;
  const focus = state.focus;
  const selection = focus && { layerId: focus.layerId, key: focus.key, point: focus.point,
    name: focus.layerId === 'polity' ? entityByKey(focus.layerId, focus.key)?.name : null };
  const pending = pendingSessionSelection;
  session.updateExplore({ year: state.year, layerId: state.layerId, camera: state, radius: view.R,
    natural: chrome.natural, followTime: chrome.followTime, labels: chrome.labels, grid: chrome.grid,
    selection: selection || pending?.selection,
    summary: pending?.summary || { detent: sheetState.detent, offset: sheetState.offset, scroll: sheetScroll.scrollTop } });
}

function cameraSettled() {
  if (!sessionReady) return;
  if (session.mode === 'Explore') { rememberExplore(); saveSession(); }
  else if (session.mode === 'Observe') session.updateObserve({ camera: session.camera(state) });
}

function restoreExploreView() {
  const context = session.explore;
  const revision = ++exploreRevision;
  pendingSessionSelection = context.selection ? context : null;
  state.focus = null;
  state.lift = 0;
  state.year = context.year;
  chrome.natural = context.natural;
  chrome.followTime = context.followTime;
  state.layerId = explorationLayer(context.year, context.followTime, context.natural);
  chrome.labels = context.labels;
  chrome.grid = context.grid;
  Object.assign(state, context.camera);
  const scale = context.radius ? view.R / context.radius : 1;
  state.panX *= scale;
  state.panY *= scale;
  sheetState.detent = 'hidden';
  sheetState.closingAnchor = null;
  applySheetOffset(sheetDetents().hidden, false);
  layout();
  onYearChanged();

  function restoreSelection() {
    if (session.mode !== 'Explore' || revision !== exploreRevision) return;
    pendingSessionSelection = null;
    const { selection, summary } = context;
    if (selection) {
      const shape = partition.shapes.find(candidate => focusKeyOf(selection.layerId, candidate) === selection.key &&
        (selection.layerId === 'country' || candidate.ent?.name === selection.name));
      if (shape) {
        selectEntity(selection.layerId, shape.id, selection.point);
        sheetState.detent = summary.detent;
        applySheetOffset(summaryOffset(summary), false);
        sheetScroll.scrollTop = summary.scroll;
      }
    }
    syncSheetIdentity();
    syncHud();
    invalidate();
    if (sessionReady) { rememberExplore(); saveSession(); }
  }
  if (state.layerId === 'polity' && hasHistoricalCoverage(state.year) && !polityState.loaded) ensurePolity().then(restoreSelection);
  else restoreSelection();
}

function summaryOffset(summary) {
  const detents = sheetDetents();
  return summary.detent === 'custom' ? clamp(summary.offset, 0, detents.peek) : detents[summary.detent];
}

function restoreSession() {
  rememberExplore();
  let restored;
  try {
    storedSessionSnapshot = localStorage.getItem(SESSION_KEY);
    restored = session.restore(JSON.parse(storedSessionSnapshot));
  } catch {}
  if (restored) {
    restoreExploreView();
    if (restored.read) {
      const revision = exploreRevision;
      const needsPolity = frame => !frame.catalog && !frame.library && !frame.bookId && !frame.topicId && frame.entity?.layerId === 'polity';
      if (!polityState.loaded && [restored.read, ...restored.read.trail].some(needsPolity)) {
        pendingReadRestore = true;
        ensurePolity().then(() => {
          pendingReadRestore = false;
          if (session.mode === 'Explore' && revision === exploreRevision) resumeStoredReading(restored.read);
          sessionReady = true;
          saveSession(true);
        });
        return true;
      }
      resumeStoredReading(restored.read);
    } else if (restored.eventList) restoreWorldSource(restored.eventList);
  }
  sessionReady = true;
  if (restored?.read && session.mode === 'Read') saveSession();
  return Boolean(restored);
}

function saveVisibleSession() {
  if (!sessionReady) return;
  if (session.mode === 'Explore') rememberExplore();
  if (session.mode === 'Read') rememberReading();
  saveSession(true);
}

document.addEventListener('visibilitychange', () => { if (document.hidden) saveVisibleSession(); });
addEventListener('pagehide', saveVisibleSession);
