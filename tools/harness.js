/* 测试基础设施：找到 Chromium 内核浏览器，并把 index.html 复制一份注入调试钩子。
 * 只给 tools/ 下的脚本用，不参与构建。 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const CANDIDATES = [
  process.env.EDGE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  for (const p of CANDIDATES) {
    try { if (fs.statSync(p).isFile()) return p; } catch { }
  }
  return null;
}

const HOOK = `
window.__t = {
  get state(){return state}, get view(){return view}, get summary(){return summary},
  get rendererKind(){return renderer && renderer.kind},
  pick, isoOf: (id) => ISO_OF_ID[id] || '',
  setYear: (y) => { state.year = y; onYearChanged(); },
  stopSpin(){ spinning = false; },
  redraw(){ invalidate(); },
  screenOf(lon, lat){
    const st = state, v = view;
    const ct = Math.cos(st.tilt), stt = Math.sin(st.tilt);
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    const pm = [Math.cos(lat)*Math.sin(lon), Math.sin(lat), Math.cos(lat)*Math.cos(lon)];
    const x1 = cy*pm[0] + sy*pm[2], z1 = -sy*pm[0] + cy*pm[2];
    const y2 = ct*pm[1] - stt*z1, z2 = stt*pm[1] + ct*z1;
    const Rz = v.R*st.zoom;
    return { x: v.cx + st.panX + x1*Rz, y: v.cy + st.panY - y2*Rz, front: z2 > 0 };
  },
};
`;

function buildHarness(name = 'harness') {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const marker = '/* ───────────── 19. 启动 ───────────── */';
  if (!html.includes(marker)) throw new Error('index.html 里找不到启动标记，先跑 npm run build');
  html = html.replace(marker, HOOK + '\n' + marker);
  html = html.replace('</head>', `<script>window.__errs=[];
addEventListener('error',(e)=>window.__errs.push('error: '+(e.message||e.type)+' @'+(e.lineno||0)),true);
addEventListener('unhandledrejection',(e)=>window.__errs.push('rej: '+(e.reason&&e.reason.message||String(e.reason))));
</script></head>`);
  const dir = path.join(os.tmpdir(), 'globe-verify');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + '.html');
  fs.writeFileSync(file, html, 'utf8');
  for (const asset of ['manifest.webmanifest', 'icon.png', 'icon-512.png']) {
    const src = path.join(ROOT, asset);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, asset));
  }
  return { url: 'file:///' + file.replace(/\\/g, '/'), dir, file };
}

module.exports = { ROOT, findBrowser, buildHarness };
