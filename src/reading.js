/* 阅读模块由 build.mjs 插入 app.js 的同一作用域。阅读位置独立于地球年份。 */
const TOPICS = JSON.parse(inlineText('topics') || '[]');
const timelineNotes = JSON.parse(inlineText('timeline-notes') || '{}');
const bookEl = el('book'), bookBar = el('book-bar'), bookBody = el('book-body');
const readingBack = el('reading-back'), readingGrab = el('reading-grab'), readingResume = el('reading-resume');
const reading = { active: false, preview: false, topic: null, ent: null, detail: null, year: 0, scroll: 0, detailScroll: 0, snapshot: null, trigger: null };
const readingPositions = new Map();
const readingArrow = '<svg class="reading-arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const reducedReadingMotion = matchMedia('(prefers-reduced-motion: reduce)');
let readerMotion = null, readerDrag = null, readerLastDrag = -Infinity;

function topicsForEntity(ent, year = state.year) {
  return TOPICS.filter((t) => year >= t.from && year <= t.to &&
    (ent.kind === 'country' ? t.countryIsos.includes(ent.iso) : t.polityNames.includes(ent.name)))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.to - a.from) - (b.to - b.from));
}
function topicForEntity(ent, year = state.year) {
  return topicsForEntity(ent, year)[0] || null;
}
function pauseGlobe() {
  stopSheetMotion();
  sheetVelocity = 0;
  momentum.yaw = momentum.tilt = 0;
  cancelZoom();
  stopPanReturn();
  cancelAnimationFrame(liftRaf);
  cancelAnimationFrame(rafId);
  rafId = 0;
}
function readingKey() {
  if (reading.topic) return reading.ent ? reading.topic.id : 'home:' + reading.topic.id;
  return reading.ent.layerId + ':' + reading.ent.key + ':' + chapterOf(reading.year).n;
}
function rememberReading() {
  if (reading.catalog) { reading.catalogScroll = bookBody.scrollTop; return; }
  if (!reading.ent && !reading.topic) return;
  if (reading.detail) reading.detailScroll = bookBody.scrollTop;
  else reading.scroll = bookBody.scrollTop;
  readingPositions.set(readingKey(), { scroll: reading.scroll, detail: reading.detail, detailScroll: reading.detailScroll });
}
function readingBackground(inert) {
  for (const id of ['globe', 'hud', 'dock', 'toolbar', 'sheet', 'sheet-dim', 'overlay', 'reading-resume']) el(id).inert = inert;
  document.body.classList.toggle('reading-open', inert);
}
function openBook(topicId, fromOffset = null) {
  if (reading.active) return;
  const ent = state.focus && entityByKey(state.focus.layerId, state.focus.key, state.focus.id);
  if (!ent) return;
  const topic = typeof topicId === 'string' ? TOPICS.find((t) => t.id === topicId) || null : topicForEntity(ent);
  beginReading(ent, topic, null, fromOffset ?? sheetState.offset);
}
function beginReading(ent, topic, chapter, fromOffset) {
  pauseGlobe();
  reading.snapshot = {
    year: state.year, layerId: state.layerId, focus: state.focus && { ...state.focus },
    yaw: state.yaw, tilt: state.tilt, zoom: state.zoom, panX: state.panX, panY: state.panY, lift: state.lift,
    natural: chrome.natural, detent: sheetState.detent, offset: sheetState.offset, scroll: sheetScroll.scrollTop,
  };
  reading.ent = ent && { ...ent };
  reading.trail = [];
  reading.linkEntry = false;
  reading.catalog = !ent && !topic;
  reading.catalogContinent = '全部';
  reading.catalogScroll = 0;
  reading.topic = topic;
  reading.year = state.year;
  reading.trigger = document.activeElement;
  const saved = reading.catalog ? null : readingPositions.get(readingKey());
  reading.detail = chapter || (saved ? saved.detail : null);
  reading.scroll = saved ? saved.scroll : 0;
  reading.detailScroll = saved && saved.detail === reading.detail ? saved.detailScroll : 0;
  reading.active = true;
  reading.preview = false;
  showReader(fromOffset);
  // 正文到达后只更新通用资料页；专题内容无需网络。
  if (ent) loadStories().then(() => {
    if (reading.active && !reading.preview && !reading.catalog && !reading.topic && reading.detail !== null) {
      rememberReading();
      renderReading();
    }
  });
}
function showReader(fromOffset = 18) {
  hideTimeline(false);
  closeView(false);
  reading.preview = false;
  readingResume.hidden = true;
  bookEl.hidden = false;
  readerLastDrag = -Infinity;
  readingBackground(true);
  renderReading();
  const offset = clamp(fromOffset, 0, innerHeight);
  animateReader(offset, 0, clamp(offset * .7, 180, 360));
  readingGrab.focus({ preventScroll: true });
}
function readerRestOffset() {
  const { detent, offset } = reading.snapshot;
  const detents = sheetDetents();
  return detent === 'custom' ? clamp(offset, 0, detents.peek) : detents[detent];
}
function readerFrame(offset) {
  const radius = clamp(offset / 112, 0, 1) * 22;
  return { transform: 'translateY(' + offset + 'px)', borderRadius: radius + 'px ' + radius + 'px 0 0' };
}
function animateReader(from, to, duration, onFinish) {
  readerMotion?.cancel();
  readerMotion = null;
  if (reducedReadingMotion.matches || Math.abs(to - from) < 1) {
    Object.assign(bookEl.style, readerFrame(to));
    onFinish?.();
    return;
  }
  const motion = bookEl.animate([readerFrame(from), readerFrame(to)], {
    duration, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'forwards',
  });
  readerMotion = motion;
  motion.finished.then(() => {
    if (readerMotion !== motion) return;
    Object.assign(bookEl.style, readerFrame(to));
    readerMotion = null;
    motion.cancel();
    onFinish?.();
  }, () => {});
}
function collapseReader() {
  if (!reading.active || reading.preview) return;
  const from = Math.max(0, bookEl.getBoundingClientRect().top);
  const to = readerRestOffset();
  animateReader(from, to, clamp(Math.abs(to - from) * .65, 160, 300), closeReader);
}
function readerDragStart(e) {
  if (readerDrag || e.isPrimary === false || e.button !== 0 || e.target.closest('#reading-back')) return;
  readerDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, offset: bookEl.getBoundingClientRect().top,
    moved: false, dy: 0, samples: [{ y: e.clientY, t: e.timeStamp }] };
}
function readerDragMove(e) {
  const drag = readerDrag;
  if (!drag || e.pointerId !== drag.id) return;
  drag.dy = e.clientY - drag.y;
  if (!drag.moved) {
    const dx = Math.abs(e.clientX - drag.x);
    if (dx > 8 && dx > Math.abs(drag.dy)) { readerDrag = null; return; }
    if (Math.abs(drag.dy) < 6) return;
    drag.moved = true;
    drag.offset = bookEl.getBoundingClientRect().top;
    readerMotion?.cancel();
    readerMotion = null;
    // 触屏已由按下的控件隐式捕获；转移捕获会把丢失捕获事件冒泡到这里。
    if (e.pointerType === 'mouse') bookBar.setPointerCapture(e.pointerId);
  }
  const max = readerRestOffset();
  const offset = drag.offset + drag.dy;
  const eased = offset > max ? max + 24 * (1 - Math.exp((max - offset) / 48)) : Math.max(0, offset);
  Object.assign(bookEl.style, readerFrame(eased));
  bookBar.classList.toggle('collapse-ready', eased >= clamp(max * .32, 80, 132));
  drag.samples.push({ y: e.clientY, t: e.timeStamp });
  drag.samples = drag.samples.filter((sample) => e.timeStamp - sample.t < 110);
}
function readerDragEnd(e) {
  const drag = readerDrag;
  if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
  readerDrag = null;
  bookBar.classList.remove('collapse-ready');
  if (!drag.moved) return;
  readerLastDrag = e.timeStamp;
  const last = drag.samples.at(-1), first = drag.samples[0];
  const velocity = e.timeStamp - last.t < 110 && last.t > first.t ? (last.y - first.y) / (last.t - first.t) * 1000 : 0;
  const offset = bookEl.getBoundingClientRect().top;
  const threshold = clamp(readerRestOffset() * .32, 80, 132);
  if (e.type === 'pointerup' && drag.dy > 0 && (offset >= threshold || (drag.dy > 24 && velocity > 620))) collapseReader();
  else animateReader(offset, 0, 220);
}
function readingItems() {
  if (reading.topic) return reading.topic.chapters;
  const period = chapterOf(reading.year);
  return entriesForBook(reading.ent)
    .map(timelineItem)
    .filter((e) => e.start <= period.b && (e.point ? e.start : e.end) >= period.a)
    .sort((a, b) => a.start - b.start || a.t0 - b.t0);
}
function timelineItem(entry) {
  const note = timelineNotes[entry.id];
  return note ? { ...entry, ...note } : entry;
}
function readingDate(item) {
  if (item.date) return item.date;
  return item.point || item.start === item.end ? fmtYear(item.start) : fmtYear(item.start) + '–' + fmtYear(item.end);
}
function readingRow(item, { current = false } = {}) {
  return '<li><button type="button" class="reading-card reading-row"' + (current ? ' aria-current="date"' : '') +
    ' data-reading-detail="' + esc(item.id) + '"><small>' + esc(readingDate(item)) + '</small>' +
    '<span class="reading-row-copy"><strong>' + esc(item.title || item.zh || item.en) + '</strong>' +
    (item.summary ? '<span>' + esc(item.summary) + '</span>' : '') + '</span>' + readingArrow + '</button></li>';
}
function readingRows(rows, label) {
  return '<ol class="reading-list" aria-label="' + esc(label) + '">' + rows.join('') + '</ol>';
}
function catalogNavigation() {
  return '<nav class="reading-next"><button type="button" data-reading-catalog>全球专题目录' + readingArrow + '</button></nav>';
}
function sourcesMarkup(sources) {
  if (!sources.length) return '';
  return '<section class="reading-sources"><h2>来源</h2>' +
    sources.map((s, i) => '<a id="reading-source-' + i + '" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">[' + (i + 1) + '] ' + esc(s.title) + (s.note ? ' · ' + esc(s.note) : '') + ' ↗</a>').join('') + '</section>';
}
function referencesMarkup(refs) {
  return refs && refs.length ? '<span class="reading-refs">' + refs.map((i) => '<a href="#reading-source-' + i + '" aria-label="查看来源 ' + (i + 1) + '">[' + (i + 1) + ']</a>').join(' ') + '</span>' : '';
}
function connectionsMarkup(topic, item) {
  if (!topic) {
    const link = item.related;
    const target = link && TOPICS.find((t) => t.id === link.topicId);
    if (!target) return '';
    const chapter = target.chapters.find((c) => c.id === link.chapterId);
    return '<section class="reading-connections"><h2>延伸阅读</h2><button type="button" class="reading-card reading-link" data-reading-topic="' +
      esc(target.id) + '" data-reading-chapter="' + esc(chapter?.id || '') + '"><small>' + esc(target.subtitle) +
      '</small><strong>' + esc(chapter?.title || target.title) + '</strong>' + readingArrow + '</button></section>';
  }
  const links = item ? (item.connections || []) : (topic.connections || []);
  const related = item || !reading.ent ? [] : topicsForEntity(reading.ent, reading.year).filter((t) => t.id !== topic.id).map((t) => ({topicId:t.id,label:t.title,reason:'同一时期的相关区域专题',relation:'context'}));
  const valid = [...links, ...related].filter((l) => TOPICS.some((t) => t.id === l.topicId));
  if (!valid.length) return '';
  return '<section class="reading-connections"><h2>延伸阅读</h2>' + valid.map((l) => '<button type="button" class="reading-card reading-link" data-reading-topic="' + esc(l.topicId) + '" data-reading-chapter="' + esc(l.chapterId || '') + '"><small>' +
    (l.relation === 'contemporary' ? '同期世界' : l.relation === 'compare' ? '跨时期对照' : '相关专题') + '</small><strong>' + esc(l.label) + '</strong><span>' + esc(l.reason) + '</span>' + readingArrow + '</button>').join('') + '</section>';
}
function followReadingTopic(topicId, chapterId) {
  const target = TOPICS.find((t) => t.id === topicId);
  if (!target) return;
  rememberReading();
  reading.trail.push(readingFrame());
  reading.catalog = false;
  reading.topic = target;
  reading.detail = target.chapters.some((c) => c.id === chapterId) ? chapterId : null;
  reading.scroll = reading.detailScroll = 0;
  reading.linkEntry = true;
  renderReading();
  el('reading-title').focus({preventScroll:true});
}
function readingFrame() {
  return {topic:reading.topic, detail:reading.detail, year:reading.year, scroll:reading.scroll, detailScroll:reading.detailScroll,
    linkEntry:reading.linkEntry, catalog:reading.catalog, catalogContinent:reading.catalogContinent, catalogScroll:reading.catalogScroll};
}
function openReadingCatalog() {
  rememberReading();
  reading.trail.push(readingFrame());
  reading.catalog = true;
  reading.catalogContinent = '全部';
  reading.catalogScroll = 0;
  renderReading();
  el('reading-title').focus({preventScroll:true});
}
function renderReadingCatalog() {
  const continents = ['全部','亚洲','非洲','欧洲','北美洲','南美洲','大洋洲'];
  const selected = reading.catalogContinent;
  const topics = TOPICS.filter(t => selected === '全部' || t.continents.includes(selected)).sort((a,b)=>a.from-b.from || a.id.localeCompare(b.id));
  const year = y => y < 0 ? '前' + Math.abs(y) : '公元' + y;
  setReadingBack(reading.trail.length ? '返回阅读' : '');
  bookBody.innerHTML = '<h1 id="reading-title" tabindex="-1">全球专题目录</h1>' +
    '<nav class="reading-filters" aria-label="按大洲筛选">' + continents.map(c=>'<button type="button" data-reading-continent="'+c+'" aria-pressed="'+(c===selected)+'">'+c+'</button>').join('') + '</nav>' +
    '<p class="when" role="status">'+topics.length+' 组专题</p>' + topics.map(t=>'<button type="button" class="reading-card reading-link" data-reading-topic="'+esc(t.id)+'"><small>'+year(t.from)+'—'+year(t.to)+'</small><strong>'+esc(t.title)+'</strong><span>'+esc(t.summary)+'</span>'+readingArrow+'</button>').join('');
  bookBody.scrollTop = reading.catalogScroll;
}
function setReadingBack(label) {
  readingBack.hidden = !label;
  readingBack.setAttribute('aria-label', label || '返回');
}
function readingHeading(title, meta, action = '') {
  return '<h1 id="reading-title" tabindex="-1">' + esc(title) + '</h1><div class="reading-meta"><p class="when">' + esc(meta) + '</p>' + action + '</div>';
}
function renderTimeline(items) {
  const ent = reading.ent;
  const period = chapterOf(reading.year);
  const anchor = reading.snapshot.year;
  const anchored = chapterOf(anchor) === period;
  const meta = anchored ? fmtYear(anchor) + ' 年 · ' + period.n : period.n + ' · ' + fmtYear(period.a) + '–' + fmtYear(period.b);
  const isContext = (item) => item.kind === 'era' || item.context;
  const events = items.filter((item) => !isContext(item));
  const overlap = (item) => anchor >= item.start && anchor <= (item.point ? item.start : item.end);
  const distance = (item) => Math.max(item.start - anchor, anchor - (item.point ? item.start : item.end), 0);
  const nearest = anchored && events.reduce((best, item) => !best || distance(item) < distance(best) ? item : best, null);
  const context = items.filter(isContext);
  const note = nearest && distance(nearest) > 0
    ? '<p class="reading-note">这一年暂无收录的事件 · <button type="button" data-reading-detail="' + esc(nearest.id) + '">最近一条始于 ' + esc(fmtYear(nearest.start)) + ' 年</button></p>'
    : '';
  return readingHeading(ent.kind === 'polity' ? polityZhName(ent.name) : ent.name, meta) + note +
    (events.length ? readingRows(events.map((item) => readingRow(item, { current: anchored && overlap(item) })), '事件') :
      '<p class="reading-note">这一时期暂无收录的事件。</p>') +
    (context.length ? '<section class="reading-context"><h2>时代背景</h2>' + readingRows(context.map((item) => readingRow(item)), '时代背景') + '</section>' : '') +
    periodNavigation() + catalogNavigation();
}
function renderReadingArticle(topic, items, item) {
  const prose = topic || item.paragraphs ? '' : proseOf(item.id);
  const wikiTitle = prose && stories.entries[item.id].t;
  const wikiUrl = wikiTitle && 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(wikiTitle.replace(/ /g, '_'));
  const sources = item.sources ? [...item.sources] : [];
  if (wikiUrl) sources.push({ title: wikiTitle + ' · 中文维基百科', url: wikiUrl });
  if (!topic && !item.paragraphs && item.source && item.source !== wikiUrl) {
    sources.push({ title: item.zh || item.en, url: item.source });
  }
  const map = item.place ? '<button id="reading-map" type="button">在地球上看 <span aria-hidden="true">↗</span></button>' : '';
  const next = items[items.indexOf(item) + 1];
  let body;
  if (topic) {
    body = '<p class="lede">' + esc(item.summary) + '</p>' + item.sections.map((s) =>
      '<article><h2>' + esc(s.title) + '</h2><p>' + esc(s.text) + referencesMarkup(s.refs) + '</p></article>').join('');
  } else {
    const paragraphs = item.paragraphs || (prose ? [prose] : []);
    body = paragraphs.length ? paragraphs.map((p) => '<article><p>' + esc(p) + '</p></article>').join('') :
      '<p class="reading-note">这条年表记录暂未收录正文。</p>';
  }
  return readingHeading(item.title || item.zh || item.en, readingDate(item), map) + body +
    sourcesMarkup(sources) + (prose ? '<p class="credits">正文摘自中文维基百科导语 · CC BY-SA 4.0</p>' : '') +
    (next && topic ? '<nav class="reading-next"><button type="button" data-reading-detail="' + esc(next.id) + '">下一篇 · ' + esc(next.title) + readingArrow + '</button></nav>' : '') +
    connectionsMarkup(topic, item) + catalogNavigation();
}
function renderReading() {
  if (reading.catalog) { renderReadingCatalog(); return; }
  const topic = reading.topic, items = readingItems();
  const item = reading.detail !== null ? items.find((c) => String(c.id) === String(reading.detail)) : null;
  if (!item) reading.detail = null;
  setReadingBack(reading.trail.length && (reading.linkEntry || !item) ? '返回上一级' : item ? (topic ? '返回专题' : '返回年表') : '');
  if (item) bookBody.innerHTML = renderReadingArticle(topic, items, item);
  else if (topic) {
    bookBody.innerHTML = readingHeading(topic.title, topic.subtitle) + '<p class="lede">' + esc(topic.summary) + '</p>' +
      readingRows(items.map((chapter) => readingRow(chapter)), '专题篇目') +
      connectionsMarkup(topic, null) + '<p class="credits">' + esc(topic.scope) + '</p>' + catalogNavigation();
  } else bookBody.innerHTML = renderTimeline(items);
  bookBody.scrollTop = item ? reading.detailScroll : reading.scroll;
}
function periodNavigation() {
  const i = CH.indexOf(chapterOf(reading.year));
  return '<nav class="reading-next">' +
    (i > 0 ? '<button type="button" class="reading-previous" data-reading-period="' + (i - 1) + '">' + readingArrow + esc(CH[i - 1].n) + '</button>' : '') +
    (i < CH.length - 1 ? '<button type="button" data-reading-period="' + (i + 1) + '">' + esc(CH[i + 1].n) + readingArrow + '</button>' : '') + '</nav>';
}
function openReadingDetail(id) {
  reading.linkEntry = false;
  if (!reading.detail) reading.scroll = bookBody.scrollTop;
  reading.detail = id;
  reading.detailScroll = 0;
  renderReading();
  el('reading-title').focus({ preventScroll: true });
}
function readingIndex() {
  const selected = reading.detail;
  reading.linkEntry = false;
  reading.detail = null;
  renderReading();
  const row = [...bookBody.querySelectorAll('.reading-row')].find((button) => button.dataset.readingDetail === selected);
  (row || el('reading-title')).focus({ preventScroll: true });
}
function readingGoBack() {
  if (reading.trail && reading.trail.length && (reading.catalog || reading.linkEntry || reading.detail === null)) {
    rememberReading(); Object.assign(reading, reading.trail.pop()); renderReading(); readingBack.focus({preventScroll:true});
  } else if (reading.detail !== null) readingIndex();
  else closeReader();
}
function closeReader() {
  if (!reading.active) return;
  rememberReading();
  const s = reading.snapshot;
  chrome.natural = s.natural;
  reading.active = reading.preview = false;
  bookEl.hidden = true;
  readerMotion?.cancel();
  readerMotion = readerDrag = null;
  bookBar.classList.remove('collapse-ready');
  Object.assign(bookEl.style, readerFrame(0));
  readingResume.hidden = true;
  readingBackground(false);
  pauseGlobe();
  Object.assign(state, { year: s.year, layerId: s.layerId, focus: s.focus, yaw: s.yaw, tilt: s.tilt, zoom: s.zoom, panX: s.panX, panY: s.panY, lift: s.lift });
  onYearChanged();
  layout();
  sheetState.detent = s.detent;
  applySheetOffset(s.detent === 'custom' ? clamp(s.offset, 0, sheetDetents().peek) : sheetDetents()[s.detent], false);
  sheetScroll.scrollTop = s.scroll;
  if (reading.trigger && reading.trigger.isConnected && reading.trigger !== document.body) reading.trigger.focus({ preventScroll: true });
  else { const button = sheetInner.querySelector('[data-read-topic]'); if (button) button.focus({ preventScroll: true }); }
  invalidate();
}
function previewReadingMap() {
  const item = reading.topic?.chapters.find((c) => c.id === reading.detail);
  if (!item?.place) return;
  rememberReading();
  reading.preview = true;
  bookEl.hidden = true;
  readingBackground(false);
  closeSheet();
  closeWorld();
  pauseGlobe();
  state.year = clamp(item.year, YMIN, YMAX);
  state.layerId = 'country';
  chrome.natural = false;
  state.yaw = -item.place.lon * Math.PI / 180;
  state.tilt = clamp(item.place.lat * Math.PI / 180, -0.62, 1.02);
  state.zoom = 2.2;
  state.panX = state.panY = state.lift = 0;
  onYearChanged();
  layout();
  const id = pickAt(view.cx, view.cy);
  const shape = partition.shapes.find((s) => s.id === id);
  if (shape) state.focus = { layerId: state.layerId, id, key: focusKeyOf(state.layerId, shape) };
  rebuildPartition();
  invalidate();
  readingResume.textContent = item.place.label + ' · 返回阅读 ↑';
  readingResume.hidden = false;
  readingResume.focus({ preventScroll: true });
}
function resumeReader() {
  if (!reading.active) return;
  pauseGlobe();
  closeWorld();
  showReader();
}
function handleReadingKey(e) {
  if (!reading.active) return false;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (reading.preview) resumeReader(); else readingGoBack();
    return true;
  }
  if (reading.preview) return false;
  if (e.key === 'Tab') {
    const focusable = [...bookEl.querySelectorAll('button:not(:disabled):not([hidden]), [tabindex="0"], a[href]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  return true;
}
sheetInner.addEventListener('click', (e) => {
  const b = e.target.closest('[data-read-topic]');
  if (b) openBook(b.dataset.readTopic);
});
bookBody.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'reading-map') previewReadingMap();
  else if (b.hasAttribute('data-reading-detail')) openReadingDetail(b.dataset.readingDetail);
  else if (b.hasAttribute('data-reading-topic')) followReadingTopic(b.dataset.readingTopic, b.dataset.readingChapter);
  else if (b.hasAttribute('data-reading-catalog')) openReadingCatalog();
  else if (b.hasAttribute('data-reading-continent')) {
    reading.catalogContinent = b.dataset.readingContinent;
    reading.catalogScroll = 0;
    renderReading();
    bookBody.querySelector('[data-reading-continent="' + reading.catalogContinent + '"]').focus({preventScroll:true});
  }
  else if (b.hasAttribute('data-reading-index')) readingIndex();
  else if (b.hasAttribute('data-reading-period')) {
    rememberReading();
    const period = CH[Number(b.dataset.readingPeriod)];
    if (!period) return;
    reading.year = period.a + 1;
    const saved = readingPositions.get(readingKey());
    reading.detail = saved ? saved.detail : null;
    reading.scroll = saved ? saved.scroll : 0;
    reading.detailScroll = saved ? saved.detailScroll : 0;
    renderReading();
    el('reading-title').focus({ preventScroll: true });
  }
});
readingBack.addEventListener('click', readingGoBack);
readingGrab.addEventListener('click', (e) => {
  if (!e.detail || e.timeStamp - readerLastDrag > 300) collapseReader();
});
readingGrab.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown') return;
  e.preventDefault();
  collapseReader();
});
bookBar.addEventListener('pointerdown', readerDragStart);
bookBar.addEventListener('lostpointercapture', readerDragEnd);
addEventListener('pointermove', readerDragMove);
addEventListener('pointerup', readerDragEnd);
addEventListener('pointercancel', readerDragEnd);
addEventListener('blur', readerDragEnd);
readingResume.addEventListener('click', resumeReader);
