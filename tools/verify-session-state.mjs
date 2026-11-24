import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/session-state.js', import.meta.url), 'utf8');
const createSession = runInNewContext(source + '\ncreateSession', {
  YMIN: -3500, YMAX: 2026, document: { addEventListener() {} }, addEventListener() {},
});
const create = () => createSession({ minYear: -3500, maxYear: 2026 });
const clean = value => JSON.parse(JSON.stringify(value));
const camera = { yaw: -1.2, tilt: .4, zoom: 2, panX: 30, panY: -15 };
const map = { year: 1500, camera, layerId: 'polity', followTime: true,
  selection: { layerId: 'polity', key: 28, name: 'Ming Dynasty', point: { x: 810, y: 159 }, shapeId: 59 } };
const ming = { bookId: 'ming', detail: 'two-capitals', year: 1460, source: { kind: 'summary' } };
const anchored = { top: 360, block: 'abc123', index: 3, offset: .42 };

const state = create();
assert.equal(state.mode, 'Explore');
state.updateExplore(map);
assert.equal(state.enterRead(ming), true);
assert.equal(state.enterRead({ bookId: 'qing' }), false);
state.updateReadingPosition('subject:ming', ming.detail, anchored, 24);
assert.equal(state.navigateReading({ bookId: 'qing', detail: 'reforms' }), true);
assert.equal(state.navigateReading({ bookId: 'qing', detail: 'reforms' }), false);
state.updateReadingPosition('subject:qing', 'reforms', { top: 540 });
assert.equal(state.read.trail[0].bookId, 'ming');
assert.equal(state.backReading(), true);
assert.equal(state.backReading(), false);
assert.equal(state.read.bookId, 'ming');
assert.equal(state.read.year, 1460);
assert.equal(state.enterObserve({ kind: 'scene', id: 'yongle-capitals', year: 1421 }), true);
assert.equal(state.enterObserve({ id: 'duplicate' }), false);
state.updateObserve({ year: 1411, phase: 0, place: 'qingjiangpu' });
state.updateExplore({ year: 1411 });
assert.equal(state.observe.year, 1411);
assert.equal(state.observe.phase, 0);
const duringScene = clean(state.serialize());
assert.equal(duringScene.mode, 'Read');
assert.equal(duringScene.explore.year, 1500);
assert.equal(duringScene.read.year, 1460);
assert.equal(duringScene.observe, undefined);
assert.equal(duringScene.explore.selection.shapeId, undefined);
assert.deepEqual(duringScene.progress.find(([key]) => key === 'subject:ming')[1].position, anchored);
assert.equal(state.returnFromObserve().place, 'qingjiangpu');
assert.equal(state.returnFromObserve(), null);
assert.equal(state.exitRead(), true);
assert.equal(state.exitRead(), false);
assert.equal(state.mode, 'Explore');
assert.deepEqual(clean(state.explore.camera), camera);

const events = { kind: 'events', year: 1500, eventId: 'i-001', action: 'map', scroll: 250, disclosures: [false, true] };
state.enterObserve({ kind: 'event', id: events.eventId, year: 1499, source: state.source(events) });
assert.equal(state.serialize().mode, 'Explore');
assert.equal(state.enterRead(ming), true);
assert.equal(state.mode, 'Read');
assert.equal(state.exitRead(), true);
assert.equal(state.mode, 'Observe');
assert.deepEqual(clean(state.returnFromObserve().source), events);
assert.equal(state.mode, 'Explore');

const restored = create().restore(duringScene);
assert.equal(restored.read.bookId, 'ming');
assert.equal(restored.read.detail, 'two-capitals');
assert.equal(restored.explore.selection.name, 'Ming Dynasty');
for (const invalid of [undefined, {}, { schemaVersion: 999 }]) assert.equal(create().restore(invalid), null);
const corrupt = create().restore({ schemaVersion: 1, mode: 'Read',
  explore: { year: 0, layerId: 'other', camera: { yaw: 'bad', tilt: null, zoom: -1, panY: Infinity },
    selection: { layerId: 'polity', key: -5 } },
  read: { year: 0, bookId: 10, detail: {}, position: { top: -9, block: 1 }, trail: Array(60).fill(null) } });
assert.equal(corrupt.explore.year, 2026);
assert.equal(corrupt.explore.layerId, 'country');
assert.equal(corrupt.explore.selection, null);
assert.deepEqual(clean(corrupt.explore.camera), { yaw: -1.42, tilt: .30, zoom: 1, panX: 0, panY: 0 });
assert.equal(corrupt.read.bookId, null);
assert.equal(corrupt.read.detail, null);
assert.equal(corrupt.read.position.top, 0);
assert.equal(corrupt.read.trail.length, 24);
assert.equal(state.validYear(0), false);
assert.equal(state.validYear(-1), true);
assert.equal(state.validYear(1), true);
console.log('Session state: transitions, independent years, return targets, progress, schema and invalid values passed.');
