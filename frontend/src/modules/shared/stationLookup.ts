// Master Station Lookup utility
// Placeholder helper - to be populated with master station mapping data

import type { Station } from './types';

export const masterStations: Record<string, Station> = {};

export function getStationById(id: string): Station | undefined {
  return masterStations[id];
}
