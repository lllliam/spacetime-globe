/* 阅读模块由 build.mjs 插入 app.js 的同一作用域。阅读位置独立于地球年份。 */
const TOPICS = JSON.parse(inlineText('topics') || '[]');
const bookEl = el('book'), bookBody = el('book-body');
const readingBack = el('reading-back'), readingMap = el('reading-map'), readingResume = el('reading-resume');
const reading = { active: false, preview: false, topic: null, ent: null, detail: null, year: 0, scroll: 0, detailScroll: 0, snapshot: null, trigger: null };
const readingPositions = new Map();

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
  for (const id of ['hud', 'dock', 'sheet', 'overlay', 'reading-resume']) el(id).inert = inert;
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
    if (reading.active && !reading.preview && !reading.topic) { rememberReading(); renderReading(); }
  });
}
function showReader(fromOffset = 18) {
  hideTimeline(false);
  closeView(false);
  reading.preview = false;
  readingResume.hidden = true;
  bookEl.hidden = false;
  readingBackground(true);
  renderReading();
  bookEl.getAnimations().forEach((a) => a.cancel());
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const offset = clamp(fromOffset, 0, innerHeight);
    bookEl.animate([
      { transform: 'translateY(' + offset + 'px)', opacity: .86, borderRadius: '22px 22px 0 0' },
      { transform: 'translateY(0)', opacity: 1, borderRadius: '0' },
    ], { duration: clamp(offset * .7, 180, 360), easing: 'cubic-bezier(.2,.85,.25,1)' });
  }
  readingBack.focus({ preventScroll: true });
}
function readingItems() {
  if (reading.topic) return reading.topic.chapters;
  return buildChapter(reading.ent, chapterOf(reading.year)).sections.flatMap((s) => s.items);
}
function sourcesMarkup(sources) {
  return '<section class="reading-sources"><h2>来源与继续阅读</h2><p>正文可离线阅读，来源链接需联网打开。</p>' +
    sources.map((s, i) => '<a id="reading-source-' + i + '" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">[' + (i + 1) + '] ' + esc(s.title) + (s.note ? ' · ' + esc(s.note) : '') + ' ↗</a>').join('') + '</section>';
}
function referencesMarkup(refs) {
  return refs && refs.length ? '<span class="reading-refs">' + refs.map((i) => '<a href="#reading-source-' + i + '" aria-label="查看来源 ' + (i + 1) + '">[' + (i + 1) + ']</a>').join(' ') + '</span>' : '';
}
function connectionsMarkup(topic, item) {
  if (!topic) return '';
  const links = item ? (item.connections || []) : (topic.connections || []);
  const related = item || !reading.ent ? [] : topicsForEntity(reading.ent, reading.year).filter((t) => t.id !== topic.id).map((t) => ({topicId:t.id,label:t.title,reason:'同一时期的相关区域专题',relation:'context'}));
  const valid = [...links, ...related].filter((l) => TOPICS.some((t) => t.id === l.topicId));
  if (!valid.length) return '';
  return '<section class="reading-connections"><h2>把视野放远一点</h2>' + valid.map((l) => '<button type="button" class="reading-card" data-reading-topic="' + esc(l.topicId) + '" data-reading-chapter="' + esc(l.chapterId || '') + '"><small>' +
    (l.relation === 'contemporary' ? '同期世界' : l.relation === 'compare' ? '跨时期对照' : '相关专题') + '</small><strong>' + esc(l.label) + ' →</strong><span>' + esc(l.reason) + '</span></button>').join('') + '</section>';
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
  el('book-crumb').textContent = '全球专题目录';
  readingBack.textContent = reading.trail.length ? '← 返回阅读' : '← 返回地球';
  readingMap.disabled = true;
  bookBody.innerHTML = '<p class="eyebrow">六大洲 · ' + TOPICS.length + ' 组专题 · ' + TOPICS.reduce((n,t)=>n+t.chapters.length,0) + ' 篇正文</p>' +
    '<h1 id="reading-title" tabindex="-1">沿着问题，读遍世界</h1><p class="lede">选择一个地区，从具体问题走进它的历史。</p>' +
    '<p class="reading-scope">覆盖全球主要文明、地区与历史阶段。每组为选择性专题，不等于每个国家、每个年份都有完整通史；跨洲专题会出现在多个地区。阅读目录不会改变地球年份。</p>' +
    '<nav class="reading-filters" aria-label="按大洲筛选">' + continents.map(c=>'<button type="button" data-reading-continent="'+c+'" aria-pressed="'+(c===selected)+'">'+c+'</button>').join('') + '</nav>' +
    '<p class="when" role="status">'+selected+' · '+topics.length+' 组专题</p>' + topics.map(t=>'<button type="button" class="reading-card" data-reading-topic="'+esc(t.id)+'"><small>'+year(t.from)+'—'+year(t.to)+' · '+t.chapters.length+' 篇</small><strong>'+esc(t.title)+' →</strong><span>'+esc(t.summary)+'</span></button>').join('');
  bookBody.scrollTop = reading.catalogScroll;
}
function renderReading() {
  if (reading.catalog) { renderReadingCatalog(); return; }
  const topic = reading.topic, items = readingItems();
  const item = reading.detail !== null ? items.find((c) => String(c.id) === String(reading.detail)) : null;
  if (!item) reading.detail = null;
  const title = topic ? topic.title : reading.ent.name + ' · ' + chapterOf(reading.year).n;
  el('book-crumb').textContent = item ? title : (topic ? topic.subtitle : '时期资料');
  readingBack.textContent = item ? '← 返回专题' : '← 返回地球';
  if (!topic && item) readingBack.textContent = '← 返回时期';
  if (reading.trail && reading.trail.length && (reading.linkEntry || !item)) readingBack.textContent = '← 返回上篇';
  let html;
  if (item) {
    const sections = topic ? item.sections : [{ title: '条目正文', text: item.prose || '这条记录暂未收录可核对的正文。可以查看来源，或返回时期浏览其他条目。' }];
    const sources = topic ? item.sources : (item.source ? [{ title: item.title + ' · 年表原始来源', url: item.source }] : []);
    html = '<p class="eyebrow">' + (topic ? '专题节点' : '年表资料') + ' · ' + (items.indexOf(item) + 1) + ' / ' + items.length + '</p>' +
      '<h1 id="reading-title" tabindex="-1">' + esc(item.title) + '</h1><p class="when">' + esc(item.date || item.meta) + '</p>' +
      (item.summary ? '<p class="lede">' + esc(item.summary) + '</p>' : '') +
      sections.map((s) => '<article><h2>' + esc(s.title) + '</h2><p>' + esc(s.text) + referencesMarkup(s.refs) + '</p></article>').join('') +
      connectionsMarkup(topic, item) + sourcesMarkup(sources) + '<nav class="reading-next">' +
      (items.indexOf(item) > 0 ? '<button type="button" data-reading-detail="' + esc(items[items.indexOf(item) - 1].id) + '">← 上一篇</button>' : '') +
      (items.indexOf(item) < items.length - 1 ? '<button type="button" data-reading-detail="' + esc(items[items.indexOf(item) + 1].id) + '">下一篇：' + esc(items[items.indexOf(item) + 1].title) + ' →</button>' : '<button type="button" data-reading-index>读完了，回到专题 ↑</button>') + '</nav>';
  } else {
    const ch = topic ? null : buildChapter(reading.ent, chapterOf(reading.year));
    html = '<p class="eyebrow">' + (topic ? '历史专题 · ' + items.length + ' 个节点' : '时期资料 · ' + items.length + ' 条记录') + '</p>' +
      '<h1 id="reading-title" tabindex="-1">' + esc(title) + '</h1><p class="when">' + esc(topic ? topic.subtitle : chapterOf(reading.year).a + '—' + chapterOf(reading.year).b + ' · ' + reading.ent.name) + '</p>' +
      '<p class="lede">' + esc(topic ? topic.summary : ch.lede) + '</p>' +
      '<p class="reading-scope">' + esc(topic ? topic.scope : '本页按所选时期筛选年表资料；跨越时期的长时段记录也会保留。条目导语与专题叙事分别标注。') + '</p>' +
      '<nav class="reading-next"><button type="button" data-reading-catalog>探索全球 ' + TOPICS.length + ' 组专题 →</button></nav>' +
      '<h2>' + (topic ? '沿着 ' + items.length + ' 个问题读下去' : '这一时期的记录') + '</h2>' +
      items.map((c, i) => '<button type="button" class="reading-card" data-reading-detail="' + esc(c.id) + '"><small>' + String(i + 1).padStart(2, '0') + ' / ' + esc(c.date || c.meta) +
        '</small><strong>' + esc(c.title) + ' <span>→</span></strong>' + (c.summary ? '<span>' + esc(c.summary) + '</span>' : '') + '</button>').join('') +
      (!items.length ? '<p class="reading-empty">这一时期还没有收录条目，可以切换到相邻时期。</p>' : '') +
      (!topic ? periodNavigation() : '') + connectionsMarkup(topic, null) +
      '<p class="credits">' + (topic ? '专题文字为依据所列资料编写的概述，因果联系为解释线索，不替代完整史学论证。每篇附独立来源。' : '正文：中文维基百科导语（CC BY-SA 4.0），条目详情附原始来源；地理关联采用地区代表点，存在近似。') + '</p>';
  }
  bookBody.innerHTML = html + (item ? '<nav class="reading-next"><button type="button" data-reading-catalog>探索全球 ' + TOPICS.length + ' 组专题 →</button></nav>' : '');
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
  reading.linkEntry = false;
  if (!reading.detail) reading.scroll = bookBody.scrollTop;
  reading.detail = id;
  reading.detailScroll = 0;
  renderReading();
  el('reading-title').focus({ preventScroll: true });
}
function readingIndex() {
  reading.linkEntry = false;
  reading.detail = null;
  renderReading();
  const first = bookBody.querySelector('[data-reading-detail]');
  if (first) first.focus({ preventScroll: true });
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
  bookEl.getAnimations().forEach((a) => a.cancel());
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
    chrome.natural = false;
    state.yaw = -item.place.lon * Math.PI / 180;
    state.tilt = clamp(item.place.lat * Math.PI / 180, -0.62, 1.02);
    state.zoom = 2.2;
    state.panX = state.panY = state.lift = 0;
  } else if (reading.ent) {
    state.layerId = reading.ent.layerId;
  }
  onYearChanged();
  layout();
  const entityShape = reading.ent && partition.shapes.find((s) => focusKeyOf(state.layerId, s) === reading.ent.key);
  const id = item.place ? pickAt(view.cx, view.cy) : entityShape && entityShape.id;
  const shape = partition.shapes.find((s) => s.id === id);
  if (shape) state.focus = { layerId: state.layerId, id, key: focusKeyOf(state.layerId, shape) };
  rebuildPartition();
  invalidate();
  const placeLabel = item.place?.label || (reading.ent ? reading.ent.name + ' · 区域示意' : '地图');
  readingResume.textContent = placeLabel + ' · 返回阅读 ↑';
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
readingMap.addEventListener('click', previewReadingMap);
readingResume.addEventListener('click', resumeReader);
