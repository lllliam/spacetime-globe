/* 阅读模块由 build.mjs 插入 app.js 的同一作用域。阅读位置独立于地球年份。 */
const TOPICS = JSON.parse(inlineText('topics') || '[]');
const timelineNotes = JSON.parse(inlineText('timeline-notes') || '{}');
const bookEl = el('book'), bookBar = el('book-bar'), bookBody = el('book-body');
const readingBack = el('reading-back'), readingGrab = el('reading-grab');
const reading = { active: false, topic: null, ent: null, detail: null, year: 0, scroll: 0, detailScroll: 0, snapshot: null, trigger: null };
const readingPositions = new Map();
const readingArrow = '<svg class="reading-arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const reducedReadingMotion = matchMedia('(prefers-reduced-motion: reduce)');
let readerMotion = 0, readerDrag = null, readerLastDrag = -Infinity;
let readerTouch = null;
const readerEdgeWidth = 32;

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
  for (const id of ['globe', 'hud', 'toolbar', 'grab', 'sheet-scroll', 'sheet-dim', 'overlay', 'event-map-panel', 'event-map-points']) {
    el(id).inert = inert;
  }
  timeDock.inert = inert || !chrome.timeline;
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
  showReader(fromOffset);
  // 正文到达后只更新通用资料页；专题内容无需网络。
  if (ent) loadStories().then(() => {
    if (reading.active && !reading.catalog && !reading.topic && reading.detail !== null) {
      rememberReading();
      renderReading();
    }
  });
}
function showReader(fromOffset) {
  hideTimeline(false);
  closeView(false);
  bookEl.hidden = false;
  readerLastDrag = -Infinity;
  readingBackground(true);
  renderReading();
  animateReader(clamp(fromOffset, 0, sheetDetents().hidden), 0, { fromSummary: true });
  el('reading-title').focus({ preventScroll: true });
}
function readerRestOffset() {
  const { detent, offset } = reading.snapshot;
  const detents = sheetDetents();
  return detent === 'custom' ? clamp(offset, 0, detents.peek) : detents[detent];
}
function readerPosition(offset, range = readerRestOffset()) {
  const progress = clamp(offset / Math.max(1, range), 0, 1);
  const fade = (start, end) => {
    const mix = clamp((progress - start) / (end - start), 0, 1);
    return mix * mix * (3 - 2 * mix);
  };
  const summary = fade(.42, .96);
  const article = 1 - fade(.15, .68);
  const hud = clamp((progress - .30) / .65, 0, 1);
  applySheetOffset(offset, false);
  sheetEl.style.setProperty('--reader-summary', summary);
  sheetEl.style.setProperty('--reader-article', article);
  sheetEl.style.setProperty('--reader-safe', 1 - progress);
  sheetEl.style.setProperty('--reader-grip', progress);
  sheetEl.style.borderRadius = (progress * 22) + 'px ' + (progress * 22) + 'px 0 0';
  document.body.style.setProperty('--reader-hud', hud);
  document.body.classList.toggle('reader-revealing', hud > 0);
  if (summary > 0 && sheetScroll.scrollTop !== reading.snapshot.scroll) sheetScroll.scrollTop = reading.snapshot.scroll;
}
function stopReaderMotion() {
  cancelAnimationFrame(readerMotion);
  readerMotion = 0;
}
function animateReader(from, to, { velocity = 0, onFinish, fromSummary = false } = {}) {
  stopReaderMotion();
  const paint = (offset) => readerPosition(offset, fromSummary ? from : undefined);
  paint(from);
  if (reducedReadingMotion.matches || Math.abs(to - from) < 1) {
    paint(to);
    onFinish?.();
    return;
  }
  let offset = from, last = performance.now();
  velocity = clamp(velocity, -1600, 1600);
  const tick = (now) => {
    const dt = clamp((now - last) / 1000, .001, .032);
    last = now;
    velocity += ((to - offset) * 330 - velocity * 34) * dt;
    offset += velocity * dt;
    if (Math.abs(offset - to) < .6 && Math.abs(velocity) < 8) {
      readerMotion = 0;
      paint(to);
      onFinish?.();
      return;
    }
    paint(clamp(offset, 0, sheetDetents().hidden));
    readerMotion = requestAnimationFrame(tick);
  };
  readerMotion = requestAnimationFrame(tick);
}
function collapseReader(velocity = 0) {
  if (!reading.active) return;
  animateReader(sheetState.offset, readerRestOffset(), { velocity, onFinish: closeReader });
}
function readerDragStart(e) {
  if (readerDrag || e.isPrimary === false || e.button !== 0 || e.target.closest('#reading-back')) return;
  if (e.pointerType === 'touch' && e.clientX <= readerEdgeWidth) return;
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
    stopReaderMotion();
    // 触屏已由按下的控件隐式捕获；转移捕获会把丢失捕获事件冒泡到这里。
    if (e.pointerType === 'mouse') bookBar.setPointerCapture(e.pointerId);
  }
  dragReaderTo(drag.offset + drag.dy);
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
  finishReaderPull(drag.dy, velocity, e.type === 'pointerup');
}
function dragReaderTo(offset) {
  const max = readerRestOffset();
  const eased = offset > max ? max + 24 * (1 - Math.exp((max - offset) / 48)) : Math.max(0, offset);
  readerPosition(eased);
  bookBar.classList.toggle('collapse-ready', eased >= clamp(max * .32, 80, 132));
}
function finishReaderPull(distance, velocity, released) {
  const offset = sheetState.offset;
  const threshold = clamp(readerRestOffset() * .32, 80, 132);
  if (released && distance > 0 && (offset >= threshold || (distance > 24 && velocity > 620))) collapseReader(velocity);
  else animateReader(offset, 0);
}
function startReaderTouch(e) {
  if (e.touches.length !== 1) { endReaderTouch(e); return; }
  if (readerMotion || readerDrag) return;
  const touch = e.changedTouches[0];
  const edge = touch.clientX <= readerEdgeWidth;
  const canPull = bookBody.contains(e.target) && bookBody.scrollTop <= 1;
  if (!edge && !canPull) return;
  readerTouch = { id: touch.identifier, x: touch.clientX, y: touch.clientY, edge, canPull, axis: null, distance: 0, samples: [] };
}
function moveReaderTouch(e) {
  const gesture = readerTouch;
  if (!gesture) return;
  if (e.touches.length !== 1 || !e.cancelable) { endReaderTouch(e); return; }
  const touch = e.touches[0];
  const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
  if (!gesture.axis) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
    if (gesture.edge && dx > 0 && dx > Math.abs(dy) * 1.35) {
      gesture.axis = 'back';
      for (const animation of bookEl.getAnimations()) animation.cancel();
    }
    else if (gesture.canPull && dy > Math.abs(dx) * 1.25 && bookBody.scrollTop <= 1) gesture.axis = 'pull';
    else { readerTouch = null; return; }
  }
  e.preventDefault();
  gesture.distance = gesture.axis === 'back' ? dx : dy;
  gesture.samples.push({ distance: gesture.distance, time: e.timeStamp });
  gesture.samples = gesture.samples.filter((sample) => e.timeStamp - sample.time < 110);
  if (gesture.axis === 'pull') dragReaderTo(dy);
  else bookEl.style.transform = 'translateX(' + clamp(dx * .55, 0, view.w * .25) + 'px)';
}
function endReaderTouch(e) {
  const gesture = readerTouch;
  if (!gesture) return;
  if (e.type === 'touchend' && !Array.from(e.changedTouches).some((touch) => touch.identifier === gesture.id)) return;
  readerTouch = null;
  if (!gesture.axis) return;
  readerLastDrag = e.timeStamp;
  const released = e.type === 'touchend';
  const first = gesture.samples[0], last = gesture.samples.at(-1);
  const velocity = first && last.time > first.time && e.timeStamp - last.time < 110
    ? (last.distance - first.distance) / (last.time - first.time) * 1000 : 0;
  if (gesture.axis === 'pull') {
    bookBar.classList.remove('collapse-ready');
    finishReaderPull(gesture.distance, velocity, released);
    return;
  }
  const transform = bookEl.style.transform;
  bookEl.style.transform = '';
  const goBack = released && (gesture.distance >= clamp(view.w * .24, 72, 125) || (gesture.distance > 30 && velocity > 620));
  if (goBack) readingGoBack();
  if (!reducedReadingMotion.matches && reading.active && !readerMotion) {
    bookEl.animate([{ transform: goBack ? 'translateX(18px)' : transform }, { transform: 'none' }],
      { duration: 170, easing: 'ease-out' });
  }
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
function readingRow(item, { current = false, timeline = false } = {}) {
  const date = '<small>' + esc(readingDate(item)) + '</small>';
  return '<li><button type="button" class="reading-card reading-row"' + (current ? ' aria-current="date"' : '') +
    ' data-reading-detail="' + esc(item.id) + '">' + (timeline ? '' : date) +
    '<span class="reading-row-copy">' + (timeline ? date : '') + '<strong>' + esc(item.title || item.zh || item.en) + '</strong>' +
    (item.summary ? '<span>' + esc(item.summary) + '</span>' : '') + '</span>' + readingArrow + '</button></li>';
}
function readingRows(rows, label, timeline = false) {
  return '<ol class="reading-list' + (timeline ? ' reading-timeline' : '') + '" aria-label="' + esc(label) + '">' + rows.join('') + '</ol>';
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
function relatedReadingTopic(item) {
  return item.related && TOPICS.find((topic) => topic.id === item.related.topicId);
}
function connectionsMarkup(topic, item) {
  if (!topic) {
    const link = item.related;
    const target = relatedReadingTopic(item);
    if (!target) return '';
    const chapter = target.chapters.find((c) => c.id === link.chapterId);
    return '<nav class="reading-next reading-detail-route" aria-label="了解背景"><button type="button" data-reading-topic="' +
      esc(target.id) + '" data-reading-chapter="' + esc(chapter?.id || '') + '">' +
      esc(chapter?.title || target.title) + readingArrow + '</button></nav>';
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
function readingHeading(title, meta) {
  return '<h1 id="reading-title" tabindex="-1">' + esc(title) + '</h1><div class="reading-meta"><p class="when">' + esc(meta) + '</p></div>';
}
function renderTimeline(items) {
  const ent = reading.ent;
  const period = chapterOf(reading.year);
  const anchor = reading.snapshot.year;
  const name = ent.kind === 'polity' ? polityZhName(ent.name) : ent.name;
  const title = ent.iso === 'CN' && period === CH.at(-1) ? '中国近现代年表' : name + '年表';
  const meta = fmtYear(period.a) + (period.b === YMAX ? ' 年以来' : '—' + fmtYear(period.b));
  const startsHere = items.filter((item) => item.start >= period.a);
  const timeline = startsHere.length && period.a > YMIN ? startsHere : items;
  return readingHeading(title, meta) +
    (timeline.length ? readingRows(timeline.map((item) => readingRow(item, {
      timeline: true, current: anchor === item.start,
    })), '年表', true) : '<p class="reading-note">这个时段暂无记录。</p>') +
    periodNavigation();
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
  const next = items[items.indexOf(item) + 1];
  let body;
  if (topic) {
    const opening = item.opening?.text || item.summary;
    body = '<p class="reading-opening">' + esc(opening) + referencesMarkup(item.opening?.refs) + '</p>' + item.sections.map((s) =>
      '<article><h2>' + esc(s.title) + '</h2><p>' + esc(s.text) + referencesMarkup(s.refs) + '</p></article>').join('');
  } else {
    const paragraphs = item.paragraphs || (prose ? [prose] : []);
    body = paragraphs.length ? '<div class="reading-story">' + paragraphs.map((p, i) =>
      '<p' + (i === 0 ? ' class="reading-opening"' : '') + '>' + esc(p) + '</p>').join('') + '</div>' :
      '<p class="reading-note">这条年表记录暂未收录正文。</p>';
  }
  return readingHeading(item.opening?.headline || item.title || item.zh || item.en, readingDate(item)) + body +
    connectionsMarkup(topic, item) +
    (next && topic ? '<nav class="reading-next"><button type="button" data-reading-detail="' + esc(next.id) + '">下一篇 · ' + esc(next.title) + readingArrow + '</button></nav>' : '') +
    sourcesMarkup(sources) + (prose ? '<p class="credits">正文摘自中文维基百科导语 · CC BY-SA 4.0</p>' : '') +
    catalogNavigation();
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
    (i > 0 ? '<button type="button" class="reading-previous" data-reading-period="' + (i - 1) + '">' + readingArrow + '更早的记录</button>' : '') +
    (i < CH.length - 1 ? '<button type="button" data-reading-period="' + (i + 1) + '">更晚的记录' + readingArrow + '</button>' : '') + '</nav>';
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
  else collapseReader();
}
function closeReader() {
  if (!reading.active) return;
  rememberReading();
  stopReaderMotion();
  readerDrag = null;
  readerTouch = null;
  bookEl.style.transform = '';
  bookBar.classList.remove('collapse-ready');
  const { detent, scroll } = reading.snapshot;
  reading.active = false;
  bookEl.hidden = true;
  document.body.classList.remove('reader-revealing');
  sheetEl.style.borderRadius = '';
  for (const key of ['--reader-summary', '--reader-article', '--reader-safe', '--reader-grip']) sheetEl.style.removeProperty(key);
  document.body.style.removeProperty('--reader-hud');
  sheetState.detent = detent;
  applySheetOffset(readerRestOffset(), false);
  sheetScroll.scrollTop = scroll;
  readingBackground(false);
  const fallback = sheetInner.querySelector('[data-read-topic]') || grabEl;
  (reading.trigger?.isConnected && reading.trigger !== document.body ? reading.trigger : fallback).focus({ preventScroll: true });
  invalidate();
}
function handleReadingKey(e) {
  if (!reading.active) return false;
  if (e.key === 'Escape') {
    e.preventDefault();
    readingGoBack();
    return true;
  }
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
  if (b.hasAttribute('data-reading-detail')) openReadingDetail(b.dataset.readingDetail);
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
bookEl.addEventListener('touchstart', startReaderTouch, { passive: true });
bookEl.addEventListener('touchmove', moveReaderTouch, { passive: false });
bookEl.addEventListener('touchend', endReaderTouch);
bookEl.addEventListener('touchcancel', endReaderTouch);
bookEl.addEventListener('click', (e) => {
  if (e.detail && e.timeStamp - readerLastDrag < 300) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);
