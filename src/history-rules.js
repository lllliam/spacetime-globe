/* Shared by the content validator and both browser builds. */
const isHistoryYear = year => Number.isSafeInteger(year) && year !== 0;
const historyIncludes = (range, year) => isHistoryYear(year) && range?.from != null && year >= range.from &&
  (range.to === null || year <= range.to);
const historyOverlaps = (a, b) => a.from != null && b.from != null &&
  a.from <= (b.to ?? Infinity) && b.from <= (a.to ?? Infinity);
const referenceId = ref => typeof ref === 'string' ? ref : ref?.sourceId;

function observationFrame(scene, step) {
  const select = (items, ids) => ids === undefined ? items : items.filter(item => ids.includes(item.id));
  const places = select(scene.places || [],step?.places).map(place=>step?.placeNotes?.[place.id]
    ? {...place,...step.placeNotes[place.id]} : place);
  const active = new Set(places.map(place => place.id));
  const routes = select(scene.routes || [], step?.routes).filter(route => route.precision !== 'legacy' &&
    [route.from, route.to].every(end => Array.isArray(end) || active.has(end)));
  return {year:step?.year ?? scene.year, places, routes, focusPolities:step?.focusPolities ?? scene.focusPolities ?? []};
}

function recommendChapters(book, year) {
  let priority = -Infinity;
  let matches = [];
  for (const chapter of book.chapters) {
    const rule = chapter.recommendation;
    if (rule === false || !rule && chapter.kind && chapter.kind !== 'narrative' ||
        !historyIncludes(rule?.range ?? chapter, year)) continue;
    const score = rule?.priority ?? 0;
    if (score > priority) { priority = score; matches = []; }
    if (score === priority) matches.push(chapter);
  }
  return matches;
}

if (typeof module === 'object' && module.exports) {
  module.exports = { isHistoryYear, historyIncludes, historyOverlaps, referenceId, recommendChapters, observationFrame };
}
