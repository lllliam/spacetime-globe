/* 阅读模块由 build.mjs 插入 app.js 的同一作用域。阅读位置独立于地球年份。 */
const TOPICS = JSON.parse(inlineText('topics') || '[]');
const timelineNotes = JSON.parse(inlineText('timeline-notes') || '{}');
const bookEl = el('book'), bookBody = el('book-body');
const readingBack = el('reading-back'), readingSettings = el('reading-settings'), readingDisplay = el('reading-display');
const readingExit = el('reading-exit'), readingLibrary = el('reading-library'), readingDirectory = el('reading-index');
const readingSizes = [...readingDisplay.querySelectorAll('[data-reading-size]')];
const readingDisplayKey = 'globe.reading-display.v1';
const reading = session.read;
Object.defineProperties(reading, {
  active: { get: () => session.mode === 'Read' },
  subject: { get: () => subjectsById.get(reading.bookId) || null },
  topic: { get: () => TOPICS.find(topic => topic.id === reading.topicId) || null },
  ent: { get: () => resolveReadingEntity(reading.entity) },
});
let readingTrigger = null, readingEntryPeers = [], readingPositionTimer = 0, readerResizeFrame = 0;
let readerWidth = 0, readerHeight = 0;
let readingSize = 'standard';
try {
  const stored = localStorage.getItem(readingDisplayKey);
  if (readingSizes.some(button => button.dataset.readingSize === stored)) readingSize = stored;
} catch {}
const readingArrow = '<svg class="reading-arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const reducedReadingMotion = matchMedia('(prefers-reduced-motion: reduce)');
function resolveReadingEntity(ref) {
  if (!ref) return null;
  const ent = entityByKey(ref.layerId, ref.key);
  return ent && (ref.layerId === 'country' || ent.name === ref.name) ? ent : null;
}

function pauseGlobe() {
  stopSheetMotion();
  clearTimeout(globeTapTimer);
  globeTapTimer = lastTapAt = 0;
  pendingPolityTap = null;
  pointers.clear();
  drag = pinch = null;
  momentum.yaw = momentum.tilt = 0;
  cancelZoom();
  cancelResetAnim();
  stopPanReturn();
  cancelAnimationFrame(liftRaf);
  cancelAnimationFrame(rafId);
  rafId = 0;
}
function readingKey() {
  if (reading.bookId) return 'subject:' + reading.bookId;
  if (reading.topicId) return 'topic:' + reading.topicId;
  if (reading.entity) return 'atlas:' + reading.entity.layerId + ':' + reading.entity.key;
  return null;
}
function readingBlocks() {
  return [...bookBody.querySelectorAll('.subject-prose > p, .subject-prose > aside, .reading-opening, article > p, ' +
    '[data-block-id], .scene-plate, .reading-sources, .subject-chapter-next, details > summary, details[open] button, details[open] li, ' +
    '.contemporary-card, .reading-connections .reading-link')].filter(node => node.getClientRects().length);
}
function blockFingerprint(node) {
  const text = node.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
function captureReadingPosition() {
  const top = bookBody.scrollTop;
  if (top < 1) return session.position({ top });
  const edge = bookBody.getBoundingClientRect().top;
  const blocks = readingBlocks();
  const index = blocks.findLastIndex(block => block.getBoundingClientRect().top <= edge);
  if (index < 0) return session.position({ top });
  const block = blocks[index], box = block.getBoundingClientRect();
  return session.position({ top, block: blockFingerprint(block), blockId:block.dataset.blockId, index,
    offset:(edge - box.top) / Math.max(1, box.height) });
}
function restoreReadingPosition(position) {
  bookBody.scrollTop = position.top;
  if (!position.blockId && !position.block) return;
  const blocks = readingBlocks();
  const matches = block => block && blockFingerprint(block) === position.block;
  const block = position.blockId ? blocks.find(node=>node.dataset.blockId===position.blockId)
    : matches(blocks[position.index]) ? blocks[position.index]
      : blocks.find(matches) || blocks.find(node=>node.dataset.previousFingerprint===position.block);
  if (!block) return;
  const box = block.getBoundingClientRect();
  bookBody.scrollTop += box.top - bookBody.getBoundingClientRect().top + position.offset * box.height;
  return block;
}
function measureReader() {
  readerWidth = bookBody.clientWidth;
  readerHeight = bookBody.clientHeight;
}
function readerSizeChanged() {
  return readerWidth !== bookBody.clientWidth || readerHeight !== bookBody.clientHeight;
}
function rememberReading(promote = false) {
  clearTimeout(readingPositionTimer);
  readingPositionTimer = 0;
  if (!reading.active) return;
  if (reading.catalog) { reading.catalogScroll = bookBody.scrollTop; return; }
  if (reading.library) { reading.scroll = bookBody.scrollTop; return; }
  const previous = session.readingProgress(readingKey());
  if (reading.detail) {
    if (!readerSizeChanged()) reading.position = captureReadingPosition();
    reading.disclosures = [...bookBody.querySelectorAll('details')].flatMap((node,index) => node.open ? [index] : []);
    if (promote || reading.position.top > 0 || !previous?.chapter || previous.chapter === reading.detail)
      session.updateReadingPosition(readingKey(), reading.detail, reading.position, reading.scroll, reading.disclosures);
  } else {
    reading.scroll = bookBody.scrollTop;
    if (!reading.bookId) session.updateReadingPosition(readingKey(), previous?.chapter, previous?.position, reading.scroll, previous?.disclosures);
  }
}
function readingBackground(active) {
  for (const id of ['globe', 'hud', 'sheet', 'sheet-dim', 'overlay', 'event-map-top', 'event-map-panel', 'event-map-points'])
    el(id).inert = active;
  if (active) canvas.setAttribute('aria-hidden', 'true');
  else canvas.removeAttribute('aria-hidden');
  document.body.classList.toggle('reading-open', active);
  document.documentElement.classList.toggle('reader-paper', active);
  themeColorMeta.content = active || standaloneGlobe && document.documentElement.classList.contains('sheet-paper')
    ? paperThemeColor : globeThemeColor;
  updateVernier();
}
function openBook({ resume = false } = {}) {
  if (session.mode !== 'Explore') return;
  const focus = state.focus;
  const entity = focus && entityByKey(focus.layerId, focus.key, focus.id);
  if (!entity) return;
  const book = subjectBookForEntity(entity);
  const progress = resume ? savedSubjectProgress(book) : null;
  beginReading(entity, null, progress?.chapter, book, { resumePosition: progress?.position, resumeDisclosures: progress?.disclosures });
}
function beginReading(entity, topic, chapter, book = null, { source, entryYear = state.year, resumePosition, resumeDisclosures } = {}) {
  if (reading.active) return;
  rememberExplore();
  if (session.mode === 'Observe') session.updateObserve({ readingView: captureGlobeView(), readingMap: worldEvent.spec });
  const ref = entity && { layerId: entity.layerId, key: entity.key, name: entity.name };
  const key = topic ? 'topic:' + topic.id : entity ? 'atlas:' + entity.layerId + ':' + entity.key : null;
  const saved = book ? null : session.readingProgress(key);
  const detail = chapter || saved?.chapter;
  const position = resumePosition || (saved?.chapter === detail ? saved?.position : null);
  if (!session.enterRead({ bookId: book?.id, topicId: topic?.id, entity: ref, detail, position,
    disclosures: resumeDisclosures || (saved?.chapter === detail ? saved?.disclosures : []),
    scroll: saved?.scroll, year: entryYear, source: source || (entity ? { kind: 'summary' } : { kind: 'map' }),
    catalog: !entity && !topic && !book })) return;
  readingTrigger = document.activeElement;
  readingEntryPeers = state.focus?.atlasPeers || [];
  showReader();
  saveSession(true);
}
function validReadingFrame(frame) {
  const book = subjectsById.get(frame.bookId);
  const topic = TOPICS.find(item => item.id === frame.topicId);
  const entity = resolveReadingEntity(frame.entity);
  if (!frame.catalog && !frame.library && (frame.bookId ? !book : frame.topicId ? !topic : !entity)) return null;
  const detail = (book || topic)?.chapters.some(chapter => chapter.id === frame.detail) ? frame.detail : null;
  return { ...frame, bookId: book?.id, topicId: topic?.id, entity: entity ? frame.entity : null,
    detail, position: detail ? frame.position : null };
}
function resumeStoredReading(stored) {
  const valid = validReadingFrame(stored);
  if (!valid || !session.enterRead({ ...valid, trail: stored.trail.map(validReadingFrame).filter(Boolean) })) return;
  readingEntryPeers = state.focus?.atlasPeers || [];
  showReader();
}
function showReader() {
  closeYearControl();
  closeView(false);
  closeWorld();
  pauseGlobe();
  cancelGlobeFly();
  applySheetOffset(sheetDetents().hidden, false);
  bookEl.hidden = false;
  readingBackground(true);
  applyReadingSize();
  renderReading();
  el('reading-title').focus({ preventScroll: true });
}
function hideReader() {
  clearTimeout(readingPositionTimer);
  readingPositionTimer = 0;
  cancelAnimationFrame(readerResizeFrame);
  readerResizeFrame = 0;
  closeFootnote();
  closeReadingDisplay();
  bookEl.hidden = true;
  readingBackground(false);
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
    '<span class="reading-row-copy">' + (timeline ? date : '') + '<strong>' + esc(item.title || item.zh) + '</strong>' +
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
  return '<details class="reading-sources"><summary>来源</summary><ol>' +
    sources.map((s, i) => '<li><a id="reading-source-' + i + '" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + (s.note ? ' · ' + esc(s.note) : '') + ' ↗</a></li>').join('') + '</ol></details>';
}
function referencesMarkup(refs, indices) {
  if (!refs?.length) return '';
  return '<span class="reading-refs">' + refs.map(ref=>{
    const i = indices.get(referenceId(ref));
    const location = [ref.locator,ref.note].filter(Boolean).join(' · ');
    return '<a href="#reading-source-' + i + '" aria-label="查看来源 ' + (i + 1) + '"' +
      (location ? ' data-reference-location="' + esc(location) + '"' : '') + '>[' + (i + 1) + ']</a>';
  }).join(' ') + '</span>';
}
function historyRelationsMarkup(links, sourceList = []) {
  const groups = [
    ['同一时期的世界',['contemporary']], ['历史比较',['compare']], ['历史联系',['documented']],
    ['历史背景与延伸阅读',['context','further','legacy']],
  ];
  const types = {contemporary:'共时',compare:'比较',documented:'有资料支持的联系',context:'历史背景',further:'延伸阅读',legacy:'延伸阅读'};
  const sources = new Map(sourceList.map(item=>[item.id,item]));
  const seen = new Set();
  const rows = links.flatMap(link=>{
    const topic = link.topic || link.topicId;
    const target = link.book ? subjectsById.get(link.book) : TOPICS.find(item=>item.id===topic);
    if (!target) return [];
    const chapterId = link.chapter || link.chapterId;
    const chapter = target.chapters.find(item=>item.id===chapterId);
    const relation = link.relation || 'legacy';
    const group = relation==='legacy' || relation==='further' || relation==='context' ? 'reading' : relation;
    const dedup = [group,target.id,chapter?.id || '',link.display || ''].join(':');
    if (seen.has(dedup)) return [];
    seen.add(dedup);
    const date = link.time ? (link.time.from===link.time.to ? yearLabel(link.time.from) : subjectYears(link.time))
      : chapter?.year ? yearLabel(chapter.year) : subjectYears(chapter || target);
    const attrs = link.book ? ' data-subject-book="' + esc(link.book) + '" data-subject-chapter="' + esc(chapterId || '') + '"'
      : ' data-reading-topic="' + esc(topic) + '" data-reading-chapter="' + esc(chapterId || '') + '"';
    const name = target.title + (chapter ? ' · ' + chapter.title : '');
    const evidence = (link.evidence || []).flatMap(ref=>{
      const src = sources.get(referenceId(ref));
      return src ? ['<li><a href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(src.title) +
        '</a>' + (ref.locator ? ' · ' + esc(ref.locator) : '') + (ref.note ? ' · ' + esc(ref.note) : '') + '</li>'] : [];
    }).join('');
    return [{relation,html:'<li><button type="button" class="reading-card reading-link" data-history-relation="' +
      esc(link.id || '') + '"' + (link.time ? ' data-relation-year="' + esc(link.time.from) + '"' : '') + attrs + '><small>' +
      esc(types[relation] + (date ? ' · ' + date : '')) + '</small><strong>' + esc(name) + '</strong>' +
      (link.display ? '<span>' + esc(link.display) + '</span>' : '') + readingArrow + '</button>' +
      (evidence ? '<details class="relation-evidence"><summary>关系资料</summary><ul>' + evidence + '</ul></details>' : '') + '</li>'}];
  });
  return groups.map(([title,kinds])=>{
    const items = rows.filter(row=>kinds.includes(row.relation)).map(row=>row.html).join('');
    return items ? '<section class="reading-connections"><h2>' + title + '</h2><ul class="history-relations">' + items + '</ul></section>' : '';
  }).join('');
}
function connectionsMarkup(topic, item) {
  return historyRelationsMarkup(item ? (item.connections || []) : (topic.connections || []), (item || topic).sources);
}
function followReadingTopic(topicId, chapterId, trigger) {
  const target = TOPICS.find((t) => t.id === topicId);
  if (!target) return;
  const saved = session.readingProgress('topic:' + target.id);
  const detail = target.chapters.some(chapter => chapter.id === chapterId) ? chapterId : null;
  const position = detail && saved?.chapter === detail ? saved.position : null;
  navigateReading({ catalog: false, library: false, bookId: null, topicId: target.id, detail,
    scroll: saved?.scroll || 0, position, disclosures: position ? saved.disclosures : [], linkEntry: true },trigger);
}
function navigateReading(target, trigger) {
  if (!reading.active) return;
  rememberReading();
  const linkYear = Number(trigger?.dataset.relationYear);
  const year = isHistoryYear(linkYear) ? linkYear : reading.year;
  if (!session.navigateReading({ directory: false, disclosures: [], year, ...target },trigger?.dataset.historyRelation)) return;
  renderReading();
  el('reading-title').focus({preventScroll:true});
  saveSession(true);
}
function openReadingCatalog() {
  if (!reading.catalog) navigateReading({ catalog: true, library: false, bookId: null, topicId: null,
    entity: null, detail: null, catalogContinent: '全部', catalogScroll: 0 });
}
function renderReadingCatalog() {
  const continents = ['全部','亚洲','非洲','欧洲','北美洲','南美洲','大洋洲'];
  const selected = reading.catalogContinent;
  const topics = TOPICS.filter(t => selected === '全部' || t.continents.includes(selected)).sort((a,b)=>a.from-b.from || a.id.localeCompare(b.id));
  const year = y => y < 0 ? '前' + Math.abs(y) : '公元' + y;
  bookBody.innerHTML = '<h1 id="reading-title" tabindex="-1">补充专题资料</h1>' +
    '<nav class="reading-filters" aria-label="按大洲筛选">' + continents.map(c=>'<button type="button" data-reading-continent="'+c+'" aria-pressed="'+(c===selected)+'">'+c+'</button>').join('') + '</nav>' +
    '<p class="when" role="status">'+topics.length+' 组专题</p>' + topics.map(t=>'<button type="button" class="reading-card reading-link" data-reading-topic="'+esc(t.id)+'"><small>'+year(t.from)+'—'+year(t.to)+'</small><strong>'+esc(t.title)+'</strong><span>'+esc(t.summary)+'</span>'+readingArrow+'</button>').join('');
  bookBody.scrollTop = reading.catalogScroll;
}
function setReadingBack(label) {
  readingBack.hidden = !label;
  readingBack.setAttribute('aria-label', label || '返回上一级');
  readingBack.title = label || '返回上一级';
}
function readingHeading(title, meta) {
  return '<h1 id="reading-title" tabindex="-1">' + esc(title) + '</h1><div class="reading-meta"><p class="when">' + esc(meta) + '</p></div>';
}
function renderReadingArticle(topic, items, item) {
  const opening = item.opening?.text || item.summary;
  const references = new Map(item.sources.map((source,index)=>[source.id,index]));
  const body = '<p class="reading-opening" data-block-id="' + esc(item.opening?.id ?? item.openingBlockId) + '">' +
    esc(opening) + referencesMarkup(item.opening?.refs,references) + '</p>' + item.sections.map((s) =>
    '<article><h2>' + esc(s.title) + '</h2><p data-block-id="' + esc(s.id) + '">' + esc(s.text) +
    referencesMarkup(s.refs,references) + '</p></article>').join('');
  const next = items[items.indexOf(item) + 1];
  return '<p class="subject-book-label">' + esc(topic.title) + ' · 第 ' + (items.indexOf(item) + 1) + ' 篇 / 共 ' +
    items.length + ' 篇</p>' + readingHeading(item.opening?.headline || item.title, readingDate(item)) +
    '<p id="reading-progress" class="reading-progress"></p>' + body +
    (scenesByEvent.has(item.mapStory?.worldEntryId) ? sceneButton(scenesByEvent.get(item.mapStory.worldEntryId)) : '') + connectionsMarkup(topic, item) +
    (next ? '<nav class="reading-next"><button type="button" data-reading-detail="' + esc(next.id) + '">下一篇 · ' + esc(next.title) + readingArrow + '</button></nav>' : '') +
    sourcesMarkup(item.sources) + catalogNavigation();
}
function renderReading() {
  if (!reading.active) return;
  cancelAnimationFrame(readerResizeFrame);
  readerResizeFrame = 0;
  const book = reading.subject, topic = reading.topic, item = (book || topic)?.chapters.find(c => c.id === reading.detail);
  const title = reading.library ? '历史书目' : reading.catalog ? '补充专题资料'
    : book?.title || topic?.title || (reading.ent && subjectEntityName(reading.ent)) || '地图资料';
  el('reading-book-name').textContent = title;
  readingLibrary.hidden = reading.library;
  readingDirectory.hidden = !item;
  readingExit.textContent = session.observe ? '返回观察' : reading.source.kind === 'events' ? '返回史事' : '合上';
  readingExit.setAttribute('aria-label', session.observe ? '返回观察' : reading.source.kind === 'events' ? '返回史事' : '合上书卷，返回地球');
  setReadingBack(reading.directory ? '返回正文' : item && !reading.linkEntry ?
    (book ? '返回书卷首页' : '返回专题') : reading.trail.length ? '返回上一级' : '');
  if (reading.catalog) renderReadingCatalog();
  else if (reading.library) renderSubjectLibrary();
  else if (book) bookBody.innerHTML = item ? renderSubjectChapter(book, item) : renderSubjectOutline(book);
  else if (topic && item) bookBody.innerHTML = renderReadingArticle(topic, topic.chapters, item);
  else if (topic) bookBody.innerHTML = readingHeading(topic.title, topic.subtitle) + '<p class="lede">' + esc(topic.summary) + '</p>' +
    readingRows(topic.chapters.map(chapter => readingRow(chapter)), '专题篇目') +
    connectionsMarkup(topic, null) + '<p class="credits">' + esc(topic.scope) + '</p>' + catalogNavigation();
  else bookBody.innerHTML = renderAtlasReading();
  if (item) {
    const details = bookBody.querySelectorAll('details');
    for (const index of reading.disclosures) if (details[index]) details[index].open = true;
    updateReadingLocation();
    const position = reading.position;
    const matched = restoreReadingPosition(position);
    if (!position.blockId && matched?.dataset.blockId) {
      reading.position = session.position({...position, blockId:matched.dataset.blockId});
      const saved = session.readingProgress(readingKey());
      if (saved?.chapter === reading.detail && !saved.position.blockId && saved.position.block === position.block)
        session.updateReadingPosition(readingKey(),reading.detail,{...saved.position,blockId:matched.dataset.blockId},
          saved.scroll,saved.disclosures);
    }
  }
  else bookBody.scrollTop = reading.catalog ? reading.catalogScroll : reading.scroll;
  measureReader();
  updateReadingLocation();
}
function openReadingDetail(id, position = null, { restart = false, sequence = false, disclosures = [] } = {}) {
  if (!reading.active || !(reading.subject || reading.topic)?.chapters.some(chapter => chapter.id === id)) return;
  if (reading.detail === id && !restart) return;
  rememberReading();
  if (reading.directory) session.backReading();
  const previous = session.readingProgress(readingKey());
  if (!restart && !position && previous?.chapter === id) {
    position = previous.position;
    disclosures = previous.disclosures;
  }
  reading.linkEntry = false;
  reading.detail = id;
  reading.position = session.position(position);
  reading.disclosures = disclosures;
  renderReading();
  el('reading-title').focus({ preventScroll: true });
  rememberReading(restart || sequence);
  saveSession(true);
}
function readingIndex() {
  if (!reading.active || !reading.detail) return;
  const selected = reading.detail;
  navigateReading({ detail: null, directory: true, scroll: 0, position: null });
  const row = [...bookBody.querySelectorAll('[data-reading-detail]')].find(button =>
    button.dataset.readingDetail === selected && button.closest('ol'));
  row?.focus();
}
function readingGoBack() {
  if (!reading.active || closeTopNavigationPanel()) return;
  rememberReading();
  if (reading.trail.length && (reading.directory || reading.linkEntry || !reading.detail)) session.backReading();
  else if (reading.detail) {
    reading.detail = null;
    reading.scroll = 0;
    reading.position = session.position();
  } else { closeReader(); return; }
  renderReading();
  const relation = reading.returnFocus && [...bookBody.querySelectorAll('[data-history-relation]')]
    .find(button=>button.dataset.historyRelation===reading.returnFocus);
  (relation || (reading.detail ? readingDirectory : el('reading-title'))).focus({ preventScroll: true });
  delete reading.returnFocus;
  saveSession(true);
}
function closeReader() {
  if (!reading.active || closeTopNavigationPanel()) return;
  rememberReading();
  const source = reading.source;
  session.exitRead();
  hideReader();
  if (session.mode === 'Observe') resumeEventMap();
  else {
    restoreExploreView();
    if (source.kind === 'events') restoreWorldSource(source);
    else {
      const fallback = state.focus ? el('sheet-toc') : canvas;
      const trigger = readingTrigger?.isConnected && readingTrigger !== document.body ? readingTrigger : fallback;
      trigger.focus({ preventScroll: true });
    }
  }
  readingTrigger = null;
  readingEntryPeers = [];
  syncSheetIdentity();
  invalidate();
  saveSession(true);
}
function handleReadingKey(event) {
  if (!reading.active) return false;
  if (event.key !== 'Tab') return true;
  const scope = footnoteTrigger ? el('footnote-popover') : bookEl;
  const items = [...scope.querySelectorAll('button:not(:disabled), [tabindex="0"], a[href], summary')]
    .filter(node => node.getClientRects().length && !node.closest('[inert]'));
  const first = items[0], last = items[items.length - 1], active = document.activeElement;
  if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
  return true;
}
let footnoteTrigger = null;
function closeFootnote(restoreFocus = false) {
  if (!footnoteTrigger) return;
  el('footnote-popover').hidden = true;
  el('footnote-shade').hidden = true;
  bookEl.inert = false;
  if (restoreFocus && footnoteTrigger?.isConnected) footnoteTrigger.focus({ preventScroll: true });
  footnoteTrigger = null;
}
function openFootnote(link) {
  const source = bookBody.querySelector(link.getAttribute('href'));
  if (!source) return false;
  el('footnote-heading').textContent = '史料与注释 · ' + link.textContent.trim();
  footnoteTrigger = link;
  el('footnote-text').textContent = source.textContent.replace(/\s*↗\s*$/, '') +
    (link.dataset.referenceLocation ? ' · ' + link.dataset.referenceLocation : '');
  el('footnote-link').href = source.href;
  el('footnote-shade').hidden = el('footnote-popover').hidden = false;
  bookEl.inert = true;
  el('footnote-close').focus({ preventScroll: true });
  return true;
}
el('footnote-close').addEventListener('click', () => closeFootnote(true));
el('footnote-shade').addEventListener('click', () => closeFootnote(true));
bookBody.addEventListener('click', (event) => {
  const ref = event.target.closest('a[href^="#reading-source-"]');
  if (ref && openFootnote(ref)) event.preventDefault();
});

bookBody.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-reading-detail')) openReadingDetail(b.dataset.readingDetail, null, {
    restart: b.hasAttribute('data-reading-restart'), sequence: b.hasAttribute('data-reading-sequence'),
  });
  else if (b.hasAttribute('data-reading-topic')) followReadingTopic(b.dataset.readingTopic, b.dataset.readingChapter,b);
  else if (b.hasAttribute('data-reading-catalog')) openReadingCatalog();
  else if (b.hasAttribute('data-reading-continent')) {
    reading.catalogContinent = b.dataset.readingContinent;
    reading.catalogScroll = 0;
    renderReading();
    bookBody.querySelector('[data-reading-continent="' + reading.catalogContinent + '"]').focus({preventScroll:true});
  }
  else if (b.hasAttribute('data-reading-index')) readingIndex();
  else handleSubjectButton(b);
});

function updateReadingLocation() {
  const label = el('reading-progress');
  if (!label) return;
  const extent = bookBody.scrollHeight - bookBody.clientHeight;
  const percent = extent > 1 ? Math.min(100, Math.round(bookBody.scrollTop * 100 / extent)) : 0;
  label.textContent = (reading.topic ? '本篇' : '本章') + '阅读位置 ' + percent + '%';
}
function applyReadingSize() {
  bookEl.dataset.size = readingSize;
  for (const option of readingSizes) option.setAttribute('aria-pressed', String(option.dataset.readingSize === readingSize));
}
function closeReadingDisplay(restoreFocus = false) {
  if (readingDisplay.hidden) return false;
  readingDisplay.hidden = true;
  readingSettings.setAttribute('aria-expanded', 'false');
  if (restoreFocus) readingSettings.focus({ preventScroll: true });
  return true;
}
readingSettings.addEventListener('click', () => {
  if (closeReadingDisplay(true)) return;
  readingDisplay.hidden = false;
  readingSettings.setAttribute('aria-expanded', 'true');
  readingDisplay.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
});
readingDisplay.addEventListener('click', event => {
  const option = event.target.closest('[data-reading-size]');
  if (!option || option.dataset.readingSize === readingSize) return;
  const position = reading.detail ? captureReadingPosition() : null;
  readingSize = option.dataset.readingSize;
  applyReadingSize();
  if (position) { restoreReadingPosition(position); measureReader(); rememberReading(); saveSession(true); }
  updateReadingLocation();
  try { localStorage.setItem(readingDisplayKey, readingSize); } catch {}
});
bookEl.addEventListener('pointerdown', event => {
  if (!readingDisplay.contains(event.target) && !readingSettings.contains(event.target)) closeReadingDisplay();
});
readingBack.addEventListener('click', readingGoBack);
readingExit.addEventListener('click', closeReader);
readingDirectory.addEventListener('click', readingIndex);
readingLibrary.addEventListener('click', () => followSubject({ library: true }));

bookBody.addEventListener('scroll', () => {
  if (!reading.active || readerResizeFrame) return;
  if (readerSizeChanged()) { reflowReading(); return; }
  if (reading.detail) reading.position = captureReadingPosition();
  if (!readingPositionTimer) readingPositionTimer = setTimeout(() => {
    rememberReading();
    updateReadingLocation();
    saveSession();
  }, 100);
}, { passive: true });
bookBody.addEventListener('toggle', event => {
  if (reading.active && reading.detail && event.target.matches('details')) { rememberReading(); saveSession(); }
}, true);
function reflowReading() {
  if (!reading.active || !readerSizeChanged()) return;
  if (!reading.detail) { measureReader(); return; }
  const position = reading.position, detail = reading.detail;
  cancelAnimationFrame(readerResizeFrame);
  readerResizeFrame = requestAnimationFrame(() => {
    readerResizeFrame = 0;
    if (reading.active && reading.detail === detail) {
      restoreReadingPosition(position);
      measureReader();
      rememberReading();
      saveSession();
    }
    updateReadingLocation();
  });
}
addEventListener('resize', reflowReading);
new ResizeObserver(reflowReading).observe(bookBody);
