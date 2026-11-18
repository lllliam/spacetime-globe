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

const relations = [
  [/^Alliance between (.+) and (.+)$/, (a, b) => a + '与' + b + '的同盟'],
  [/^Personal union of (.+) with (.+)$/, (a, b) => a + '与' + b + '的共主邦联'],
  [/^Allegiance of (.+) to (.+)$/, (a, b) => a + '向' + b + '效忠'],
  [/^Vassalage of (.+) to (.+)$/, (a, b) => a + '臣属于' + b],
];

export function loadPolityNames(root) {
  const ids = readPolityIds(root);
  const aliases = new Map(Object.entries(JSON.parse(readFileSync(join(root, 'data/polity-zh.json'), 'utf8'))));
  for (const [original, label] of aliases) {
    if (!ids.has(original) || typeof label !== 'string' || !/\p{Script=Han}/u.test(label) || /\p{Script=Latin}/u.test(label)) {
      throw new Error('历史地图中文名称无效：' + original);
    }
  }

  const names = new Map(aliases);
  for (const original of ids.keys()) {
    if (names.has(original)) continue;
    for (const [pattern, format] of relations) {
      const match = original.match(pattern);
      if (!match) continue;
      const [, first, second] = match;
      if (aliases.has(first) && aliases.has(second)) {
        names.set(original, format(aliases.get(first), aliases.get(second)));
      }
      break;
    }
  }
  return {names, total: ids.size, direct: aliases.size};
}
