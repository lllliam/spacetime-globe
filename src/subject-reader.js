const subjectBooks = JSON.parse(inlineText('subject-books'));
const historicalScenes = new Map(JSON.parse(inlineText('historical-scenes')).map(scene => [scene.id, scene]));
const subjectsById = new Map(subjectBooks.map((book) => [book.id, book]));
const bindingsByMapObject = new Map(JSON.parse(inlineText('history-map-bindings')));

function historyBindingsFor(entity, year) {
  if (!entity) return [];
  const key = entity.kind === 'polity' ? 'polity:' + entity.name : 'country:' + entity.iso;
  return (bindingsByMapObject.get(key) || []).filter(([,from,to]) => historyIncludes({from,to},year));
}
function subjectBookForEntity(entity, year = state.year) {
  const binding = historyBindingsFor(entity,year).find(row=>row[3]==='primary');
  return binding ? subjectsById.get(binding[0]) : null;
}

function politySelectionsAt(point, primaryId) {
  if (!point || state.layerId !== 'polity') return [];
  const peers = new Set();
  probeCtx.save();
  probeCtx.setTransform(1, 0, 0, 1, 0, 0);
  for (const shape of [...partition.shapes].reverse()) {
    const id = shape.ent.id;
    if (id === primaryId || peers.has(id)) continue;
    const polygon = polityShape(pk, shape.pathId);
    if (probeCtx.isPointInPath(polygon.path, point.x, point.y, 'evenodd')) peers.add(id);
    if (peers.size === 5) break;
  }
  probeCtx.restore();
  return [...peers];
}

function subjectYears({ from, to, dateLabel }) {
  if (dateLabel) return dateLabel;
  if (from == null) return '年代待考';
  const year = (y) => y < 0 ? '公元前 ' + -y : String(y);
  if (from === to) return year(from) + ' 年';
  return year(from) + (to == null ? ' 年至今' : '—' + year(to) + ' 年');
}

function subjectEntityName(entity) {
  if (entity.kind !== 'polity') return entity.name;
  return polityNames.get(entity.name)
    || polityRelations.get(entity.name)?.description
    || (polityRelations.has(entity.name) ? '历史关系记录' : '中文名待考 · ' + (entity.entId + 1));
}

function subjectSheetMarkup(entity) {
  const book = subjectBookForEntity(entity);
  if (book) return '<p class="subject-sheet-summary">' + esc(book.summary) + '</p>';
  const source = historyMapSources[entity.kind === 'polity' ? 'polity' : 'country'];
  return '<p class="subject-sheet-summary map-sheet-summary">仅有地图资料。 ' +
    '<a href="' + esc(source.source) + '" target="_blank" rel="noopener noreferrer">' + esc(source.name) + ' ↗</a></p>';
}

function savedSubjectProgress(book) {
  if (!book) return null;
  const saved = session.readingProgress('subject:' + book.id);
  return saved && book.chapters.some(chapter => chapter.id === saved.chapter) ? saved : null;
}

function subjectChapterButton(id, label, attributes = '') {
  return '<button type="button" data-reading-detail="' + esc(id) + '"' + attributes + '>' + esc(label) + readingArrow + '</button>';
}

function subjectNeighbors() {
  if (!reading.ent) return '';
  const currentBook = reading.subject?.id;
  const seen = new Set();
  const candidates = readingEntryPeers.filter((id) => id !== reading.ent.entId)
    .map((id) => entityByKey('polity', id)).filter(Boolean).flatMap((entity) => {
      const linked = subjectBookForEntity(entity, reading.year);
      const key = linked?.id ?? entity.entId;
      if (linked?.id && linked.id === currentBook || seen.has(key)) return [];
      seen.add(key);
      return [{ entity, label: linked?.title || subjectEntityName(entity) }];
    });
  if (!candidates.length) return '';
  return '<details class="subject-secondary"><summary>地图上重叠的主体</summary>' +
    '<p class="reading-note">这些轮廓在入口处重叠，范围与关系取决于地图资料。</p>' +
    '<nav class="reading-next">' + candidates.map(({ entity, label }) => '<button type="button" data-atlas-entity="' +
      entity.entId + '">' + esc(label) + readingArrow + '</button>').join('') + '</nav></details>';
}

function renderAtlasReading() {
  const entity = reading.ent;
  const title = subjectEntityName(entity);
  const history = entity.kind === 'polity';
  const isRelation = history && polityRelations.has(entity.name);
  const source = historyMapSources[history ? 'polity' : 'country'];
  return '<div class="atlas-reading">' + readingHeading(title, (isRelation ? '历史关系 · ' : '地图资料 · ') + yearLabel(reading.year)) +
    '<p class="lede">' + (isRelation ? '这是底图中的双边或联合关系记录，不作为独立政权主体。' : '这个主体的历史正文尚未收录。') + '</p>' +
    '<p class="reading-note">' + (history ? '疆域资料记录于 ' + esc(subjectYears(entity)) + '。覆盖年代取决于底图资料。'
      : '这里使用现代国界定位。历史政权可在对应年代的历史疆域视图中查找。') + '</p>' +
    (history && !polityNames.has(entity.name)
      ? '<details class="subject-secondary"><summary>底图原名</summary><p>' + esc(entity.name) + '</p></details>' : '') +
    relatedMapReading() + subjectNeighbors() +
    sourcesMarkup([{title:(history ? '历史疆域' : '现代参考边界') + ' · ' + source.name,url:source.source}]) + '</div>';
}

function relatedMapReading(currentBook) {
  const related = historyBindingsFor(reading.ent,reading.year).filter(([bookId,,,relation]) => relation==='related' && bookId!==currentBook);
  if (!related.length) return '';
  return '<section class="reading-connections"><h2>相关历史</h2>' + related.map(([bookId,,,,scope,chapter]) =>
    '<button type="button" class="reading-link" data-subject-book="' + esc(bookId) +
    '" data-subject-chapter="' + esc(chapter || '') + '"><strong>' + esc(subjectsById.get(bookId).title) +
    '</strong><span>' + esc(scope) + '</span>' + readingArrow + '</button>').join('') + '</section>';
}
function editorialNoticeMarkup(item) {
  return item.editorialNotice ? '<details class="subject-secondary"><summary>叙事范围与资料</summary><p>' +
    esc(item.editorialNotice) + '</p></details>' : '';
}

function renderSubjectOutline(book) {
  const recommended = recommendChapters(book,reading.year);
  const anchor = recommended.length === 1 ? recommended[0] : null;
  const scope = historyBindingsFor(reading.ent,reading.year).find(row=>row[0]===book.id && row[3]==='primary')?.[4];
  const progress = savedSubjectProgress(book);
  const current = reading.directory ? reading.trail.at(-1)?.detail : null;
  return '<div class="reading-cover">' + readingHeading(book.title, subjectYears(book)) + '<p class="lede">' + esc(book.summary) + '</p>' +
    (scope ? '<p class="reading-note">' + esc(scope) + '</p>' : '') +
    editorialNoticeMarkup(book) +
    '<nav class="reading-next subject-entry-actions" aria-label="开始阅读">' +
    (progress ? '<button type="button" class="reading-primary" data-subject-resume>继续阅读</button>' : '') +
    subjectChapterButton(book.chapters[0].id, '从头读', progress ? ' data-reading-restart' : ' class="reading-primary" data-reading-restart') +
    '</nav>' + (anchor ? '<button type="button" class="reading-entry-year" data-reading-detail="' + esc(anchor.id) + '">' +
      esc(yearLabel(reading.year) + '对应章节 · ' + anchor.title) + readingArrow + '</button>' :
      recommended.length ? '<p class="reading-note">' + esc(yearLabel(reading.year)) + '有多章相关，见目录标记。</p>' : '') +
    '</div><section class="subject-outline" aria-labelledby="reading-index-title"><h2 id="reading-index-title">章节目录</h2>' +
    '<ol class="reading-list">' + book.chapters.map((chapter, index) => {
      const active = chapter.id === current;
      const status = [active ? '正在阅读' : '', recommended.includes(chapter) ? '入口年份' : '',
        chapter.id === progress?.chapter ? '上次读到' : ''].filter(Boolean).join(' · ');
      return '<li><button type="button" class="reading-row reading-card" data-reading-detail="' + esc(chapter.id) + '"' +
        (active ? ' aria-current="location"' : '') + '><span class="chapter-number" aria-hidden="true">' +
        String(index + 1).padStart(2, '0') + '</span><span class="reading-row-copy"><strong>' + esc(chapter.title) + '</strong>' +
        (status ? '<span class="chapter-status">' + esc(status) + '</span>' : '') + '</span><small>' +
        esc(subjectYears(chapter)) + '</small></button></li>';
    }).join('') + '</ol></section>' + relatedMapReading(book.id) + subjectNeighbors();
}

function sceneButton(scene, stageId) {
  const stage = scene.steps.find(item=>item.id===stageId);
  const date = stage ? stage.dateLabel || yearLabel(stage.year) : scene.dateLabel ||
    (scene.from!==undefined && scene.from!==scene.to ? subjectYears(scene) : yearLabel(scene.year));
  return '<figure class="scene-plate"><figcaption><strong>' + esc(scene.title) + '</strong><small>' +
    esc(date) + '</small><p>' + esc(scene.question) + '</p></figcaption>' +
    '<button type="button" class="subject-scene" data-subject-scene="' + esc(scene.id) +
    '"' + (stageId ? ' data-scene-stage="' + esc(stageId) + '"' : '') +
    ' aria-label="' + esc('在地球上观察 · ' + scene.title) + '">在地球上观察' + readingArrow + '</button></figure>';
}

function decorateParagraphPlaces(text, links) {
  const positions = links.map(link => ({...link,index:text.indexOf(link.text)})).sort((a,b)=>a.index-b.index);
  let output = '', cursor = 0;
  for (const link of positions) {
    if (link.index < cursor) continue;
    output += esc(text.slice(cursor,link.index)) + '<button type="button" class="inline-place" data-pin-scene="' + esc(link.sceneId) +
      '" data-pin-place="' + esc(link.placeId) + '"' +
      (link.stageId ? ' data-scene-stage="' + esc(link.stageId) + '"' : '') +
      ' aria-label="' + esc('在地球上定位 · ' + link.text) + '">' + esc(link.text) + '</button>';
    cursor = link.index + link.text.length;
  }
  return output + esc(text.slice(cursor));
}

function subjectBlockAttributes(block) {
  return ' data-block-id="' + esc(block.id) + '"' +
    (block.previousFingerprint ? ' data-previous-fingerprint="' + esc(block.previousFingerprint) + '"' : '');
}

function renderSubjectChapter(book, chapter) {
  const index = book.chapters.indexOf(chapter);
  const next = book.chapters[index + 1];
  const previous = book.chapters[index - 1];
  const scenes = (chapter.sceneRefs || []).flatMap(ref => {
    const scene = historicalScenes.get(ref.id);
    return scene?.status==='available' ? [{...ref,scene}] : [];
  });
  const refs = [...new Set(chapter.paragraphs.flatMap(p=>[...p.refs,...(p.callout?.refs || [])]).map(referenceId))];
  const references = new Map(refs.map((id, i) => [id,i]));
  const bookSources = new Map(book.sources.map(source=>[source.id,source]));
  const sources = refs.map(id=>bookSources.get(id));
  for (const {scene} of scenes) sources.push(...scene.sources);
  const placeLinks = scenes.flatMap(ref=>(ref.placeLinks || []).map(link=>({...link,sceneId:ref.id,
    stageId:link.stageId || ref.stageId || ref.scene.steps.find(step=>observationFrame(ref.scene,step).places.some(place=>place.id===link.placeId))?.id})));
  const relations = historyRelationsMarkup([...(chapter.contemporaries || []),...(chapter.related || [])],book.sources);
  return '<p class="subject-book-label">' + esc(book.title) + ' · 第 ' + (index + 1) + ' 章 / 共 ' + book.chapters.length + ' 章</p>' +
    readingHeading(chapter.title, subjectYears(chapter)) +
    '<p id="reading-progress" class="reading-progress"></p>' +
    '<article class="subject-prose">' + chapter.paragraphs.map(paragraph => {
      const headingHtml = paragraph.heading
        ? '<h2 class="subject-section-heading">' + esc(paragraph.heading) + '</h2>'
        : '';
      const calloutHtml = paragraph.callout
        ? '<aside class="subject-callout"' + subjectBlockAttributes(paragraph.callout) + '><small>' + esc(paragraph.callout.label) + '</small>' +
          (paragraph.callout.title ? '<strong>' + esc(paragraph.callout.title) + '</strong>' : '') +
          '<p>' + esc(paragraph.callout.text) + referencesMarkup(paragraph.callout.refs,references) + '</p></aside>'
        : '';
      const bodyHtml = decorateParagraphPlaces(paragraph.text, placeLinks.filter(link=>link.blockId===paragraph.id));
      return headingHtml +
        '<p' + subjectBlockAttributes(paragraph) + '>' + bodyHtml + referencesMarkup(paragraph.refs,references) + '</p>' +
        calloutHtml +
        scenes.filter(ref => ref.afterBlockId === paragraph.id).map(ref => sceneButton(ref.scene,ref.stageId)).join('');
    }).join('') + '</article>' +
    '<nav class="reading-next subject-chapter-next" aria-label="连续阅读">' +
    (next ? subjectChapterButton(next.id, '下一章 · ' + next.title, ' class="reading-primary" data-reading-sequence')
      : '<p>已到书卷末尾</p><button type="button" data-reading-index>返回目录' + readingArrow + '</button>') +
    (previous ? subjectChapterButton(previous.id, '上一章 · ' + previous.title) : '') + '</nav>' +
    (chapter.spatialThesis ? '<details class="subject-secondary"><summary>空间线索</summary><p data-block-id="' +
      esc(chapter.spatialThesisId) + '">' + esc(chapter.spatialThesis) + '</p></details>' : '') +
    relations +
    editorialNoticeMarkup(chapter) +
    sourcesMarkup(sources);
}

function renderSubjectLibrary() {
  bookBody.innerHTML = '<h1 id="reading-title" tabindex="-1">历史书目</h1>' + catalogNavigation() +
    subjectBooks.map((book) => '<button class="reading-card reading-link" type="button" data-subject-book="' + esc(book.id) +
      '"><small>' + esc(subjectYears(book)) + '</small><strong>' + esc(book.title) + '</strong>' + readingArrow + '</button>').join('');
  bookBody.scrollTop = reading.scroll;
}

function followSubject({ book = null, chapter = null, entity = null, library = false } = {}, trigger) {
  const ref = entity && { layerId: entity.layerId, key: entity.key, name: entity.name };
  navigateReading({ entity: ref, bookId: book?.id, topicId: null, detail: chapter?.id,
    library, catalog: false, scroll: 0, position: null, linkEntry: true },trigger);
}

function handleSubjectButton(button) {
  if (button.hasAttribute('data-subject-resume')) {
    const saved = session.readingProgress(readingKey());
    if (saved) openReadingDetail(saved.chapter, saved.position, { disclosures: saved.disclosures });
  } else if (button.hasAttribute('data-subject-book')) {
    const book = subjectsById.get(button.dataset.subjectBook);
    if (book) followSubject({ book, chapter: book.chapters.find((c) => c.id === button.dataset.subjectChapter) },button);
  } else if (button.hasAttribute('data-atlas-entity')) {
    const entity = entityByKey('polity', Number(button.dataset.atlasEntity));
    if (entity) followSubject({ entity, book: subjectBookForEntity(entity, reading.year) });
  } else if (button.hasAttribute('data-subject-scene')) {
    const chapter = reading.subject?.chapters.find((c) => c.id === reading.detail);
    const id = button.dataset.subjectScene;
    const article = reading.topic?.chapters.find(item=>item.id===reading.detail);
    const topical = article?.mapStory && scenesByEvent.get(article.mapStory.worldEntryId);
    if (chapter?.sceneRefs?.some(ref => ref.id === id) || topical?.id===id)
      openReadingScene(historicalScenes.get(id),button,{initialStageId:button.dataset.sceneStage});
  } else if (button.hasAttribute('data-pin-scene')) {
    const sc = historicalScenes.get(button.dataset.pinScene);
    if (sc) openReadingScene(sc,button,{initialPlaceId:button.dataset.pinPlace,initialStageId:button.dataset.sceneStage});
  }
}
