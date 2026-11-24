import type { GeoJSON, Position } from 'geojson';

// Display-only inset: move East Malaysia nearer and use 70% of the west's scale.
// Raw station/route coordinates and all analytical values remain untouched.
export const ATLAS_BOUNDS: [[number, number], [number, number]] = [[99.45, .8], [111.7, 7.5]];
export function atlasPoint(p: Position): Position {
  return p[0] > 108 ? [105 + (p[0] - 110) * .7, 1.3 + (p[1] - 1.3) * .7] : [...p];
}
export function geographicPoint(p: Position): [number, number] {
  return p[0] > 104.7 ? [110 + (p[0] - 105) / .7, 1.3 + (p[1] - 1.3) / .7] : [p[0], p[1]];
}
export function atlasData<T extends GeoJSON>(data: T, compact = true): T {
  if (!compact) return data;
  const copy = structuredClone(data);
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const object = node as Record<string, unknown>;
    if ('coordinates' in object) {
      const coordinates = (value: unknown): unknown => Array.isArray(value)
        ? typeof value[0] === 'number' ? atlasPoint(value as Position) : value.map(coordinates) : value;
      object.coordinates = coordinates(object.coordinates);
    } else Object.values(object).forEach(walk);
  };
  walk(copy);
  return copy;
}
