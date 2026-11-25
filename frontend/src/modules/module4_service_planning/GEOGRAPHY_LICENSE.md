# Geography and equity data licenses

The OpenStreetMap-derived database in [data/district-geography.json](data/district-geography.json) is **? OpenStreetMap contributors** and is distributed under the **Open Data Commons Open Database License 1.0 (ODbL-1.0)**. The file is the complete machine-readable derived display database. The dashboard also links to it from the map. Retain the copyright, source and license notices with any distribution and apply ODbL 1.0 to redistributed adaptations of the database. The dashboard code has its own license. [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright) ? [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)

Display revision module3-v1-geography-osm.1 uses OpenStreetMap relation snapshots retrieved on 2026-11-25. The export selected the eight administrative units, joined member ways, standardized ring winding, and added the dashboard IDs, labels and version record. It retains source coordinates. The two declared level 4 relations represent entire federal territories. The Selangor units use level 6 administrative district relations.

| District | V1 ID | OSM relation | Relation version |
| --- | --- | --- | ---: |
| Klang | 1001 | [12391135](https://www.openstreetmap.org/relation/12391135) | 18 |
| Kuala Langat | 1002 | [10743362](https://www.openstreetmap.org/relation/10743362) | 8 |
| Hulu Langat | 1006 | [12438351](https://www.openstreetmap.org/relation/12438351) | 18 |
| Petaling | 1008 | [12391134](https://www.openstreetmap.org/relation/12391134) | 45 |
| Gombak | 1009 | [12438352](https://www.openstreetmap.org/relation/12438352) | 28 |
| Sepang | 1010 | [10743315](https://www.openstreetmap.org/relation/10743315) | 14 |
| Kuala Lumpur | 1400 | [2939672](https://www.openstreetmap.org/relation/2939672) | 107 |
| Putrajaya | 1601 | [4443881](https://www.openstreetmap.org/relation/4443881) | 32 |

The mixed-vintage source relation and member timestamps are recorded in the GeoJSON.

## Regenerated equity database

Revision `module3-v1-equity-osm.1` independently joins the pinned OpenStreetMap administrative polygons to Prasarana Rapid Rail KL GTFS stop points. It then recomputes station coverage, published station-origin activity and six equity screens. The historical Step 4 and 4B study used PLANMalaysia boundaries. Their original research records remain local.

The OSM-dependent join, edge distances and district groupings in [data/equity.json](data/equity.json) are distributed as an **ODbL 1.0 derivative database** with credit to **© OpenStreetMap contributors**. Apply ODbL share-alike when publicly redistributing adaptations of the database. The map offers both complete machine-readable publication files. Keep those downloads available without charge online and retain the source and license notices when distributing the data or rendering maps from them. No ODbL claim is made on unrelated independent assets or on other source rights. [ODbL 1.0, sections 4.2–4.6](https://opendatacommons.org/licenses/odbl/1-0/) · [OSM attribution](https://www.openstreetmap.org/copyright)

Prasarana provides the station coordinates, routes and names through Malaysia's Official Open API. Prasarana and the Ministry of Transport provide underlying Rapid Rail OD counts via data.gov.my. The Department of Statistics Malaysia provides the income, poverty and population denominators. These source contents retain their **CC BY 4.0** terms and credits. The publication modifies them through point-in-polygon assignment, station grouping, daily reconciliation, aggregation and screening. The original sources remain independently obtainable. [GTFS license](https://developer.data.gov.my/realtime-api/gtfs-static.en#license) · [Rapid Rail OD](https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily) · [District income](https://data.gov.my/data-catalogue/hh_income_district) · [District poverty](https://data.gov.my/data-catalogue/hh_poverty_district) · [District population](https://data.gov.my/data-catalogue/population_district) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
