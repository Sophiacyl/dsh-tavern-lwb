// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Real Chromium layout fixture: no server, no user profile and no model/network calls.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
const local = createRequire(new URL('./runtime/package.json', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('./.browsers/', import.meta.url));
const { chromium } = local('playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], env: { ...process.env, HOME: root + 'tests/.browser-home' } });
const output = root + 'tests/layout-output'; await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route('**/*', route => route.abort());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui}#root{height:100%;display:flex;flex-direction:column;overflow:hidden}header{height:52px;flex:none;padding:12px;border-bottom:1px solid #ddd}#body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}#floating{position:fixed;bottom:16px;left:35%;height:48px;background:white;box-shadow:0 2px 10px #aaa;border-radius:24px;padding:10px;z-index:10}</style></head><body><div id="root"><header>小白兼容 · 测试侧栏</header><main id="body"></main></div><div id="floating">返回故事</div></body></html>');
  const react = await readFile(root + 'tests/runtime/node_modules/react/cjs/react.production.js', 'utf8');
  const scheduler = await readFile(root + 'tests/runtime/node_modules/scheduler/cjs/scheduler.production.js', 'utf8');
  const dom = await readFile(root + 'tests/runtime/node_modules/react-dom/cjs/react-dom.production.js', 'utf8');
  const client = await readFile(root + 'tests/runtime/node_modules/react-dom/cjs/react-dom-client.production.js', 'utf8');
  await page.addScriptTag({ content: `const mods={};function common(id,src){const m={exports:{}};new Function('module','exports','require','process',src)(m,m.exports,n=>mods[n],{env:{NODE_ENV:'production'}});mods[id]=m.exports;} common('react',${JSON.stringify(react)});common('scheduler',${JSON.stringify(scheduler)});common('react-dom',${JSON.stringify(dom)});common('react-dom/client',${JSON.stringify(client)});window.React=mods.react;window.ReactDOM=mods['react-dom/client'];` });
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(def){window.plugin=def.factory(n=>window.React)}};window.ui={apiVersion:7,registerPanel(p){window.panel=p},watchState(id,name,fn){fn(null);return()=>{}},watchTurnState(id,fn){fn({turn:3,textVersion:'v3',busy:false,settled:true});return()=>{}},async callHost(name){if(name.endsWith('/memory/read'))return{turn:3,textVersion:'v3',busy:false,record:null,pendingSummary:{token:'layout-candidate',turn:3,textVersion:'v3',data:{facts:[]},merge:{added:Array.from({length:12},(_,i)=>({id:'n'+i,kind:'keywords',next:{text:'合成审阅条目'+i},selected:true})),conflicts:[{id:'c99',kind:'facts',reason:'related-fact',old:[{描述:'旧约定'}],next:{描述:'新约定'}}],retained:[]}},settings:{enabled:false,macroTemplate:''},limits:{}};return{version:'0.1.0-beta.58',enabled:true,busy:false,turn:3,textVersion:'v3',initializable:false,limits:{},record:{sourceKind:'reply',engine:{variables:{数据:{角色:{生命值:90,金币:5}}}},diagnostics:{status:'success',errors:[],changes:[],corrections:[]}}}}};` });
  await page.addScriptTag({ content: await readFile(root + 'client.js', 'utf8') });
  await page.evaluate(() => { window.plugin.apply({ tavernUi: window.ui }); window.ReactDOM.createRoot(document.querySelector('#body')).render(window.panel.render({ gameId: 'synthetic' })); });
  await page.getByRole('button', { name: '处理当前回复', exact: true }).waitFor();
  await page.getByText('状态恢复与历史回放', { exact: true }).click();
  await page.getByLabel('状态备份JSON', { exact: true }).fill('{"synthetic":true}');
  if (!(await page.getByRole('button', { name: '预览恢复状态', exact: true }).isEnabled())) throw Error('Backup textarea input did not enable preview');
  const report = [];
  for (const tab of ['State', '记忆']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const selector = tab === 'State' ? page.getByRole('button', { name: '处理当前回复', exact: true }) : page.getByRole('button', { name: '确认采用已选增量', exact: true });
    await selector.waitFor();
    await page.evaluate(() => { document.querySelector('#body').firstElementChild.scrollTop = 0; });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 375, y: 650 }] });
    for (let y = 620; y >= 170; y -= 30) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 375, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('#body').firstElementChild.scrollTop > 0);
    const touchScroll = await page.evaluate(() => document.querySelector('#body').firstElementChild.scrollTop);
    await cdp.detach();
    const metrics = await page.evaluate(() => { const element = document.querySelector('#body').firstElementChild; element.scrollTop = element.scrollHeight; return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, overflow: getComputedStyle(element).overflowY }; });
    metrics.touchScroll = touchScroll;
    await selector.scrollIntoViewIfNeeded();
    const box = await selector.boundingBox();
    if (!(metrics.scrollHeight > metrics.clientHeight && metrics.scrollTop > 0 && metrics.overflow === 'auto' && box.y >= 52 && box.y + box.height < 844 - 60)) throw Error('Scrolling/foot clearance failed: ' + JSON.stringify({ tab, metrics, box }));
    await page.screenshot({ path: output + '/' + (tab === 'State' ? 'state' : 'memory') + '-390x844.png', fullPage: false });
    report.push({ tab, metrics, button: box });
  }
  await page.getByRole('tab', { name: 'State', exact: true }).click();
  await page.getByText('批量历史状态回填', { exact: true }).click();
  await page.evaluate(() => {
    const original = window.ui.callHost;
    window.batchCalls = [];
    window.ui.callHost = async function(name, args) {
      if (name.includes('/history-batch-')) {
        window.batchCalls.push({ name, args });
        if (name.endsWith('/history-batch-inspect')) return { token: 'synthetic-layout-token', turn: 3, textVersion: 'v3', expired: false,
          targets: Array.from({ length: 30 }, (_, i) => ({ turn: i + 1, textVersion: 'synthetic-' + i, replacesExisting: true, outputDigest: 'a'.repeat(64) })) };
        throw Error('No batch mutation is permitted in layout fixture');
      }
      return original.call(this, name, args);
    };
  });
  await page.getByRole('button', { name: '查看或恢复回填计划', exact: true }).click();
  const confirmBatch = page.getByRole('button', { name: '确认执行或续跑回填', exact: true });
  await confirmBatch.waitFor();
  await confirmBatch.scrollIntoViewIfNeeded();
  const batchBox = await confirmBatch.boundingBox();
  const hit = await confirmBatch.evaluate(el => { const r = el.getBoundingClientRect(); const found = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return found === el || el.contains(found); });
  if (!hit || batchBox.y < 52 || batchBox.y + batchBox.height >= 784) throw Error('Batch confirm is obscured: ' + JSON.stringify(batchBox));
  page.once('dialog', dialog => dialog.dismiss());
  await confirmBatch.click();
  const batchCalls = await page.evaluate(() => window.batchCalls.map(call => call.name));
  if (batchCalls.some(name => !name.endsWith('/history-batch-inspect'))) throw Error('Restoration or cancelled confirmation mutated batch state');
  await page.screenshot({ path: output + '/batch-390x844.png', fullPage: false });
  report.push({ tab: '批量回填', button: batchBox, unobscured: hit, calls: batchCalls });
  if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, viewport: '390x844', report }, null, 2));
} finally { await browser.close(); }
