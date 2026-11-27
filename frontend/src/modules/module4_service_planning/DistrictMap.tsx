import { useEffect, useRef } from 'react';
import { control, geoJSON, map } from 'leaflet';
import type { GeoJSON as LeafletGeoJSON } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Geography } from './contracts';
import { districtGeographyUrl } from './dataClient';
import s from './dashboard.module.css';

export type MapValue = { label: string; value: string; classification: string; color: string };

export default function DistrictMap({ geography, values, selected, onSelect }: {
  geography: Geography; values: Record<string, MapValue>; selected: string; onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const polygons = useRef<LeafletGeoJSON | null>(null);
  const select = useRef(onSelect);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => {
    if (!container.current) return;
    const view = map(container.current, { scrollWheelZoom: false, maxZoom: 12, zoomSnap: 0.25, attributionControl: false });
    control.attribution({ prefix: false }).addAttribution(
      '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' +
      ` · <a href="${districtGeographyUrl}" download="district-geography.geojson">GeoJSON (ODbL)</a>`,
    ).addTo(view);
    control.scale({ imperial: false }).addTo(view);
    const boundaries = geoJSON(geography, {
      onEachFeature: (feature, layer) => {
        const id: string = feature.properties.district_id;
        layer.on('click', () => select.current(id));
      },
    }).addTo(view);
    polygons.current = boundaries;
    view.fitBounds(boundaries.getBounds(), { padding: [16, 16] });
    const resizes = new ResizeObserver(() => view.invalidateSize({ pan: false }));
    resizes.observe(container.current);
    return () => {
      resizes.disconnect();
      view.remove();
      polygons.current = null;
    };
  }, [geography]);

  useEffect(() => {
    const overlay = polygons.current;
    if (!overlay) return;
    overlay.setStyle((feature) => {
      const id: string = feature?.properties.district_id;
      return { fillColor: values[id]?.color ?? '#aeb8c9', fillOpacity: id === selected ? 0.91 : 0.72,
        weight: id === selected ? 3 : 1.25, color: id === selected ? '#132744' : '#526581', opacity: .95 };
    });
    overlay.eachLayer((layer) => {
      if (!('feature' in layer)) return;
      const feature = layer.feature as Geography['features'][number];
      const item = values[feature.properties.district_id];
      if (!item) return;
      const text = document.createElement('span');
      text.textContent = `${feature.properties.district} · ${item.label}: ${item.value} · ${item.classification}`;
      layer.unbindTooltip().bindTooltip(text, { sticky: true });
    });
  }, [geography, values, selected]);

  return <div ref={container} className={s.map} aria-label="Interactive administrative district map"
    role="region" />;
}
