// 用 CDP 驱动无头 Edge：测量布局、模拟触摸、截图
// 用法: node cdp.mjs <url> [--eval "js"] [--shot out.png] [--touch] [--swipe]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const args = process.argv.slice(2);
const url = args[0];
const getArg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const hasArg = (name) => args.includes(name);
const evalJS = getArg('--eval');
const shotPath = getArg('--shot');
const doTouch = hasArg('--touch');
const doSwipe = hasArg('--swipe');
const W = +(getArg('--w') || 390), H = +(getArg('--h') || 844);

const port = 9300 + Math.floor(Math.random() * 500);
const prof = process.env.TEMP + '\\edge-cdp-' + Date.now();

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--remote-allow-origins=*',
  '--user-data-dir=' + prof,
  '--remote-debugging-port=' + port,
  '--window-size=' + W + ',' + H,
  '--force-device-scale-factor=2',
  'about:blank'
], { stdio: 'ignore' });

let ver = null;
for (let i = 0; i < 80; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
  catch { await sleep(150); }
}
if (!ver) { console.error('devtools not reachable'); proc.kill(); process.exit(1); }

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

let seq = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push('CONSOLE ' + msg.params.type + ': ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    if (e.level === 'error' || e.level === 'warning') logs.push('LOG ' + e.level + ': ' + e.text);
  }
});
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + r.exceptionDetails.text);
  return r.result.value;
};

await cdp('Runtime.enable');
await cdp('Log.enable');
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true, screenWidth: W, screenHeight: H });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url });
await sleep(1800);

const measure = await evaluate(`(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}; };
  return {
    innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio, scrollW: document.documentElement.scrollWidth,
    scene: document.body.dataset.scene,
    app: r(document.querySelector('#app')),
    stage: r(document.querySelector('#stage')),
    bg: r(document.querySelector('#bgArt')),
    pinguWrap: r(document.querySelector('#pinguWrap')),
    pinguImg: r(document.querySelector('#pinguWrap img.on')),
    pad: r(document.querySelector('#pad')),
    nav: r(document.querySelector('#nav')),
    hud: r(document.querySelector('#hud')),
    stageWrap: r(document.querySelector('#stageWrap')),
    bubble: r(document.querySelector('#bubble')),
    navBtns: [...document.querySelectorAll('#nav button')].map(r),
    days: document.querySelector('#days')?.textContent,
    daysTitle: document.querySelector('#days')?.title,
    welcome: (()=>{const w=document.querySelector('#welcome');return {display:getComputedStyle(w).display, cls:w.className, opacity:getComputedStyle(w).opacity};})(),
    err: document.querySelector('#errbar')?.textContent || ''
  };
})()`);

if (hasArg('--start')) {
  const btn = await evaluate(`(()=>{const b=document.querySelector('#startBtn').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: btn.x, y: btn.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1400);
  measure.afterStart = await evaluate(`(() => {
    const w = document.querySelector('#welcome');
    return { welcomeDisplay: getComputedStyle(w).display, scene: document.body.dataset.scene,
      bubbleShown: document.querySelector('#bubble').classList.contains('show'),
      bubbleText: document.querySelector('#bubbleText').textContent,
      speech: !!(window.speechSynthesis && window.speechSynthesis.speaking) };
  })()`);
}

if (doTouch) {
  const pad = measure.pad;
  const cx = pad.x + pad.w / 2, cy = pad.y + pad.h / 2;
  const pts = [[-32, -14], [-16, 6], [0, -16], [16, 6], [32, -14]];
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts.map((p, i) => ({ x: cx + p[0], y: cy + p[1], id: i + 1, radiusX: 8, radiusY: 8, force: 1 })) });
  await sleep(900);
  const after = await evaluate(`(() => {
    const dots = document.querySelectorAll('#pad .pad-count i.on').length;
    return { dots, ripple: document.querySelectorAll('.ripple').length, bubble: document.querySelector('#bubble').classList.contains('show'), txt: document.querySelector('#bubbleText').textContent };
  })()`);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  measure.touchTest = after;
}

if (doSwipe) {
  const st = measure.stage;
  const y = st.y + st.h / 2, x0 = st.x + st.w * 0.72;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 20, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    await sleep(30);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(900);
  measure.afterSwipe = await evaluate(`({ scene: document.body.dataset.scene, name: document.querySelector('#sceneName').textContent })`);
}

if (getArg('--tap-el')) {
  const sel = getArg('--tap-el');
  const r = await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(+(getArg('--wait') || 700));
  measure.afterTap = await evaluate(`({ scene: document.body.dataset.scene, bubble: document.querySelector('#bubbleText').textContent, shown: document.querySelector('#bubble').classList.contains('show') })`);
}

if (evalJS) {
  try { measure.evalResult = await evaluate(evalJS); }
  catch (e) { measure.evalError = String(e); }
}

if (shotPath) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shotPath, Buffer.from(r.data, 'base64'));
}

measure.logs = logs;
console.log(JSON.stringify(measure, null, 2));
ws.close();
proc.kill();
await sleep(300);
process.exit(0);
