/* Core offline status belongs to the active build, not registration alone. */
const offlineInfo = el('offline-info');
const offlineStatus = el('offline-status');
const offlineRetry = el('offline-retry');
let offlineRegistration;
let offlineRequest = 0;

function offlineText(message, retry = false) {
  offlineStatus.textContent = message;
  offlineRetry.hidden = !retry;
}

function askOfflineWorker(worker, type) {
  if (!worker || worker.state==='redundant') return Promise.resolve();
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = value => { clearTimeout(timeout); channel.port1.close(); resolve(value); };
    const timeout = setTimeout(finish,type==='offline-prepare' ? 30000 : 2500);
    channel.port1.onmessage = event => finish(event.data);
    try { worker.postMessage({type},[channel.port2]); } catch { finish(); }
  });
}

async function checkOfflineStatus(retry = false) {
  const id = ++offlineRequest;
  const reg = offlineRegistration;
  const current = navigator.serviceWorker.controller || reg?.active;
  const type = retry && current ? 'offline-prepare' : 'offline-status';
  const result = await askOfflineWorker(current,type);
  if (id!==offlineRequest) return;
  if (reg?.waiting && reg.waiting!==current) {
    const next = await askOfflineWorker(reg.waiting,'offline-status');
    if (id!==offlineRequest) return;
    if (next?.ready) {
      offlineText('新版离线资料已就绪。关闭时空地球的所有窗口和标签页，再重新打开即可更新。');
      return;
    }
  }
  if (result?.ready && result.revision===buildAssets.revision) offlineText('离线核心资料已准备');
  else if (reg?.installing) offlineText('正在准备离线核心资料…');
  else if (result?.ready) offlineText('旧版离线资料可用。关闭时空地球的所有窗口和标签页，再重新打开以同步版本。');
  else offlineText('离线核心资料尚未准备',true);
}

function watchOfflineWorker(worker) {
  worker?.addEventListener('statechange', () => { checkOfflineStatus(); });
}

async function initializeOfflineStatus(retry = false) {
  if (!buildAssets.revision || !isSecureContext || !('serviceWorker' in navigator) ||
      !(location.pathname.endsWith('/') || location.pathname.endsWith('/index.html'))) return;
  offlineInfo.hidden = false;
  offlineText('正在准备离线核心资料…');
  try {
    if (!offlineRegistration) {
      offlineRegistration = await navigator.serviceWorker.register('sw.js',{updateViaCache:'none'});
      offlineRegistration.addEventListener('updatefound', () => {
        watchOfflineWorker(offlineRegistration.installing);
        checkOfflineStatus();
      });
      watchOfflineWorker(offlineRegistration.installing);
      navigator.serviceWorker.addEventListener('controllerchange', () => { checkOfflineStatus(); });
      addEventListener('online', () => { checkOfflineStatus(); });
      addEventListener('focus', () => { checkOfflineStatus(); });
      el('hud-view').addEventListener('click', () => { checkOfflineStatus(); });
    } else if (retry && !offlineRegistration.installing) {
      await offlineRegistration.update().catch(() => {});
    }
    await checkOfflineStatus(retry);
  } catch { offlineText('离线核心资料尚未准备',true); }
}
offlineRetry.addEventListener('click', () => { initializeOfflineStatus(true); });
