/* ═══════════════════════════════════════════════════════════════
   地球仪 · 时空坐标 —— 单文件应用（零依赖）
   数据：内嵌 atlas（1512 条年表 / 105 个地区 / 177 块现代国界）
   渲染：WebGL 球体（正投影），无 WebGL 时退回 Canvas2D
   ═══════════════════════════════════════════════════════════════ */
(() => {
'use strict';

/* ───────────── 0. 数据 ───────────── */
const ATLAS = JSON.parse(document.getElementById('atlas').textContent);
const RELIEF_SRC = 'data:image/jpeg;base64,' +
  document.getElementById('relief').textContent.replace(/[^A-Za-z0-9+/=]/g, '');

const TAU = Math.PI * 2;
const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);
const lerp = (a, b, t) => a + (b - a) * t;

/* ───────────── 1. 时间刻度 ───────────── */
const THIS_YEAR = new Date().getFullYear();
const YMAX = Math.max(2026, THIS_YEAR);
const YMIN = -3500;

const CH = [
  { n: '史前',   a: -3500, b: -800, w: .190 },
  { n: '古代',   a: -800,  b: 500,  w: .213 },
  { n: '古典',   a: 500,   b: 1000, w: .130 },
  { n: '中世纪', a: 1000,  b: 1500, w: .175 },
  { n: '大航海', a: 1500,  b: 1800, w: .138 },
  { n: '工业',   a: 1800,  b: 1900, w: .077 },
  { n: '现代',   a: 1900,  b: YMAX, w: .077 },
];
const cum = (() => { const out = []; let s = 0; for (const c of CH) { out.push(s); s += c.w; } return out; })();

function posOfYear(y) {
  y = clamp(y, YMIN, YMAX);
  for (let i = 0; i < CH.length; i++) {
    const c = CH[i];
    if (y <= c.b || i === CH.length - 1) {
      return cum[i] + clamp((y - c.a) / (c.b - c.a), 0, 1) * c.w;
    }
  }
  return 1;
}
function yearOfPos(p) {
  p = clamp(p, 0, 1);
  for (let i = 0; i < CH.length; i++) {
    const c = CH[i];
    if (p <= cum[i] + c.w || i === CH.length - 1) {
      return Math.round(c.a + clamp((p - cum[i]) / c.w, 0, 1) * (c.b - c.a));
    }
  }
  return YMAX;
}
function chapterOf(y) { for (const c of CH) if (y <= c.b) return c; return CH[CH.length - 1]; }

/* 年份换算：天文纪年（前 1 年 = 0），便于连续比较 */
const ord = (y) => (y < 0 ? y + 1 : y);
const MONTHS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const tOf = (y, m, d) => ord(y) + (m ? (MONTHS[m - 1] + (d || 1) - 1) / 365.25 : 0);
const fmtYear = (y) => (y < 0 ? '前' + (-y) : String(y));

const TODAY_SPAN = 30;
function windowOf(y) {
  if (y >= YMAX) return [YMAX - TODAY_SPAN, YMAX, '近 ' + TODAY_SPAN + ' 年'];
  return [y, y, chapterOf(y).n];
}

/* ───────────── 2. 年表索引 ───────────── */
const regionById = new Map(ATLAS.regions.map((r) => [r.id, r]));
const regionByIso = new Map(ATLAS.regions.filter((r) => r.iso).map((r) => [r.iso, r]));
const topGroup = (r) => {
  let cur = r, guard = 0;
  while (cur && cur.parent && guard++ < 8) cur = regionById.get(cur.parent) || cur;
  return cur || r;
};

const entries = ATLAS.entries.map((e) => {
  const t0 = tOf(e.start, e.sm, e.sd);
  let t1 = e.point ? t0 : tOf(e.end, e.em, e.ed);
  if (!(t1 >= t0)) t1 = t0;
  return { ...e, t0, t1, regionRef: regionById.get(e.region) || null };
});

const entriesByRegion = new Map();
for (const e of entries) {
  let arr = entriesByRegion.get(e.region);
  if (!arr) entriesByRegion.set(e.region, (arr = []));
  arr.push(e);
}
for (const arr of entriesByRegion.values()) arr.sort((a, b) => a.t0 - b.t0);

const KIND = {
  era: ['朝代 / 政权', '#6f93b8'],
  war: ['战争', '#c0766d'],
  movement: ['思潮', '#9a86b8'],
  colonial: ['殖民', '#c08355'],
  religion: ['宗教', '#b79a5f'],
  economy: ['经济', '#6aa88c'],
  politics: ['政治', '#bf7f93'],
  technology: ['科技', '#6da3a9'],
  literature: ['文学', '#a888b8'],
  other: ['其他', '#8a9a7a'],
};
const kindOf = (e) => KIND[e.kind] || KIND.other;
const kindColor = (e) => kindOf(e)[1];

function dateOf(e) {
  if (e.point) return fmtYear(e.start) + ' 年';
  if (e.start === e.end) return fmtYear(e.start) + ' 年';
  return fmtYear(e.start) + '–' + fmtYear(e.end);
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* 某个年份窗口内的条目 */
function entriesInWindow(regionId, y) {
  const [a, b] = windowOf(y), oa = ord(a), ob = ord(b);
  const arr = entriesByRegion.get(regionId) || [];
  const out = [];
  for (const e of arr) if (e.t1 >= oa && e.t0 <= ob) out.push(e);
  return out;
}
function nearestEntries(regionId, y, n) {
  const arr = entriesByRegion.get(regionId) || [];
  const t = ord(y);
  return arr
    .map((e) => ({ e, d: e.t0 > t ? e.t0 - t : t - e.t1 }))
    .sort((p, q) => p.d - q.d || q.e.t0 - p.e.t0)
    .slice(0, n)
    .map((p) => p.e);
}
function summaryAt(y) {
  const [a, b] = windowOf(y), oa = ord(a), ob = ord(b);
  const byRegion = new Map();
  let ev = 0, era = 0;
  const countries = new Set();
  for (const e of entries) {
    if (e.t1 < oa || e.t0 > ob) continue;
    let rec = byRegion.get(e.region);
    if (!rec) byRegion.set(e.region, (rec = { ev: 0, era: 0 }));
    if (e.kind === 'era') { rec.era++; era++; } else { rec.ev++; ev++; }
    const r = e.regionRef;
    if (r && r.iso) countries.add(r.iso);
  }
  return { byRegion, ev, era, countries };
}

/* ───────────── 3. 地图几何 ───────────── */
const shapes = ATLAS.map;                       // [[iso, svgPath], ...]
const ISO_OF_ID = [''];                          // id → iso（0 号空）
const ID_OF_ISO = new Map();
const shapePaths = shapes.map(([, p]) => new Path2D(p));
for (let i = 0; i < shapes.length; i++) {
  const iso = shapes[i][0];
  const id = i + 1;
  ISO_OF_ID[id] = /^[A-Z]{2}$/.test(iso) ? iso : '';
  if (ISO_OF_ID[id] && !ID_OF_ISO.has(iso)) ID_OF_ISO.set(iso, id);
}

/* ───────────── 4. 材质与命中图 ───────────── */
const TW = 2048, TH = 1024;                 // 等距圆柱贴图
const MAPW = 1000, MAPH = 500;              // SVG 坐标空间
let baseCanvas = null;      // 地表颜色
let idCanvas = null;        // 国界 id 图（R=id, G=覆盖率）
let idMap = null;           // 拾取用的一字节 id 表
let reliefImg = null;

function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function buildIdMap() {
  const c = newCanvas(TW, TH);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, TW, TH);
  g.setTransform(TW / MAPW, 0, 0, TH / MAPH, 0, 0);
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 0.6;
  for (let i = 0; i < shapePaths.length; i++) {
    const col = 'rgb(' + (i + 1) + ',255,0)';
    g.fillStyle = col; g.strokeStyle = col;
    g.fill(shapePaths[i], 'evenodd');
    g.stroke(shapePaths[i]);
  }
  const px = g.getImageData(0, 0, TW, TH).data;
  const map = new Uint8Array(TW * TH);
  for (let i = 0, p = 0; i < map.length; i++, p += 4) {
    const cover = px[p + 1];
    if (cover > 128) map[i] = Math.round((px[p] * 255) / cover);
  }
  idCanvas = c; idMap = map;
}

function buildBaseCanvas() {
  const c = newCanvas(TW, TH);
  const g = c.getContext('2d');

  /* 海：赤道略亮，两极压暗 */
  const sea = g.createLinearGradient(0, 0, 0, TH);
  sea.addColorStop(0.00, '#08161f');
  sea.addColorStop(0.22, '#123047');
  sea.addColorStop(0.50, '#1d4963');
  sea.addColorStop(0.78, '#123047');
  sea.addColorStop(1.00, '#08161f');
  g.fillStyle = sea;
  g.fillRect(0, 0, TW, TH);

  g.setTransform(TW / MAPW, 0, 0, TH / MAPH, 0, 0);
  g.lineJoin = 'round'; g.lineCap = 'round';

  /* 大陆架：沿国界线加粗描边，被陆地填色盖掉内侧，只留外圈 */
  g.strokeStyle = 'rgba(104,158,178,.34)'; g.lineWidth = 5;
  for (const p of shapePaths) g.stroke(p);
  g.strokeStyle = 'rgba(150,200,214,.30)'; g.lineWidth = 1.8;
  for (const p of shapePaths) g.stroke(p);

  /* 陆地底色 */
  const landAll = new Path2D();
  for (const p of shapePaths) landAll.addPath(p);
  g.fillStyle = '#c9bd9f';
  for (const p of shapePaths) g.fill(p, 'evenodd');

  /* 地形浮雕（乘算，只作用在陆地上） */
  if (reliefImg) {
    g.save();
    g.clip(landAll, 'evenodd');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.62;
    g.drawImage(reliefImg, 0, 0, TW, TH);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.20;
    g.drawImage(reliefImg, 0, 0, TW, TH);
    g.restore();
  }

  /* 缩回设备坐标，画经纬网与海岸线 */
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = 'rgba(255,255,255,.055)'; g.lineWidth = 1;
  g.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) { const x = ((lon + 180) / 360) * TW; g.moveTo(x, 0); g.lineTo(x, TH); }
  for (let lat = -60; lat <= 60; lat += 30) { const y = ((90 - lat) / 180) * TH; g.moveTo(0, y); g.lineTo(TW, y); }
  g.stroke();

  g.setTransform(TW / MAPW, 0, 0, TH / MAPH, 0, 0);
  g.strokeStyle = 'rgba(246,240,226,.50)'; g.lineWidth = 0.75;
  for (const p of shapePaths) g.stroke(p);

  /* 极冠（很轻的一层，只压住极点附近的强反差） */
  g.setTransform(1, 0, 0, 1, 0, 0);
  const ice = g.createLinearGradient(0, 0, 0, TH * 0.085);
  ice.addColorStop(0, 'rgba(228,238,246,.62)');
  ice.addColorStop(.55, 'rgba(228,238,246,.18)');
  ice.addColorStop(1, 'rgba(228,238,246,0)');
  g.fillStyle = ice; g.fillRect(0, 0, TW, TH * 0.085);
  const ice2 = g.createLinearGradient(0, TH, 0, TH * 0.915);
  ice2.addColorStop(0, 'rgba(232,240,246,.78)');
  ice2.addColorStop(.55, 'rgba(232,240,246,.22)');
  ice2.addColorStop(1, 'rgba(232,240,246,0)');
  g.fillStyle = ice2; g.fillRect(0, TH * 0.915, TW, TH * 0.085);

  baseCanvas = c;
}

/* ───────────── 5. 状态 ───────────── */
const state = {
  year: YMAX,
  yaw: -1.42,        // 初始看向东亚
  tilt: 0.30,
  zoom: 1,
  panX: 0,
  panY: 0,
  selRegion: null,
  selIso: null,
};

const view = { w: 1, h: 1, cx: 0, cy: 0, R: 1, dpr: 1, Rz: 1 };

/* ───────────── 6. 着色查找表（随年份变化） ───────────── */
const HEAT = [[152, 122, 68], [188, 148, 82], [222, 178, 94], [247, 208, 122], [255, 233, 176]];
const heatIndex = (n) => (n <= 1 ? 0 : n === 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4);
const lut = new Uint8Array(256 * 4);
let summary = summaryAt(state.year);

function rebuildLut() {
  lut.fill(0);
  for (let id = 1; id < ISO_OF_ID.length; id++) {
    const iso = ISO_OF_ID[id];
    if (!iso) continue;
    const region = regionByIso.get(iso);
    const rec = region ? summary.byRegion.get(region.id) : null;
    const n = rec ? rec.ev : 0;
    const e = rec ? rec.era : 0;
    const o = id * 4;
    if (n) {
      const hc = HEAT[heatIndex(n)];
      lut[o] = hc[0]; lut[o + 1] = hc[1]; lut[o + 2] = hc[2];
      lut[o + 3] = Math.round(255 * (0.80 + Math.min(0.14, n * 0.02)));
    } else if (e) {
      lut[o] = 214; lut[o + 1] = 176; lut[o + 2] = 126; lut[o + 3] = 74;
    } else {
      lut[o] = 118; lut[o + 1] = 127; lut[o + 2] = 140; lut[o + 3] = 116;
    }
  }
  if (glr) glr.uploadLut(lut);
}

/* ───────────── 7. WebGL 渲染器 ───────────── */
const VERT = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat3 uRot;
uniform vec2 uCenter;
uniform vec2 uViewport;
uniform float uScale;
varying vec2 vUv;
varying vec3 vN;
void main() {
  vec3 p = uRot * aPos;
  vec2 screen = uCenter + vec2(p.x, p.y) * uScale;
  gl_Position = vec4((screen / uViewport) * 2.0 - 1.0, -p.z, 1.0);
  vUv = aUv;
  vN = p;
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
varying vec3 vN;
uniform sampler2D uBase;
uniform sampler2D uId;
uniform sampler2D uLut;
uniform vec3 uLight;
uniform float uSel;
void main() {
  vec3 n = normalize(vN);
  vec3 base = texture2D(uBase, vUv).rgb;
  float idr = texture2D(uId, vUv).r;
  float idx = floor(idr * 255.0 + 0.5);
  vec4 tint = texture2D(uLut, vec2((idx + 0.5) / 256.0, 0.5));
  vec3 col = mix(base, tint.rgb, tint.a);
  if (uSel > 0.5 && abs(idx - uSel) < 0.5) {
    col = mix(col, vec3(1.0, 0.94, 0.80), 0.20);
  }
  float l = dot(n, uLight);
  float lam = clamp(l, 0.0, 1.0);
  vec3 lit = col * (0.42 + 0.78 * pow(lam, 0.7));
  float day = smoothstep(-0.24, 0.38, l);
  col = mix(col * 0.32, lit, day);
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.2);
  col += vec3(0.30, 0.46, 0.64) * rim * 0.45;
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT_ATM = `
attribute vec2 aPos;
uniform vec2 uCenter;
uniform vec2 uViewport;
uniform float uScale;
varying vec2 vP;
void main() {
  vP = aPos * 1.42;
  vec2 screen = uCenter + vP * uScale;
  gl_Position = vec4((screen / uViewport) * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG_ATM = `
precision mediump float;
varying vec2 vP;
uniform vec3 uAtm;
void main() {
  float r = length(vP);
  float a = 0.0;
  if (r > 0.94) {
    float inner = smoothstep(0.94, 1.04, r);
    float t = clamp(1.0 - (r - 1.0) / 0.55, 0.0, 1.0);
    a = inner * pow(t, 3.0) * 0.42;
  }
  gl_FragColor = vec4(uAtm, a);
}`;

const glr = (() => {
  const canvas = document.getElementById('globe');
  const opts = { alpha: true, antialias: true, depth: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
  let gl = null;
  try { gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts); } catch (_) { gl = null; }
  if (!gl) return null;

  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('shader', gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    const v = shader(gl.VERTEX_SHADER, vs), f = shader(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('link', gl.getProgramInfoLog(p)); return null; }
    return p;
  };

  const prog = program(VERT, FRAG);
  const progAtm = program(VERT_ATM, FRAG_ATM);
  if (!prog || !progAtm) return null;

  /* 球体网格：经纬网格细到看不见折线 */
  const LON = 192, LAT = 96;
  const verts = new Float32Array((LON + 1) * (LAT + 1) * 5);
  let k = 0;
  for (let j = 0; j <= LAT; j++) {
    const v = j / LAT, lat = (0.5 - v) * Math.PI;
    const cy = Math.sin(lat), cr = Math.cos(lat);
    for (let i = 0; i <= LON; i++) {
      const u = i / LON, lon = (u - 0.5) * TAU;
      verts[k++] = cr * Math.sin(lon);
      verts[k++] = cy;
      verts[k++] = cr * Math.cos(lon);
      verts[k++] = u;
      verts[k++] = v;
    }
  }
  const idx = new Uint16Array(LON * LAT * 6);
  let m = 0;
  for (let j = 0; j < LAT; j++) {
    for (let i = 0; i < LON; i++) {
      const a = j * (LON + 1) + i, b = a + 1, c = a + LON + 1, d = c + 1;
      idx[m++] = a; idx[m++] = c; idx[m++] = b;
      idx[m++] = b; idx[m++] = c; idx[m++] = d;
    }
  }

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aUv = gl.getAttribLocation(prog, 'aUv');

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPosAtm = gl.getAttribLocation(progAtm, 'aPos');

  const U = {
    rot: gl.getUniformLocation(prog, 'uRot'),
    center: gl.getUniformLocation(prog, 'uCenter'),
    viewport: gl.getUniformLocation(prog, 'uViewport'),
    scale: gl.getUniformLocation(prog, 'uScale'),
    base: gl.getUniformLocation(prog, 'uBase'),
    id: gl.getUniformLocation(prog, 'uId'),
    lut: gl.getUniformLocation(prog, 'uLut'),
    light: gl.getUniformLocation(prog, 'uLight'),
    sel: gl.getUniformLocation(prog, 'uSel'),
    atmCenter: gl.getUniformLocation(progAtm, 'uCenter'),
    atmViewport: gl.getUniformLocation(progAtm, 'uViewport'),
    atmScale: gl.getUniformLocation(progAtm, 'uScale'),
    atmColor: gl.getUniformLocation(progAtm, 'uAtm'),
  };

  const tex = (unit, nearest) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (nearest) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const tBase = tex(0, false);
  const tId = tex(1, true);
  const tLut = tex(2, true);

  const aniso = (() => {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    if (!ext) return;
    const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.bindTexture(gl.TEXTURE_2D, tBase);
    gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  })();

  const glr = {
    kind: 'webgl',
    canvas,
    uploadBase(cv) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tBase);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (aniso) { /* 已在上面设置 */ }
    },
    uploadId(cv) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tId);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    },
    uploadLut(arr) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, tLut);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, arr);
    },
    resize(w, h, dpr) {
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    },
    draw(v, st) {
      const W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      const ct = Math.cos(st.tilt), stt = Math.sin(st.tilt);
      /* M = Rx(tilt) · Ry(yaw)，行主序给出、mul3 转成列主序 */
      const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
      const Rx = [1, 0, 0, 0, ct, -stt, 0, stt, ct];
      const rot = new Float32Array(mul3(Rx, Ry));

      const center = [v.cx * v.dpr, (v.h - v.cy) * v.dpr];
      const scale = v.Rz * v.dpr;

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 20, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

      gl.uniformMatrix3fv(U.rot, false, rot);
      gl.uniform2f(U.center, center[0], center[1]);
      gl.uniform2f(U.viewport, W, H);
      gl.uniform1f(U.scale, scale);
      gl.uniform3f(U.light, -0.52, 0.44, 0.73);
      gl.uniform1f(U.sel, st.selIso ? (ID_OF_ISO.get(st.selIso) || 0) : 0);
      gl.uniform1i(U.base, 0);
      gl.uniform1i(U.id, 1);
      gl.uniform1i(U.lut, 2);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clearDepth(1);
      gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.DEPTH_TEST);

      /* 大气光环 */
      gl.useProgram(progAtm);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(aPosAtm);
      gl.vertexAttribPointer(aPosAtm, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(U.atmCenter, center[0], center[1]);
      gl.uniform2f(U.atmViewport, W, H);
      gl.uniform1f(U.atmScale, scale);
      gl.uniform3f(U.atmColor, 0.42, 0.58, 0.78);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    },
  };
  return glr;
})();

/* 行主序 3x3 相乘，返回列主序（给 WebGL） */
function mul3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[c * 3 + r] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/* ───────────── 8. Canvas2D 兜底渲染 ───────────── */
const fallback = (() => {
  if (glr) return null;
  const cv = document.getElementById('globe');
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const off = newCanvas(1, 1);
  const octx = off.getContext('2d');
  let src = null, sphere = null, W = TW, H = TH;

  return {
    kind: 'canvas2d',
    prepare() {
      const g = baseCanvas.getContext('2d', { willReadFrequently: true });
      src = g.getImageData(0, 0, TW, TH).data;
    },
    resize(w, h, dpr) {
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
    },
    draw(v, st) {
      if (!src) return;
      const D = clamp(Math.round(v.Rz * 2 * v.dpr), 160, 520);
      if (off.width !== D) { off.width = D; off.height = D; sphere = octx.createImageData(D, D); }
      const buf = sphere.data;
      const c0 = D / 2, rad = D / 2 - 0.5;
      const ct = Math.cos(st.tilt), stt = Math.sin(st.tilt);
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      const selId = st.selIso ? (ID_OF_ISO.get(st.selIso) || 0) : 0;
      const lx = -0.52, ly = 0.44, lz = 0.73;

      for (let py = 0; py < D; py++) {
        const ny = (py + 0.5 - c0) / rad, ys = -ny;
        for (let px = 0; px < D; px++) {
          const nx = (px + 0.5 - c0) / rad;
          const rr = nx * nx + ny * ny, o = (py * D + px) << 2;
          if (rr >= 1) { buf[o + 3] = 0; continue; }
          const nz = Math.sqrt(1 - rr);
          /* 世界坐标 → 模型坐标（M^T） */
          const y1 = ys * ct + nz * stt, z1 = -ys * stt + nz * ct;
          const mx = nx * cy - z1 * sy, mz = nx * sy + z1 * cy;
          const lat = Math.asin(clamp(y1, -1, 1));
          let u = Math.atan2(mx, mz) / TAU + 0.5;
          if (u < 0) u += 1; else if (u >= 1) u -= 1;
          const vv = 0.5 - lat / Math.PI;
          const col = Math.min(W - 1, Math.max(0, u * W | 0));
          const row = Math.min(H - 1, Math.max(0, ((vv * H) | 0)));
          const si = (row * W + col) << 2;
          let r = src[si], g = src[si + 1], b = src[si + 2];

          const id = idMap[row * W + col];
          if (id) {
            const lo = id << 2, a = lut[lo + 3] / 255;
            r += (lut[lo] - r) * a;
            g += (lut[lo + 1] - g) * a;
            b += (lut[lo + 2] - b) * a;
            if (selId && id === selId) {
              r = r * 0.8 + 51; g = g * 0.8 + 48.8; b = b * 0.8 + 40.8;
            }
          }
          const l = nx * lx + ys * ly + nz * lz;
          const lam = l > 0 ? l : 0;
          const d0 = clamp((l + 0.24) / 0.62, 0, 1), ds = d0 * d0 * (3 - 2 * d0);
          const lit = 0.42 + 0.78 * Math.pow(lam, 0.7);
          const dark = 0.32;
          r = r * dark + r * (lit - dark) * ds;
          g = g * dark + g * (lit - dark) * ds;
          b = b * dark + b * (lit - dark) * ds;
          const rim = Math.pow(1 - nz, 3.2) * 0.6;
          buf[o] = Math.min(255, r + 76 * rim);
          buf[o + 1] = Math.min(255, g + 117 * rim);
          buf[o + 2] = Math.min(255, b + 163 * rim);
          buf[o + 3] = 255;
        }
      }
      octx.putImageData(sphere, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      const Rz = v.Rz * v.dpr;
      const x = (v.cx + st.panX) * v.dpr - Rz;
      const y = (v.cy + st.panY) * v.dpr - Rz;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, x, y, Rz * 2, Rz * 2);
    },
  };
})();

/* ───────────── 9. 布局 ───────────── */
const canvas = document.getElementById('globe');
const track = document.getElementById('track');
const tctx = track.getContext('2d');
const elYear = document.getElementById('year');
const elSub = document.getElementById('sub');
const sheetEl = document.getElementById('sheet');
const sheetInner = document.getElementById('sheet-inner');
const hintEl = document.getElementById('hint');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const overlayBody = document.getElementById('overlay-body');
const bootEl = document.getElementById('boot');

const renderer = glr || fallback;

function layout() {
  const w = innerWidth, h = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 3);
  view.w = w; view.h = h; view.dpr = dpr;
  view.cx = w / 2;
  view.cy = clamp(h * 0.42, h * 0.32, h * 0.50);
  view.R = Math.min(w * 0.435, h * 0.30, 320);
  clampPan();
  view.Rz = view.R * state.zoom;
  if (renderer) renderer.resize(w, h, dpr);
  draw();
}

function clampPan() {
  const Rz = view.R * state.zoom;
  const mx = Math.max(0, Rz - view.w * 0.5 + 18);
  const my = Math.max(0, Rz - view.h * 0.5 + 18);
  state.panX = clamp(state.panX, -mx, mx);
  state.panY = clamp(state.panY, -my, my);
}

/* ───────────── 10. 拾取 ───────────── */
function pick(sx, sy) {
  if (!idMap) return 0;
  const Rz = view.R * state.zoom;
  const dx = (sx - view.cx - state.panX) / Rz;
  const dy = -(sy - view.cy - state.panY) / Rz;
  const rr = dx * dx + dy * dy;
  if (rr >= 1) return 0;
  const wz = Math.sqrt(1 - rr);
  const ct = Math.cos(state.tilt), stt = Math.sin(state.tilt);
  const cy = Math.cos(state.yaw), sy2 = Math.sin(state.yaw);
  /* p_m = Ry^-1 · Rx^-1 · p_w */
  const y1 = dy * ct + wz * stt;
  const z1 = -dy * stt + wz * ct;
  const mx = dx * cy - z1 * sy2;
  const mz = dx * sy2 + z1 * cy;
  const lat = Math.asin(clamp(y1, -1, 1));
  let u = Math.atan2(mx, mz) / TAU + 0.5;
  if (u < 0) u += 1; else if (u >= 1) u -= 1;
  const vv = 0.5 - lat / Math.PI;
  const col = Math.min(TW - 1, Math.max(0, Math.floor(u * TW)));
  const row = Math.min(TH - 1, Math.max(0, Math.floor(vv * TH)));
  return idMap[row * TW + col];
}

/* ───────────── 11. 渲染调度（空闲即停，省电） ───────────── */
let dirty = true, spinning = true, lastT = 0, rafId = 0;
const SPIN_MS = 22000;                 // 打开后自转这么久，之后静止
const spinStopAt = performance.now() + SPIN_MS;

function invalidate() {
  dirty = true;
  if (!rafId) { lastT = 0; rafId = requestAnimationFrame(frame); }
}

function frame(t) {
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
  lastT = t;
  rafId = 0;

  let busy = false;
  if (spinning && performance.now() > spinStopAt) spinning = false;
  if (spinning && pointerCount() === 0 && !pinch) {
    state.yaw -= 0.055 * dt;
    dirty = true;
    busy = true;
  }
  if (applyMomentum(dt)) { dirty = true; busy = true; }
  if (dirty) { dirty = false; draw(); }
  if (busy || dirty) rafId = requestAnimationFrame(frame);
}

function draw() {
  if (!renderer || !baseCanvas) return;
  renderer.draw(view, state);
}

/* ───────────── 12. 交互 ───────────── */
const pointers = new Map();
let drag = null, pinch = null, momentum = { yaw: 0, tilt: 0 };
const pointerCount = () => pointers.size;

function applyMomentum(dt) {
  if (!momentum.yaw && !momentum.tilt) return false;
  state.yaw += momentum.yaw * dt;
  state.tilt = clamp(state.tilt + momentum.tilt * dt, -0.62, 1.02);
  const damp = Math.pow(0.0016, dt);
  momentum.yaw *= damp;
  momentum.tilt *= damp;
  if (Math.abs(momentum.yaw) < 0.01) momentum.yaw = 0;
  if (Math.abs(momentum.tilt) < 0.01) momentum.tilt = 0;
  return true;
}

let lastTapAt = 0, lastTapPos = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  hideHint();
  momentum.yaw = momentum.tilt = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: 0 });
  if (pointers.size === 1) {
    drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, tilt: state.tilt, last: performance.now(), vy: 0, vt: 0 };
    pinch = null;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: state.zoom,
      px: state.panX, py: state.panY,
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    };
    drag = null;
    momentum.yaw = momentum.tilt = 0;
  }
}, { passive: true });

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.moved += Math.abs(dx) + Math.abs(dy);
  p.x = e.clientX; p.y = e.clientY;

  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const z = clamp((pinch.zoom * d) / pinch.d, 1, 6);
    const k = z / state.zoom;
    state.panX = (pinch.cx - view.cx) - k * (pinch.cx - view.cx - pinch.px);
    state.panY = (pinch.cy - view.cy) - k * (pinch.cy - view.cy - pinch.py);
    state.zoom = z;
    clampPan();
    view.Rz = view.R * state.zoom;
    invalidate();
    return;
  }
  if (!drag) return;
  const now = performance.now();
  const dts = Math.max(0.008, (now - drag.last) / 1000);
  drag.last = now;
  const k = 1 / (view.R * state.zoom);
  const dyaw = dx * k;
  const dtilt = dy * k;
  state.yaw += dyaw;
  state.tilt = clamp(state.tilt + dtilt, -0.62, 1.02);
  drag.vy = dyaw / dts;
  drag.vt = dtilt / dts;
  invalidate();
}, { passive: true });

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!p) return;
  if (pointers.size === 0 && drag) {
    momentum.yaw = clamp(drag.vy * 0.55, -3, 3);
    momentum.tilt = clamp(drag.vt * 0.35, -1.4, 1.4);
    drag = null;
    invalidate();
  }
  if (e.type === 'pointerup' && p.moved < 10 && performance.now() - p.t < 320) {
    const now = performance.now();
    const isDouble = now - lastTapAt < 300 && Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y) < 26;
    lastTapAt = now; lastTapPos = { x: e.clientX, y: e.clientY };
    if (isDouble) { zoomTo(state.zoom > 1.4 ? 1 : 2.4, e.clientX, e.clientY); lastTapAt = 0; return; }
    tapGlobe(e.clientX, e.clientY);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0016);
  zoomTo(clamp(state.zoom * f, 1, 6), e.clientX, e.clientY);
}, { passive: false });

let zoomAnim = 0;
function zoomTo(z, ax, ay) {
  z = clamp(z, 1, 6);
  const from = state.zoom, R = view.R;
  const dx = (ax == null ? view.cx : ax) - view.cx;
  const dy = (ay == null ? view.cy : ay) - view.cy;
  const px0 = state.panX, py0 = state.panY;
  const apply = (k) => {
    state.zoom = from + (z - from) * k;
    const ratio = state.zoom / from;
    state.panX = dx - ratio * (dx - px0);
    state.panY = dy - ratio * (dy - py0);
    clampPan();
    view.Rz = R * state.zoom;
    invalidate();
  };
  if (z === from) return;
  cancelAnimationFrame(zoomAnim);
  const t0 = performance.now();
  const step = (t) => {
    const k = clamp((t - t0) / 220, 0, 1);
    apply(k < 1 ? 1 - Math.pow(1 - k, 3) : 1);
    if (k < 1) zoomAnim = requestAnimationFrame(step);
  };
  zoomAnim = requestAnimationFrame(step);
}

function tapGlobe(sx, sy) {
  const id = pick(sx, sy);
  if (!id) { closeSheet(); return; }
  const iso = ISO_OF_ID[id] || '';
  if (!iso) { closeSheet(); return; }
  const region = regionByIso.get(iso);
  openRegion(region ? region.id : null, iso);
}

/* ───────────── 13. 抽屉 ───────────── */
function regionName(r) { return r ? (r.zh || r.en || r.id) : ''; }

function renderSheet() {
  const { selRegion, selIso } = state;
  const region = selRegion ? regionById.get(selRegion) : regionByIso.get(selIso);
  const [a, b, scopeName] = windowOf(state.year);
  let list = region ? entriesInWindow(region.id, state.year) : [];
  let fallbackMode = false;
  if (!list.length && region) {
    list = nearestEntries(region.id, state.year, 8);
    fallbackMode = list.length > 0;
  }
  list.sort((x, z) => (z.kind === 'era') - (x.kind === 'era') || z.t0 - x.t0);
  const era = list.find((e) => e.kind === 'era');
  const rest = list.filter((e) => e !== era).slice(0, 10);
  const span = a === b ? fmtYear(a) + ' 年' : fmtYear(a) + '–' + fmtYear(b);

  const title = region ? regionName(region) : (selIso || '未知地区');
  const en = region && region.en && region.en !== title ? region.en : '';
  const total = region ? (entriesByRegion.get(region.id) || []).length : 0;

  if (!region) {
    sheetInner.innerHTML =
      '<h2>' + esc(title) + '</h2>' +
      '<p class="empty">年表还没有收录这个地区。</p>';
  } else {
    const rows = rest.map((e) =>
      '<li><i style="background:' + kindColor(e) + '"></i><span>' + esc(e.zh || e.en) +
      '</span><small>' + dateOf(e) + '</small></li>').join('');
    sheetInner.innerHTML =
      '<h2>' + esc(title) + (en ? '<em>' + esc(en) + '</em>' : '') + '</h2>' +
      (era ? '<p class="era">' + esc(era.zh || era.en) + '<small>' + dateOf(era) + '</small></p>'
      : '<p class="era">' + esc(scopeName) + '<small>' + span + '</small></p>') +
      (fallbackMode ? '<p class="note">' + esc(scopeName) + '没有记录 · 下面是最近的条目</p>' : '') +
      (rows ? '<ul>' + rows + '</ul>' : '<p class="empty">这个年份附近还没有条目。</p>') +
      '<p class="foot">共 ' + total + ' 条记录 · 边界按现代国界近似</p>';
  }
  sheetEl.classList.add('open');
}
function openRegion(regionId, iso) {
  state.selRegion = regionId || null;
  state.selIso = iso || null;
  renderSheet();
  invalidate();
}
function closeSheet() {
  if (!state.selRegion && !state.selIso) return;
  state.selRegion = null; state.selIso = null;
  sheetEl.classList.remove('open');
  invalidate();
}
document.getElementById('handle').addEventListener('click', closeSheet);

/* ───────────── 14. 全景列表 ───────────── */
function openWorld() {
  const [a, b, scope] = windowOf(state.year);
  const oa = ord(a), ob = ord(b), t = ord(state.year);
  const list = [];
  for (const e of entries) {
    if (e.t1 < oa || e.t0 > ob) continue;
    list.push({ e, d: e.t0 > t ? e.t0 - t : t - e.t1 });
  }
  list.sort((p, q) => p.d - q.d || q.e.t0 - p.e.t0);
  const cap = 90;
  const groups = new Map();
  for (const row of list.slice(0, cap)) {
    const g = topGroup(row.e.regionRef || {});
    const key = g.zh || g.en || '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.e);
  }
  overlayTitle.textContent = state.year >= YMAX ? '今天' : fmtYear(state.year) + ' 年';
  overlaySub.innerHTML = scope + ' · <b>' + summary.countries.size + '</b> 个国家 · <b>' +
    (summary.ev + summary.era) + '</b> 条记录' + (list.length > cap ? ' · 显示前 ' + cap + ' 条' : '');

  if (!list.length) {
    overlayBody.innerHTML = '<p class="wempty">这一年还没有收录条目。拖动时间轴换个年代试试。</p>';
  } else {
    const order = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    let html = '';
    for (const [gname, rows] of order) {
      html += '<div class="wgroup">' + esc(gname) + ' · ' + rows.length + '</div>';
      for (const e of rows) {
        const r = e.regionRef;
        const meta = (r ? regionName(r) : '世界') + ' · ' + kindOf(e)[0];
        html += '<div class="wrow" data-region="' + esc(r ? r.id : '') + '" data-iso="' + esc(r && r.iso ? r.iso : '') + '">' +
          '<i style="background:' + kindColor(e) + '"></i>' +
          '<div class="t">' + esc(e.zh || e.en) + '<span class="m">' + esc(meta) + '</span></div>' +
          '<div class="y">' + esc(dateOf(e)) + '</div></div>';
      }
    }
    overlayBody.innerHTML = html;
  }
  overlay.hidden = false;
  overlayBody.scrollTop = 0;
}

overlayBody.addEventListener('click', (e) => {
  const row = e.target.closest('.wrow');
  if (!row) return;
  const regionId = row.getAttribute('data-region');
  const iso = row.getAttribute('data-iso');
  closeWorld();
  if (regionId) openRegion(regionId, iso || null);
});
function closeWorld() { overlay.hidden = true; }
document.getElementById('overlay-close').addEventListener('click', closeWorld);
elYear.addEventListener('click', openWorld);

/* ───────────── 15. 时间轴 ───────────── */
let density = null;
function buildDensity() {
  const N = YMAX - YMIN + 1;
  const hist = new Float32Array(N);
  for (const e of entries) {
    const a = Math.max(YMIN, Math.ceil(e.start));
    const b = Math.min(YMAX, Math.floor(e.point ? e.start : e.end));
    for (let y = a; y <= b; y++) hist[y - YMIN]++;
  }
  const sm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0, c = 0;
    for (let k = -5; k <= 5; k++) { const j = i + k; if (j >= 0 && j < N) { s += hist[j]; c++; } }
    sm[i] = s / c;
  }
  let mx = 0;
  for (const v of sm) if (v > mx) mx = v;
  density = { sm, mx: mx || 1 };
}

const T_PADL = 18, T_PADR = 18, T_H = 96;
let trackW = 0;
function layoutTrack() {
  trackW = track.clientWidth || innerWidth;
  const dpr = Math.min(devicePixelRatio || 1, 3);
  track.width = Math.round(trackW * dpr);
  track.height = Math.round(T_H * dpr);
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const xOfPos = (p) => T_PADL + p * (trackW - T_PADL - T_PADR);

function drawTrack() {
  if (!density) buildDensity();
  const w = trackW;
  tctx.clearRect(0, 0, w, T_H);

  const labelY = 13, top = 24, areaH = 24, railY = 62, footY = 82;
  const x0 = xOfPos(0), x1 = xOfPos(1);

  /* 章节带 */
  const active = chapterOf(state.year);
  for (let i = 0; i < CH.length; i++) {
    const c = CH[i];
    const a = xOfPos(cum[i]), b = xOfPos(cum[i] + c.w);
    tctx.fillStyle = i % 2 ? 'rgba(255,255,255,.028)' : 'rgba(255,255,255,.012)';
    tctx.fillRect(a, top - 3, b - a, areaH + 6);
    if (b - a > 34 || c === active) {
      tctx.font = '10.5px -apple-system,system-ui,sans-serif';
      tctx.textAlign = 'center';
      tctx.fillStyle = c === active ? 'rgba(224,178,115,.95)' : 'rgba(142,153,168,.75)';
      tctx.fillText(c.n, (a + b) / 2, labelY);
    }
  }

  /* 数据密度 */
  const N = YMAX - YMIN + 1, steps = 200, lmax = Math.log1p(density.mx);
  tctx.beginPath();
  tctx.moveTo(x0, top + areaH);
  for (let s = 0; s <= steps; s++) {
    const p = s / steps, y = YMIN + Math.round(p * (YMAX - YMIN));
    const v = Math.log1p(density.sm[clamp(y - YMIN, 0, N - 1)]) / lmax;
    tctx.lineTo(xOfPos(p), top + areaH - v * areaH);
  }
  tctx.lineTo(x1, top + areaH);
  tctx.closePath();
  tctx.fillStyle = 'rgba(224,178,115,.12)';
  tctx.fill();
  tctx.strokeStyle = 'rgba(224,178,115,.26)';
  tctx.lineWidth = 1;
  tctx.stroke();

  /* 轨道 */
  tctx.strokeStyle = 'rgba(255,255,255,.14)';
  tctx.lineWidth = 2;
  tctx.lineCap = 'round';
  tctx.beginPath(); tctx.moveTo(x0, railY); tctx.lineTo(x1, railY); tctx.stroke();

  const px = xOfPos(posOfYear(state.year));
  tctx.strokeStyle = 'rgba(224,178,115,.45)';
  tctx.beginPath(); tctx.moveTo(x0, railY); tctx.lineTo(px, railY); tctx.stroke();
  tctx.strokeStyle = 'rgba(224,178,115,.30)';
  tctx.lineWidth = 1;
  tctx.beginPath(); tctx.moveTo(px, top - 2); tctx.lineTo(px, railY - 8); tctx.stroke();

  /* 端点刻度 */
  tctx.font = '10px -apple-system,system-ui,sans-serif';
  tctx.textAlign = 'left';
  tctx.fillStyle = 'rgba(142,153,168,.7)';
  tctx.fillText('前 3500', x0, footY);
  tctx.textAlign = 'right';
  tctx.fillStyle = 'rgba(224,178,115,.95)';
  tctx.fillText('今天', x1, footY);
  tctx.textAlign = 'center';
  tctx.fillStyle = 'rgba(142,153,168,.55)';
  tctx.fillText('元年', xOfPos(posOfYear(0)), footY);

  /* 拇指 */
  tctx.fillStyle = '#e0b273';
  tctx.beginPath(); tctx.arc(px, railY, 8, 0, TAU); tctx.fill();
  tctx.fillStyle = '#0b1017';
  tctx.beginPath(); tctx.arc(px, railY, 3, 0, TAU); tctx.fill();
}

function posFromX(clientX) {
  const r = track.getBoundingClientRect();
  return clamp((clientX - r.left - T_PADL) / (r.width - T_PADL - T_PADR), 0, 1);
}
let scrubbing = false;
function setYearFromX(clientX) {
  const y = yearOfPos(posFromX(clientX));
  if (y !== state.year) {
    state.year = y;
    onYearChanged();
  }
}
track.addEventListener('pointerdown', (e) => {
  hideHint();
  scrubbing = true;
  try { track.setPointerCapture(e.pointerId); } catch (_) { }
  setYearFromX(e.clientX);
  drawTrack();
}, { passive: true });
track.addEventListener('pointermove', (e) => { if (scrubbing) setYearFromX(e.clientX); }, { passive: true });
track.addEventListener('pointerup', () => { scrubbing = false; });
track.addEventListener('pointercancel', () => { scrubbing = false; });

/* ───────────── 16. HUD / 年份联动 ───────────── */
function syncHud() {
  const y = state.year;
  elYear.textContent = y >= YMAX ? '今天' : fmtYear(y) + ' 年';
  const [a, b, scope] = windowOf(y);
  let txt;
  if (y >= YMAX) txt = scope;
  else txt = chapterOf(y).n;
  elSub.innerHTML = txt + ' · <b>' + summary.countries.size + '</b> 个国家 · <b>' +
    (summary.ev + summary.era) + '</b> 条记录';
}
function onYearChanged() {
  summary = summaryAt(state.year);
  rebuildLut();
  syncHud();
  drawTrack();
  if (!overlay.hidden) openWorld();
  if (state.selRegion || state.selIso) renderSheet();
  invalidate();
}

function hideHint() { hintEl.classList.add('gone'); }
setTimeout(hideHint, 6000);

/* ───────────── 17. 键盘 ───────────── */
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const step = e.shiftKey ? 20 : 1;
  if (e.key === 'ArrowLeft') { state.year = clamp(state.year - step, YMIN, YMAX); onYearChanged(); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { state.year = clamp(state.year + step, YMIN, YMAX); onYearChanged(); e.preventDefault(); }
  else if (e.key === 'Home') { state.year = YMIN; onYearChanged(); e.preventDefault(); }
  else if (e.key === 'End') { state.year = YMAX; onYearChanged(); e.preventDefault(); }
  else if (e.key === 'Escape') { closeWorld(); closeSheet(); }
  else if (e.key === '+' || e.key === '=') { zoomTo(state.zoom * 1.4); e.preventDefault(); }
  else if (e.key === '-') { zoomTo(state.zoom / 1.4); e.preventDefault(); }
});

/* ───────────── 18. 尺寸变化 ───────────── */
let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { layout(); layoutTrack(); drawTrack(); }, 90);
});
addEventListener('orientationchange', () => setTimeout(() => { layout(); layoutTrack(); drawTrack(); }, 260));
document.addEventListener('visibilitychange', () => { lastT = 0; });

/* ───────────── 19. 启动 ───────────── */
function loadRelief() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { reliefImg = img; resolve(); };
    img.onerror = () => resolve();
    img.src = RELIEF_SRC;
  });
}
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

(async function boot() {
  await nextFrame();
  buildIdMap();
  await nextFrame();
  await loadRelief();
  buildBaseCanvas();
  if (fallback) fallback.prepare();
  if (glr) { glr.uploadBase(baseCanvas); glr.uploadId(idCanvas); }

  buildDensity();
  summary = summaryAt(state.year);
  rebuildLut();

  layout();
  layoutTrack();
  drawTrack();
  syncHud();
  draw();

  bootEl.classList.add('gone');
  setTimeout(() => bootEl.remove(), 600);
  invalidate();
})();

})();
