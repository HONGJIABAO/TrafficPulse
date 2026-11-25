import { use } from 'react';
import type { AssetMap } from './contracts';

export const districtGeographyUrl = new URL('./data/district-geography.json', import.meta.url).href;
export const equityDataUrl = new URL('./data/equity.json', import.meta.url).href;

const assets = {
  manifest: new URL('./data/manifest.json', import.meta.url).href,
  network: new URL('./data/network.json', import.meta.url).href,
  history: new URL('./data/history.json', import.meta.url).href,
  research: new URL('./data/research.json', import.meta.url).href,
  patterns: new URL('./data/patterns.json', import.meta.url).href,
  service: new URL('./data/service.json', import.meta.url).href,
  equity: equityDataUrl,
  geography: districtGeographyUrl,
  methodology: new URL('./data/methodology.json', import.meta.url).href,
};

type Asset = keyof AssetMap;
const cache = new Map<Asset, Promise<unknown>>();
const arrayKeys: Record<Asset, string[]> = {
  manifest: [], network: ['components', 'outlook', 'watchlist', 'scenarios'], history: [], research: ['metrics', 'cold', 'coldFolds', 'stability', 'ablation'],
  patterns: ['patterns'], service: ['routes', 'hourly', 'periods', 'intensity', 'calendar', 'nominal', 'holidayDatesWithoutSupply'],
  equity: ['districts', 'screens', 'stationContributions'], geography: ['features'], methodology: ['sources', 'sections', 'interventions'],
};
const recordKeys: Record<Asset, string[]> = {
  manifest: ['assets', 'inputSha256', 'schemas', 'validation'], network: ['targets', 'daily', 'watchRules', 'scenarioAssumptions'], history: ['series'],
  research: ['alternatives', 'uncertainty', 'experimentContext'],
  patterns: ['holidayCalendar'], service: ['profiles', 'capacity', 'supply'], equity: ['coverage', 'socioeconomic', 'policy'], geography: [], methodology: ['snapshot', 'outcomes'],
};

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

function validScenarios(data: Record<string, unknown>) {
  if (typeof data.odId !== 'string' || !isObject(data.daily) || !Array.isArray(data.scenarios)) return false;
  const dates = data.daily[data.odId];
  if (!Array.isArray(dates) || dates.length !== 90 || dates.length !== data.scenarios.length) return false;
  return data.scenarios.every((row, index) => {
    const point = dates[index];
    if (!Array.isArray(row) || row.length !== 5 || !Array.isArray(point)) return false;
    const [date, lead, low, base, high] = row;
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date === point[0] &&
      (index === 0 || dates[index - 1][0] < date) && lead === index + 1 && lead === point[2] &&
      [low, base, high].every((value: unknown) => typeof value === 'number' && Number.isFinite(value)) &&
      low >= 0 && low <= base && base <= high && base === point[1];
  });
}

export function validate<K extends Asset>(name: K, data: unknown): AssetMap[K] {
  if (!isObject(data) || data.schemaVersion !== 1 || arrayKeys[name].some((k) => !Array.isArray(data[k])) ||
      recordKeys[name].some((k) => !isObject(data[k])) || (name === 'geography' && data.type !== 'FeatureCollection')) {
    throw new Error(`The ${name} dataset has an unsupported schema.`);
  }
  if (name === 'network' && !validScenarios(data)) {
    throw new Error('The network dataset has incomplete or invalid LRT3 planning scenarios.');
  }
  return data as AssetMap[K];
}

export function loadAsset<K extends Asset>(name: K): Promise<AssetMap[K]> {
  const existing = cache.get(name);
  if (existing) return existing as Promise<AssetMap[K]>;
  const promise = fetch(assets[name]).then(async (response) => {
    if (!response.ok) throw new Error(`The ${name} dataset could not be loaded (${response.status}).`);
    return validate(name, await response.json());
  });
  cache.set(name, promise);
  return promise;
}

export function useAsset<K extends Asset>(name: K): AssetMap[K] {
  return use(loadAsset(name));
}

export function retryAssets() {
  cache.clear();
}
