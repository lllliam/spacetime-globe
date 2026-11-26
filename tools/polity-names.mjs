import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export function readPolityIds(root) {
  const pack = readFileSync(join(root, 'data/polity.bin'));
  const ids = new Map();
  let offset = pack.readUInt32LE(16);
  for (let id = 0; id < pack.readUInt32LE(4); id++) {
    const length = pack.readUInt16LE(offset);
    const name = pack.toString('utf8', offset + 2, offset + 2 + length);
    if (ids.has(name)) throw new Error('疆域数据出现重名：' + name);
    ids.set(name, id);
    offset += length + 6;
  }
  return ids;
}

export function readPolityRanges(root) {
  const pack = readFileSync(join(root, 'data/polity.bin'));
  const ranges = new Map();
  let offset = pack.readUInt32LE(16);
  for (let id = 0; id < pack.readUInt32LE(4); id++) {
    const length = pack.readUInt16LE(offset);
    const end = offset + 2 + length;
    const name = pack.toString('utf8', offset + 2, end);
    ranges.set(name, { from: pack.readInt16LE(end), to: pack.readInt16LE(end + 2) });
    offset = end + 4;
  }
  return ranges;
}

const relationPatterns = [
  ['alliance', /^Alliance between (.+) and (.+)$/, (a, b) => a + '与' + b + '的同盟'],
  ['personal-union', /^Personal union of (.+) with (.+)$/, (a, b) => a + '与' + b + '的共主邦联'],
  ['allegiance', /^Allegiance of (.+) to (.+)$/, (a, b) => a + '向' + b + '效忠'],
  ['vassalage', /^Vassalage of (.+) to (.+)$/, (a, b) => a + '臣属于' + b],
];

export function matchPolityRelation(original) {
  for (const [kind, pattern, format] of relationPatterns) {
    const match = original.match(pattern);
    if (match) return { kind, source: match[1], target: match[2], format };
  }
  return null;
}

export function loadPolityNames(root) {
  const ids = readPolityIds(root);
  const aliases = new Map(Object.entries(JSON.parse(readFileSync(join(root, 'data/polity-zh.json'), 'utf8'))));
  for (const [original, label] of aliases) {
    if (!ids.has(original) || typeof label !== 'string' || !/\p{Script=Han}/u.test(label) || /\p{Script=Latin}/u.test(label) || matchPolityRelation(original)) {
      throw new Error('历史地图中文名称无效：' + original);
    }
  }

  const names = new Map(aliases);
  const relations = new Map();
  for (const original of ids.keys()) {
    const rel = matchPolityRelation(original);
    if (!rel) continue;
    const sourceZh = aliases.get(rel.source) || null;
    const targetZh = aliases.get(rel.target) || null;
    relations.set(original, {
      kind: rel.kind,
      source: rel.source,
      target: rel.target,
      description: sourceZh && targetZh ? rel.format(sourceZh, targetZh) : null,
    });
  }
  return {names, relations, total: ids.size, direct: aliases.size};
}
