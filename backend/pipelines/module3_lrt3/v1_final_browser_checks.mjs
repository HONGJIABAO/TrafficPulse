import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, createReadStream, fsyncSync, openSync, writeSync } from 'node:fs';
import { access, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { freemem } from 'node:os';

const dist = resolve(process.argv[3]);
const folder = resolve(process.env.TRAFFICPULSE_BROWSER_OUTPUT);
const progress = process.env.TRAFFICPULSE_TEST_PROGRESS;
function checkpoint(test_id, status, description, actual) {
  const time_myt = new Date(Date.now() + 8 * 3600_000).toISOString().replace('Z', '+08:00');
  const fields = { event: 'browser_check', test_id, time_myt, status, description, actual, method: 'Local production build in headless Chrome via CDP' };
  const handle = openSync(progress, 'a');
  try {
    writeSync(handle, JSON.stringify(fields) + '\n');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  console.log(test_id + ' ' + status + ' ' + description);
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
    const selected = document.querySelector('[role="tabpanel"]:not([hidden]) [role="group"][aria-label="' + name + '"]');
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


  const research = await readAsset('research');
  const service = await readAsset('service');
  const manifest = await readAsset('manifest');
  const row = (label, match) => until(async () => {
    const data = await table(label);
    return data?.split('\n').find((line) => line.includes(match));
  }, match + ' in ' + label);
  const kpi = (label) => page((name) => [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) article')]
    .find((element) => element.querySelector('p')?.textContent === name)?.querySelector('strong')?.textContent, label);
  const kpiEquals = (label, value) => until(async () => await kpi(label) === value, label + ' = ' + value);
  const hover = async (label, position, expected) => {
    await chart(label);
    const bounds = await page((name) => {
      const node = document.querySelector('[aria-label="' + name + '"]');
      node.scrollIntoView({ block: 'center', inline: 'nearest' });
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }, label);
    const [x, y] = position(bounds);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) });
    return until(async () => {
      const text = await page((name) => document.querySelector('[aria-label="' + name + '"]')?.innerText, label);
      return expected.every((item) => text?.includes(item)) ? text.trim() : false;
    }, 'chart tooltip ' + expected.join(' / '), 2500);
  };
  const dateFormat = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(iso + 'T00:00:00Z'));
  let failed = false;
  async function group(id, description, fn) {
    try {
      if (freemem() < 650 * 1048576) throw new Error('Browser memory guard below 650 MiB before ' + id);
      checkpoint(id, 'PASS', description, await fn());
    } catch (error) {
      checkpoint(id, 'FAIL', description, { error: error.stack });
      failed = true;
      if (/memory guard|Chrome did not respond/.test(error.message)) throw error;
    }
  }

  await group('FB-A', 'Revised Future Outlook and watchlist', async () => {
    await tab('Future Outlook');
    await kpiEquals('Forecast service-sum trips', '63,418,661');
    await kpiEquals('Forecast average trips per day', '960,889');
    await kpiEquals('Change vs weekday-matched baseline', '-2.43%');
    await has('66 forecast days');
    const results = [];
    const labels = ['Ampang / Sri Petaling', 'Kelana Jaya', 'MRT Kajang', 'MRT Putrajaya', 'KL Monorail', 'Shah Alam headline'];
    for (const horizon of [30, 60, 90]) {
      await button('Forecast horizon from cutoff', horizon + ' days');
      for (const [scope, label] of [['future','After reference date'],['full','Full cutoff window']]) {
        await button('Forecast view', label);
        const match = (id) => network.outlook.find((r) => r.series_id === id && r.horizon === horizon && r.scope === scope);
        const net = match(network.networkId);
        await kpiEquals('Forecast service-sum trips', format(net.total));
        await kpiEquals('Forecast average trips per day', format(net.average));
        await has(net.days + ' forecast days');
        for (const [i, id] of network.components.entries()) {
          assert((await row('Headline forecast comparisons', labels[i])).includes(format(match(id).average)));
          const saved = network.watchlist.find((p) => p.series_id === id &&
            p.view === (scope === 'full' ? 'full_90_day' : 'future_only_after_as_of'));
          assert((await row('Predictive demand watchlist', labels[i])).includes(format(saved.forecast_mean_daily_trips)));
        }
        const expected = network.daily[network.networkId].slice(0, horizon)
          .filter(([date]) => scope === 'full' || date > network.asOf);
        const index = Math.floor(expected.length * .67);
        const [date, value] = expected[index];
        await hover('Daily forecast for the published Rapid Rail service sum',
          (b) => [b.x + 61 + (b.width - 85) * index / (expected.length - 1), b.y + 70], [date, format(value)]);
        results.push({ horizon, scope, days: net.days, trips: format(net.total), verifiedChartDate: date, chartTrips: format(value) });
      }
    }
    await has('Shah Alam forecast stability');
    assert.match(await table('Headline forecast comparisons'), /90-day watchlist signal/);
    assert.match(await row('Headline forecast comparisons', 'Shah Alam headline'), /Elevated uncertainty/);
    assert.equal(results.at(-1).trips, '87,042,547');
    return { results, futureMean: '960,889', futureChange: '-2.43%', futureDays: 66 };
  });

  await group('FB-B', 'Corrected Ridge, network evidence and preserved LRT3 research', async () => {
    await tab('Demand Forecast');
    await has('Verified holiday calendar');
    await details('Terminal holdout results');
    await has('3.57%');
    await has('2.54%');
    await has('retrospective replay of an already inspected period');
    assert.match(await table('Terminal holdout results'), /Scored pairs.*Unique target dates/);
    await details('Direct versus bottom-up network comparison');
    await has('retrospective evidence under the active calendar policy');
    await select('Stability experiment', 'network_common_origins');
    await until(async () => (await table('Forecast stability results'))?.includes('4.16%'), 'corrected bottom-up Ridge comparison');
    await select('Forecast target', 'rail_lrt_ampang');
    const wapeRow = await row('Rolling-origin model comparison', 'Ridge Regression');
    assert.match(wapeRow, /6\.46%/);
    assert.doesNotMatch(wapeRow, /6\.41%/);
    await select('Forecast target', 'lrt3_station_origin_od');
    await has('repeated weekly profile');
    await button('Forecast horizon', '30 days');
    for (const [label, index] of [['Base',3],['Low',2],['High',4]]) {
      await button('LRT3 planning scenario', label);
      await kpiEquals('Cumulative forecast trips', format(network.scenarios.slice(0,30).reduce((sum, p) => sum+p[index], 0)));
    }
    await details('Cold-start donor experiments');
    await has('did not produce a consistent improvement over Seasonal Naive');
    const cold = await until(() => table('Cold-start donor profile experiments'), 'donor table');
    for (const item of research.cold.filter((r) => r.series_id === network.odId && r.horizon_days === 28 && ['transfer_50','seasonal_naive'].includes(r.arm))) {
      assert(cold.includes(format(item.wape_pct,2) + '%'));
    }
    return { terminal: ['3.57%', '2.54%'], rollingAmpang: '6.46%', bottomUpRidge: '4.16%', scenarios: 3, donorFinding: 'Preserved' };
  });

  await group('FB-C', 'Descriptive holidays, tooltip statuses and feature interpretation', async () => {
    await tab('Demand Drivers');
    await select('Demand pattern target', 'lrt3_station_origin_od');
    const holidays = await row('Observed holiday comparisons', '37.29%');
    assert.match(holidays, /\s3\s+23\s/);
    assert.match(holidays, /-37\.29%/);
    await has('Configuration C adds a holiday flag and a coverage indicator together');
    assert.match(await table('Mature-service ablation overview'), /8\.93%/);
    const tooltips = [];
    for (const [day, status, name] of [
      ['2026-08-31', 'Verified in the archive', 'LRT3 station-origin OD'],
      ['2026-11-09', 'Tentative holiday', 'LRT3 station-origin OD'],
      ['2026-09-02', 'Known non-holiday in the archive', 'LRT3 station-origin OD'],
      ['2025-08-01', 'Holiday calendar unknown', 'Kelana Jaya'],
    ]) {
      const year = day.slice(0,4);
      if (name === 'Kelana Jaya') {
        await select('Demand pattern target', 'rail_lrt_kj');
        await select('Observation year', year);
      }
      const current = new Date(day + 'T00:00:00Z');
      const first = new Date(year + '-01-01T00:00:00Z');
      const last = new Date(year + '-12-31T00:00:00Z');
      const weekday = (d) => (d.getUTCDay() + 6) % 7;
      const column = Math.floor(((current - first) / 86400000 + weekday(first)) / 7);
      const weeks = Math.floor(((last - first) / 86400000 + 1 + weekday(first) + 6) / 7);
      await hover(name + ' calendar heatmap, ' + year,
        (b) => [b.x + 32 + (b.width - 46) / weeks * (column + .5), b.y + 32 + weekday(current) * 16 + 8],
        [dateFormat(day), status]);
      tooltips.push({ day, status });
    }
    return { holidayRow: holidays, tooltips, ablation: 'Explicit holiday and coverage bundle' };
  });

  await group('FB-D', 'Headline intensity, unchanged scheduled supply and peak cohort safeguards', async () => {
    await tab('Service Readiness');
    const kelana = service.intensity.find((r) => r.series_id === 'rail_lrt_kj');
    assert((await row('Network service intensity','Kelana Jaya')).includes(format(kelana.forecast_published_trips_per_reference_departure,1)));
    await has('Combined Ampang / Sri Petaling intensity unavailable');
    await kpiEquals('Frequency-implied terminal departures', '229');
    await kpiEquals('Places per three-car train', '624');
    await kpiEquals('Nominal places per reference day', '142,896');
    await chart('Hourly frequency-implied terminal departures');
    await has('62 selected forecast dates');
    await has('same 56 supply-eligible dates');
    const am = await row('Peak sensitivity by time window', 'AM peak');
    assert.match(am, /8,445/);
    assert.match(am, /18,720/);
    await select('KTM proxy profile','port_klang_west');
    assert.match(await row('Peak sensitivity by time window','AM peak'), /11,010/);
    await chart('Matched-date LRT3 proxy station-origin trips by time window');
    await chart('Matched-date nominal terminal places by time window');
    await has('Assessing occupancy, spare capacity or overcrowding requires observed service and passenger counts');
    assert.doesNotMatch(await table('Peak sensitivity by time window'), /spare capacity|occupancy/i);
    await select('Peak forecast date','2026-12-25');
    await has('Dated supply unavailable');
    assert.equal((await table('Peak sensitivity by time window')).match(/Unavailable/g).length,4);
    return { kelanaIntensity: format(kelana.forecast_published_trips_per_reference_departure,1),
      departures: 229, designPlaces: 624, nominalPlaces: 142896, cohorts: [62,56], matchedAM: [8445,11010], holidaySupply: 'Unavailable' };
  });

  await group('FB-E','Active revision, policy, methodology and manifest', async () => {
    await details('Methodology & Data Sources');
    await until(() => page(() => document.body.innerText.includes('3.57% WAPE versus 2.54%')), 'corrected methodology WAPE');
    await details('Holiday evidence and active forecasting policy');
    await details('Validated static assets');
    assert.equal(manifest.dataRevision,'module3-v1-verified-calendar.2');
    const doc = await until(() => page(() => {
      const text = document.body.innerText;
      return text.includes('Historical release and revision vintages are unavailable') && text.includes('module3-v1-verified-calendar.2') ? text : null;
    }), 'policy and revision statement');
    assert.match(doc, /Active Ridge forecasts and affected comparisons use the same verified-holiday indicator/);
    assert.match(doc, /replay uses one archived calendar snapshot/);
    assert.match(doc, /terminal window had already been inspected/);
    assert.doesNotMatch(doc, /63,776,402|86,857,767|3\.73% WAPE/);
    const sourceTable = await table('Static data export manifest');
    for (const [name,item] of Object.entries(manifest.assets)) assert(sourceTable.includes(name) && sourceTable.includes(item.sha256));
    return { revision:manifest.dataRevision, manifestRows:Object.keys(manifest.assets).length, vintageCaveat:true, historicalValuesNotActive:true };
  });

  await group('FB-F','Equity, all five tabs, console and teammate route smoke', async () => {
    await tab('Equity & Accessibility');
    await has('71,714,309');
    await has('3,265,221');
    const map = '[aria-label="Interactive administrative district map"]';
    await until(() => page((selector) => document.querySelector(selector)?.querySelectorAll('path.leaflet-interactive').length === 8, map), 'eight district polygons');
    await select('Selected district','1002');
    await has('Structural zero');
    await select('District map metric','origins_per_station');
    await has('Daily origins per physical station ? Unavailable');
    await button('Socioeconomic cohort','2024 ? 6 districts');
    await select('Equity screening rule','outer_quartiles');
    await has('Cohort size 6');
    const opened = [];
    for (const title of ['Future Outlook','Demand Forecast','Demand Drivers','Service Readiness','Equity & Accessibility']) {
      await tab(title);
      opened.push(title);
    }
    await delay(180);
    const moduleErrors = [...events];
    capture = false;
    const mounted = [];
    for (const item of ['Network Overview','OD Flow & Peak Hours','What-If Simulator']) {
      await page((label) => {
        const button = [...document.querySelectorAll('header nav button')].find((element) => element.textContent.includes(label));
        if (!button) throw new Error('Missing teammate route ' + label);
        button.click();
      }, item);
      await until(() => page(() => !document.querySelector('[role="tablist"][aria-label="Demand Drivers & Forecasting views"]') &&
        Boolean(document.querySelector('main')?.firstElementChild)), item + ' route mount');
      mounted.push(item);
    }
    assert.deepEqual(moduleErrors, [], 'Unexpected Module 3 console and failed asset events');
    return { opened, districtPolygons:8, mounted, consoleErrors:moduleErrors, requestedAssets:requests.length };
  });
  checkpoint('FB-CONSOLE', events.length ? 'FAIL' : 'PASS', 'Captured Module 3 console and asset errors', { errors: events });
  if (failed || events.length) process.exitCode = 1;
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
