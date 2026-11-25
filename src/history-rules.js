/* Shared by the content validator and both browser builds. */
const isHistoryYear = year => Number.isSafeInteger(year) && year !== 0;
const historyIncludes = (range, year) => isHistoryYear(year) && range?.from != null && year >= range.from &&
  (range.to === null || year <= range.to);
const historyOverlaps = (a, b) => a.from != null && b.from != null &&
  a.from <= (b.to ?? Infinity) && b.from <= (a.to ?? Infinity);
const referenceId = ref => typeof ref === 'string' ? ref : ref?.sourceId;

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
  module.exports = { isHistoryYear, historyIncludes, historyOverlaps, referenceId, recommendChapters };
}
