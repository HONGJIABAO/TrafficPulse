// Exercise the production frontend window selector and asset validator on the corrected data.
import assert from 'node:assert/strict';
import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';

const front = new URL('../../../frontend/src/modules/module3_drivers_forecast/', import.meta.url);
const progress = new URL('../../data/processed/module3_lrt3/v1_calendar_dependency_progress.jsonl', import.meta.url);
const app = await import(new URL('analytics.ts', front));
const { validate } = await import(new URL('dataClient.ts', front));
const get = (name) => validate(name, JSON.parse(readFileSync(new URL(`data/${name}.json`, front), 'utf8')));
let result;
try {
  const network = get('network');
  const research = get('research');
  assert.equal(get('manifest').dataRevision, 'module3-v1-verified-calendar.2');
  let count = 0;
  for (const target of app.targetOptions(network)) {
    for (const horizon of [30, 60, 90]) {
      for (const scope of ['full', 'future']) {
        const points = network.daily[target.value].slice(0, horizon)
          .filter(([day]) => scope === 'full' || app.isFutureDate(day, network.asOf));
        const window = app.getWindow(network, target.value, horizon, scope);
        assert.deepEqual([window.days, window.start, window.end], [points.length, points[0][0], points.at(-1)[0]]);
        assert(Math.abs(window.total - app.sum(points.map(([, value]) => value))) < 1e-6);
        count++;
      }
    }
  }
  const future = app.getWindow(network, network.networkId, 90, 'future');
  assert.deepEqual([app.num(future.total), app.num(future.average), app.signed(future.change_pct, 2, '%'), future.days],
    ['63,418,661', '960,889', '-2.43%', 66]);
  const revisedTerminal = research.metrics.find((row) => row.series_id === network.networkId &&
    row.phase === 'terminal_holdout' && row.horizon_days === 14 && row.model_id === 'bottom_up_selected_components');
  assert.equal(app.pct(revisedTerminal.wape_pct), '3.57%');
  result = { status: 'PASS', actual: { windows: count, futureTrips: app.num(future.total), terminalWape: app.pct(revisedTerminal.wape_pct) } };
} catch (error) {
  process.exitCode = 1;
  result = { status: 'FAIL', actual: error.stack };
}
const record = {
  event: 'regression', test_id: 'CAL-09', time_myt: new Date(Date.now() + 8 * 3600000).toISOString().replace('Z', '+08:00'),
  name: 'Production frontend helpers and asset contract',
  expected: '48 active windows, corrected headline totals and terminal formatting',
  method: 'Node with the actual TypeScript helpers, validator and final JSON', tolerance: '1e-6 absolute for totals and exact display formatting',
  ...result,
};
const handle = openSync(progress, 'a');
try {
  writeSync(handle, JSON.stringify(record) + '\n');
  fsyncSync(handle);
} finally {
  closeSync(handle);
}
console.log(record.test_id, result.status, result.actual);
