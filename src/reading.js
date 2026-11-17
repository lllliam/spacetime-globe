/* 阅读模块由 build.mjs 插入 app.js 的同一作用域。阅读位置独立于地球年份。 */
const TOPICS = JSON.parse(inlineText('topics') || '[]');
const bookEl = el('book'), bookBody = el('book-body');
const readingBack = el('reading-back'), readingMap = el('reading-map'), readingResume = el('reading-resume');
const reading = { active: false, preview: false, topic: null, ent: null, detail: null, year: 0, scroll: 0, detailScroll: 0, snapshot: null, trigger: null };
const readingPositions = new Map();

function topicForEntity(ent) {
  return TOPICS.find((t) => ent.kind === 'country' ? t.countryIsos.includes(ent.iso) : t.polityNames.includes(ent.name)) || null;
}
function pauseGlobe() {
  spinning = false;
  momentum.yaw = momentum.tilt = 0;
  cancelAnimationFrame(zoomAnim);
  cancelAnimationFrame(liftRaf);
  cancelAnimationFrame(rafId);
  rafId = 0;
}
function readingKey() { return (reading.topic ? reading.topic.id : reading.ent.layerId + ':' + reading.ent.key + ':' + chapterOf(reading.year).n); }
function rememberReading() {
  if (!reading.ent) return;
  if (reading.detail) reading.detailScroll = bookBody.scrollTop;
  else reading.scroll = bookBody.scrollTop;
  readingPositions.set(readingKey(), { scroll: reading.scroll, detail: reading.detail, detailScroll: reading.detailScroll });
}
function readingBackground(inert) {
  for (const id of ['hud', 'dock', 'sheet', 'overlay', 'reading-resume']) el(id).inert = inert;
  document.body.classList.toggle('reading-open', inert);
}
function openBook(topicId) {
  if (reading.active) return;
  const ent = state.focus && entityByKey(state.focus.layerId, state.focus.key, state.focus.id);
  if (!ent) return;
  pauseGlobe();
  reading.snapshot = {
    year: state.year, layerId: state.layerId, focus: { ...state.focus },
    yaw: state.yaw, tilt: state.tilt, zoom: state.zoom, panX: state.panX, panY: state.panY, lift: state.lift,
    detent: sheetState.detent, offset: sheetState.offset, scroll: sheetScroll.scrollTop,
  };
  reading.ent = { ...ent };
  reading.topic = typeof topicId === 'string' ? TOPICS.find((t) => t.id === topicId) || null : topicForEntity(ent);
  reading.year = state.year;
  reading.trigger = document.activeElement;
  const saved = readingPositions.get(readingKey());
  reading.detail = saved ? saved.detail : null;
  reading.scroll = saved ? saved.scroll : 0;
  reading.detailScroll = saved ? saved.detailScroll : 0;
  reading.active = true;
  reading.preview = false;
  showReader();
  // 正文到达后只更新通用资料页；专题内容无需网络。
  loadStories().then(() => {
    if (reading.active && !reading.preview && !reading.topic) { rememberReading(); renderReading(); }
  });
}
function showReader() {
  reading.preview = false;
  readingResume.hidden = true;
  bookEl.hidden = false;
  readingBackground(true);
  renderReading();
  readingBack.focus({ preventScroll: true });
}
function readingItems() {
  if (reading.topic) return reading.topic.chapters;
  return buildChapter(reading.ent, chapterOf(reading.year)).sections.flatMap((s) => s.items);
}
function sourcesMarkup(sources) {
  return '<section class="reading-sources"><h2>来源与继续阅读</h2><p>正文可离线阅读，来源链接需联网打开。</p>' +
    sources.map((s) => '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + ' ↗</a>').join('') + '</section>';
}
function renderReading() {
  const topic = reading.topic, items = readingItems();
  const item = reading.detail !== null ? items.find((c) => String(c.id) === String(reading.detail)) : null;
  if (!item) reading.detail = null;
  const title = topic ? topic.title : reading.ent.name + ' · ' + chapterOf(reading.year).n;
  el('book-crumb').textContent = item ? title : (topic ? topic.subtitle : '时期资料');
  readingBack.textContent = item ? '← 返回专题' : '← 返回地球';
  if (!topic && item) readingBack.textContent = '← 返回时期';
  let html;
  if (item) {
    const sections = topic ? item.sections : [{ title: '条目正文', text: item.prose || '这条记录暂未收录可核对的正文。可以查看来源，或返回时期浏览其他条目。' }];
    const sources = topic ? item.sources : (item.source ? [{ title: item.title + ' · 年表原始来源', url: item.source }] : []);
    html = '<p class="eyebrow">' + (topic ? '专题节点' : '年表资料') + ' · ' + (items.indexOf(item) + 1) + ' / ' + items.length + '</p>' +
      '<h1 id="reading-title" tabindex="-1">' + esc(item.title) + '</h1><p class="when">' + esc(item.date || item.meta) + '</p>' +
      (item.summary ? '<p class="lede">' + esc(item.summary) + '</p>' : '') +
      sections.map((s) => '<article><h2>' + esc(s.title) + '</h2><p>' + esc(s.text) + '</p></article>').join('') +
      sourcesMarkup(sources) + '<nav class="reading-next">' +
      (items.indexOf(item) > 0 ? '<button type="button" data-reading-detail="' + esc(items[items.indexOf(item) - 1].id) + '">← 上一篇</button>' : '') +
      (items.indexOf(item) < items.length - 1 ? '<button type="button" data-reading-detail="' + esc(items[items.indexOf(item) + 1].id) + '">下一篇：' + esc(items[items.indexOf(item) + 1].title) + ' →</button>' : '<button type="button" data-reading-index>读完了，回到专题 ↑</button>') + '</nav>';
  } else {
    const ch = topic ? null : buildChapter(reading.ent, chapterOf(reading.year));
    html = '<p class="eyebrow">' + (topic ? '历史专题 · ' + items.length + ' 个节点' : '时期资料 · ' + items.length + ' 条记录') + '</p>' +
      '<h1 id="reading-title" tabindex="-1">' + esc(title) + '</h1><p class="when">' + esc(topic ? topic.subtitle : chapterOf(reading.year).a + '—' + chapterOf(reading.year).b + ' · ' + reading.ent.name) + '</p>' +
      '<p class="lede">' + esc(topic ? topic.summary : ch.lede) + '</p>' +
      '<p class="reading-scope">' + esc(topic ? topic.scope : '本页按所选时期筛选年表资料；跨越时期的长时段记录也会保留。条目导语与专题叙事分别标注。') + '</p>' +
      '<h2>' + (topic ? '沿着六个问题读下去' : '这一时期的记录') + '</h2>' +
      items.map((c, i) => '<button type="button" class="reading-card" data-reading-detail="' + esc(c.id) + '"><small>' + String(i + 1).padStart(2, '0') + ' / ' + esc(c.date || c.meta) +
        '</small><strong>' + esc(c.title) + ' <span>→</span></strong>' + (c.summary ? '<span>' + esc(c.summary) + '</span>' : '') + '</button>').join('') +
      (!items.length ? '<p class="reading-empty">这一时期还没有收录条目，可以切换到相邻时期。</p>' : '') +
      (!topic ? periodNavigation() : '') +
      '<p class="credits">' + (topic ? '专题文字为依据所列资料编写的概述，因果联系为解释线索，不替代完整史学论证。每篇附独立来源。' : '正文：中文维基百科导语（CC BY-SA 4.0），条目详情附原始来源；地理关联采用地区代表点，存在近似。') + '</p>';
  }
  bookBody.innerHTML = html;
  bookBody.scrollTop = item ? reading.detailScroll : reading.scroll;
  readingMap.disabled = !items.length;
}
function periodNavigation() {
  const i = CH.indexOf(chapterOf(reading.year));
  return '<nav class="reading-next">' +
    (i > 0 ? '<button type="button" data-reading-period="' + (i - 1) + '">← ' + esc(CH[i - 1].n) + '</button>' : '') +
    (i < CH.length - 1 ? '<button type="button" data-reading-period="' + (i + 1) + '">' + esc(CH[i + 1].n) + ' →</button>' : '') + '</nav>';
}
function openReadingDetail(id) {
  if (!reading.detail) reading.scroll = bookBody.scrollTop;
  reading.detail = id;
  reading.detailScroll = 0;
  renderReading();
  el('reading-title').focus({ preventScroll: true });
}
function readingIndex() {
  reading.detail = null;
  renderReading();
  const first = bookBody.querySelector('[data-reading-detail]');
  if (first) first.focus({ preventScroll: true });
}
function readingGoBack() {
  if (reading.detail !== null) readingIndex();
  else closeReader();
}
function closeReader() {
  if (!reading.active) return;
  rememberReading();
  const s = reading.snapshot;
  reading.active = reading.preview = false;
  bookEl.hidden = true;
  readingResume.hidden = true;
  readingBackground(false);
  pauseGlobe();
  Object.assign(state, { year: s.year, layerId: s.layerId, focus: { ...s.focus }, yaw: s.yaw, tilt: s.tilt, zoom: s.zoom, panX: s.panX, panY: s.panY, lift: s.lift });
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
  const items = readingItems();
  const item = items.find((c) => String(c.id) === String(reading.detail)) || items.reduce((best, c) => !best || Math.abs((c.year || reading.year) - reading.year) < Math.abs((best.year || reading.year) - reading.year) ? c : best, null);
  if (!item) return;
  rememberReading();
  reading.preview = true;
  bookEl.hidden = true;
  readingBackground(false);
  closeSheet();
  closeWorld();
  pauseGlobe();
  state.year = clamp(item.year || reading.year, YMIN, YMAX);
  // 精确事件地点仅来自专题编辑数据；通用年表只展示原地区的近似位置。
  if (item.place) {
    state.layerId = 'country';
    state.yaw = -item.place.lon * Math.PI / 180;
    state.tilt = clamp(item.place.lat * Math.PI / 180, -0.62, 1.02);
    state.zoom = 2.2;
    state.panX = state.panY = state.lift = 0;
  } else {
    state.layerId = reading.ent.layerId;
  }
  onYearChanged();
  layout();
  const entityShape = partition.shapes.find((s) => focusKeyOf(state.layerId, s) === reading.ent.key);
  const id = item.place ? pickAt(view.cx, view.cy) : entityShape && entityShape.id;
  const shape = partition.shapes.find((s) => s.id === id);
  if (shape) state.focus = { layerId: state.layerId, id, key: focusKeyOf(state.layerId, shape) };
  rebuildPartition();
  invalidate();
  readingResume.textContent = (item.place ? item.place.label : reading.ent.name + ' · 区域示意') + ' · 返回阅读 ↑';
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
    const focusable = [...bookEl.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
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
readingMap.addEventListener('click', previewReadingMap);
readingResume.addEventListener('click', resumeReader);
