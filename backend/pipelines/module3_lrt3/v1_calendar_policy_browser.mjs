import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, createReadStream, fsyncSync, openSync, writeSync } from 'node:fs';
import { access, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { freemem } from 'node:os';

const dist = resolve(process.argv[3]);
const folder = dirname(dist);
const progress = process.env.TRAFFICPULSE_TEST_PROGRESS;
function checkpoint(test_id, description, actual) {
  const time_myt = new Date(Date.now() + 8 * 3600_000).toISOString().replace('Z', '+08:00');
  const fields = { event: 'browser_check', test_id, time_myt, status: 'PASS', description, actual, method: 'Local production build in headless Chrome via CDP' };
  const handle = openSync(progress, 'a');
  try {
    writeSync(handle, JSON.stringify(fields) + '\n');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  console.log(test_id + ' PASS ' + description);
}
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.geojson': 'application/geo+json' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  try {
    if (!file.startsWith(dist + sep)) throw new Error('Invalid local path');
    await access(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');

const profile = await mkdtemp(resolve(folder, 'browser-profile-'));
const browser = spawn(process.argv[2], ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-sync', '--disable-extensions', '--renderer-process-limit=1',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0',
  '--window-size=1280,930', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserError;
let browserOutput = '';
browser.on('error', (error) => { browserError = error; });
browser.stderr.on('data', (chunk) => { browserOutput = (browserOutput + chunk.toString()).slice(-8000); });
let socket;

async function until(check, name, timeout = 9000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (freemem() < 650 * 1048576) throw new Error('Browser memory guard: available memory fell below 650 MiB');
    const value = await check();
    if (value) return value;
    await delay(75);
  }
  throw new Error('Timed out waiting for ' + name);
}

try {
  const port = await until(async () => {
    if (browserError) throw browserError;
    if (browser.exitCode !== null) throw new Error('Browser process exited ' + browser.exitCode);
    return (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).trim().split(/\r?\n/)[0];
  }, 'Chrome DevTools port', 16000);
  console.log('Headless Chrome opened DevTools port ' + port);
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json();
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
  console.log('Connected to Chrome DevTools');
  let id = 0;
  const pending = new Map();
  const events = [];
  const requests = [];
  let capture = false;
  socket.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const match = pending.get(msg.id);
      if (!match) return;
      pending.delete(msg.id);
      if (msg.error) match.reject(new Error(JSON.stringify(msg.error)));
      else match.resolve(msg.result);
    } else if (capture) {
      if (msg.method === 'Runtime.exceptionThrown') events.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
        events.push(msg.params.args.map((arg) => arg.value ?? arg.description).join(' '));
      if (msg.method === 'Network.responseReceived') {
        const response = msg.params.response;
        if (response.url.startsWith('http://127.0.0.1:')) {
          requests.push(response.url);
          if (response.status >= 400) events.push(response.status + ' ' + response.url);
        }
      }
    }
  });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Chrome did not respond to ' + method));
      }, 12000);
      pending.set(requestId, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  async function page(fn, ...args) {
    const expression = '(' + fn + ')(' + args.map((arg) => JSON.stringify(arg)).join(',') + ')';
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Page.enable');
  await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  console.log('Loaded local production entry URL');
  await until(() => page(() => Boolean([...document.querySelectorAll('nav button')].find((el) => el.textContent.includes('Demand Drivers & Forecasting')))), 'App navigation');
  capture = true;
  await page(() => [...document.querySelectorAll('nav button')].find((el) => el.textContent.includes('Demand Drivers & Forecasting')).click());
  const text = () => page((selector) => document.querySelector(selector)?.innerText ?? '', '[role="tabpanel"]:not([hidden])');
  const has = (phrase) => until(async () => (await text()).includes(phrase), phrase);
  const button = (group, label) => page((name, value) => {
    const selected = document.querySelector('[role="group"][aria-label="' + name + '"]');
    [...selected.querySelectorAll('button')].find((el) => el.textContent === value).click();
  }, group, label);
  const select = (label, value) => page((name, option) => {
    const control = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) label')].find((el) => el.firstElementChild.textContent === name).querySelector('select');
    if (![...control.options].some((el) => el.value === option)) throw new Error('Unknown option ' + option + ' in ' + name);
    control.value = option;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }, label, value);
  const details = (label) => page((name) => {
    const item = [...document.querySelectorAll('summary')].find((el) => el.querySelector('strong')?.textContent === name);
    if (!item.parentElement.open) item.click();
  }, label);
  const table = (label) => page((name) => document.querySelector('table[aria-label="' + name + '"]')?.innerText, label);
  const chart = (name) => until(() => page((label) => {
    const canvas = document.querySelector('[aria-label="' + label + '"] canvas');
    return canvas?.width > 120 && canvas.height > 120;
  }, name), name + ' canvas');
  const tab = async (title) => {
    await page((name) => [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === name).click(), title);
    await until(() => page((name) => document.querySelector('[role="tabpanel"]:not([hidden]) h2')?.textContent === name, title), title + ' tab heading');
    assert(await page(() => [...document.querySelectorAll('[role="tabpanel"][hidden]')].every((el) => !el.hasChildNodes())));
  };


  const readAsset = async (name) => {
    const files = await readdir(resolve(dist, 'assets'));
    const file = files.find((path) => path.startsWith(name + '-') && path.endsWith('.json'));
    assert(file);
    return JSON.parse(await readFile(resolve(dist, 'assets', file), 'utf8'));
  };
  const network = await readAsset('network');
  const format = (value, digits = 0) => new Intl.NumberFormat('en-MY', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(value);

  await tab('Future Outlook');
  await has('63,418,661');
  await has('960,889');
  await has('-2.43%');
  await chart('Daily forecast for the published Rapid Rail service sum');
  for (const horizon of [30, 60, 90]) {
    await button('Forecast horizon from cutoff', horizon + ' days');
    for (const [scope, label] of [['future', 'After reference date'], ['full', 'Full cutoff window']]) {
      await button('Forecast view', label);
      const row = network.outlook.find((item) => item.series_id === network.networkId && item.horizon === horizon && item.scope === scope);
      await has(format(row.total));
      await has(row.days + ' forecast days');
    }
  }
  assert.match(await table('Headline forecast comparisons'), /90-day watchlist signal/);
  await has('Published 90-day assessment');
  checkpoint('CH-01', 'Updated headline outlook and watchlist', 'All six scopes and horizons, corrected 66-day KPI, chart and explicit watchlist scope.');

  await tab('Demand Forecast');
  await has('Verified holiday calendar');
  await chart('Rapid Rail service sum historical and forecast trips');
  await details('Terminal holdout results');
  await has('3.57%');
  await has('2.54%');
  await has('retrospective replay of an already inspected period');
  assert.match(await table('Terminal holdout results'), /Scored pairs.*Unique target dates/);
  await details('Direct versus bottom-up network comparison');
  await has('retrospective evidence under the active calendar policy');
  await select('Stability experiment', 'network_common_origins');
  await until(() => table('Forecast stability results'), 'corrected common-origins comparison');
  await select('Forecast target', 'rail_lrt_ampang');
  await has('Retained model');
  await chart('Ampang / Sri Petaling historical and forecast trips');
  await select('Forecast target', 'lrt3_station_origin_od');
  await has('repeated weekly profile');
  checkpoint('CH-02', 'Corrected metrics and forecast methodology', 'Verified-only Ridge messaging, unchanged OD interpretation, corrected terminal and network comparison.');

  await tab('Demand Drivers');
  await select('Demand pattern target', 'lrt3_station_origin_od');
  await has('37.29%');
  const holidayTable = await table('Observed holiday comparisons');
  assert.match(holidayTable, /Control-date uses/);
  assert.match(holidayTable, /\s3\s+23\s/);
  await has('8.93%');
  checkpoint('CH-03', 'Preserved holiday contrasts and ablation', '3 verified dates, 23 control-date uses, ?37.29% and preserved 28-day ablation.');

  await tab('Service Readiness');
  const service = await readAsset('service');
  const kelana = service.intensity.find((row) => row.series_id === 'rail_lrt_kj');
  const rows = await until(() => table('Network service intensity'), 'intensity rows');
  const kelanaRow = rows.split('\n').find((line) => line.includes('Kelana Jaya'));
  assert(kelanaRow.includes(format(kelana.forecast_published_trips_per_reference_departure, 1)));
  await has('Combined Ampang / Sri Petaling intensity unavailable');
  await has('142,896');
  await chart('Matched-date LRT3 proxy station-origin trips by time window');
  await select('Peak forecast date', '2026-12-25');
  await has('Dated supply unavailable');
  checkpoint('CH-04', 'Revised service intensity and invariant capacity', 'Corrected component demand ratio; shared-trunk exclusion, 142,896 nominal places and Christmas unavailable.');

  await details('Methodology & Data Sources');
  await details('Holiday evidence and active forecasting policy');
  await until(() => page(() => document.body.innerText.includes('Historical release and revision vintages are unavailable')), 'calendar vintage caveat');
  await details('Validated static assets');
  await until(() => page(() => document.body.innerText.includes('module3-v1-verified-calendar.2')), 'active manifest revision');
  await delay(200);
  assert.deepEqual(events, [], 'Unexpected Module 3 runtime warnings or errors');
  checkpoint('CH-05', 'Revision and source methodology', 'Current manifest, historical-vintage limitation and no runtime errors during affected tab checks.');
  server.closeAllConnections();
  socket.close();
} catch (error) {
  if (browserOutput) console.error(browserOutput);
  throw error;
} finally {
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  if (browser.exitCode === null) browser.kill();
  server.closeAllConnections();
  server.close();
}
