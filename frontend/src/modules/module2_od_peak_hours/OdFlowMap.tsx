import React, { useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { ResolvedOdFlow } from './types';
import { formatMillions } from '@/modules/shared/types';

interface Props {
  flows: ResolvedOdFlow[];
  selectedFlowId?: string | null;
  onSelectFlow: (flow: ResolvedOdFlow) => void;
  selectedMode?: string;
  emptyReason?: string | null;
}

const KLANG_VALLEY_CENTER: [number, number] = [3.147, 101.693];
const PENINSULAR_CENTER: [number, number] = [4.21, 101.97];

function getBezierPoints(
  p0: [number, number],
  p1: [number, number],
  curvature: number = 0.22,
  numPoints: number = 24
): [number, number][] {
  const [lat0, lng0] = p0;
  const [lat1, lng1] = p1;
  const dLat = lat1 - lat0;
  const dLng = lng1 - lng0;
  const dist = Math.sqrt(dLat * dLat + dLng * dLng);
  if (dist < 0.0001) return [p0, p1];

  const midLat = (lat0 + lat1) / 2;
  const midLng = (lng0 + lng1) / 2;
  const normLat = -dLng / dist;
  const normLng = dLat / dist;
  const offset = Math.max(dist * curvature, 0.008);
  const cLat = midLat + normLat * offset;
  const cLng = midLng + normLng * offset;

  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const b0 = (1 - t) * (1 - t);
    const b1 = 2 * (1 - t) * t;
    const b2 = t * t;
    points.push([
      b0 * lat0 + b1 * cLat + b2 * lat1,
      b0 * lng0 + b1 * cLng + b2 * lng1,
    ]);
  }
  return points;
}

function MapFlyController({
  selectedFlow,
  viewPreset,
}: {
  selectedFlow?: ResolvedOdFlow | null;
  viewPreset: 'kv' | 'peninsular';
}) {
  const map = useMap();

  useEffect(() => {
    if (selectedFlow && selectedFlow.originCoords && selectedFlow.destCoords) {
      const midLat = (selectedFlow.originCoords[0] + selectedFlow.destCoords[0]) / 2;
      const midLng = (selectedFlow.originCoords[1] + selectedFlow.destCoords[1]) / 2;
      map.flyTo([midLat, midLng], 12, { duration: 1.0 });
    }
  }, [selectedFlow, map]);

  useEffect(() => {
    if (!selectedFlow) {
      if (viewPreset === 'kv') {
        map.flyTo(KLANG_VALLEY_CENTER, 10.5, { duration: 0.9 });
      } else {
        map.flyTo(PENINSULAR_CENTER, 7, { duration: 0.9 });
      }
    }
  }, [viewPreset, selectedFlow, map]);

  return null;
}

export const OdFlowMap: React.FC<Props> = ({
  flows,
  selectedFlowId,
  onSelectFlow,
  selectedMode = 'all',
  emptyReason,
}) => {
  const [presetOverride, setPresetOverride] = React.useState<{
    mode: string;
    preset: 'kv' | 'peninsular';
  } | null>(null);

  const viewPreset: 'kv' | 'peninsular' =
    presetOverride && presetOverride.mode === selectedMode
      ? presetOverride.preset
      : selectedMode === 'intercity'
        ? 'peninsular'
        : 'kv';

  const setViewPreset = (preset: 'kv' | 'peninsular') => {
    setPresetOverride({ mode: selectedMode, preset });
  };

  // Only plot flows with valid verified station coordinates and positive ridership
  const mappableFlows = useMemo(() => {
    return flows.filter(
      (f) => f.isVerifiedCoords && f.originCoords !== null && f.destCoords !== null && f.volume > 0
    );
  }, [flows]);

  const selectedFlow = useMemo(() => {
    return mappableFlows.find((f) => f.id === selectedFlowId) || null;
  }, [mappableFlows, selectedFlowId]);

  const maxDailyInView = useMemo(() => {
    return Math.max(...mappableFlows.map((f) => f.avgDaily), 1);
  }, [mappableFlows]);

  const stationNodes = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        coords: [number, number];
        inflow: number;
        outflow: number;
        total: number;
        mode: string;
      }
    >();

    mappableFlows.forEach((f) => {
      if (!f.originCoords || !f.destCoords) return;

      const oKey = f.originClean;
      const oCurr = map.get(oKey) || {
        name: f.originClean,
        coords: f.originCoords,
        inflow: 0,
        outflow: 0,
        total: 0,
        mode: f.mode,
      };
      oCurr.outflow += f.volume;
      oCurr.total += f.volume;
      map.set(oKey, oCurr);

      const dKey = f.destinationClean;
      const dCurr = map.get(dKey) || {
        name: f.destinationClean,
        coords: f.destCoords,
        inflow: 0,
        outflow: 0,
        total: 0,
        mode: f.mode,
      };
      dCurr.inflow += f.volume;
      dCurr.total += f.volume;
      map.set(dKey, dCurr);
    });

    return Array.from(map.values());
  }, [mappableFlows]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* View Presets */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(6px)',
          borderRadius: 8,
          border: '1px solid rgba(0, 102, 255, 0.12)',
          boxShadow: '0 2px 10px rgba(0, 102, 255, 0.08)',
          padding: '4px 6px',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
        }}
      >
        <button
          onClick={() => setViewPreset('kv')}
          style={{
            background: viewPreset === 'kv' ? 'linear-gradient(135deg, #0066FF, #0052CC)' : 'transparent',
            color: viewPreset === 'kv' ? '#FFFFFF' : '#475569',
            border: 'none',
            borderRadius: 6,
            padding: '4px 9px',
            fontSize: 10.5,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: viewPreset === 'kv' ? '0 2px 6px rgba(0, 102, 255, 0.25)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          Klang Valley
        </button>
        <button
          onClick={() => setViewPreset('peninsular')}
          style={{
            background: viewPreset === 'peninsular' ? 'linear-gradient(135deg, #0066FF, #0052CC)' : 'transparent',
            color: viewPreset === 'peninsular' ? '#FFFFFF' : '#475569',
            border: 'none',
            borderRadius: 6,
            padding: '4px 9px',
            fontSize: 10.5,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: viewPreset === 'peninsular' ? '0 2px 6px rgba(0, 102, 255, 0.25)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          Peninsular Malaysia
        </button>
      </div>

      {/* Empty State Overlay */}
      {mappableFlows.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 950,
            background: 'rgba(248, 250, 252, 0.88)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 10,
              border: '1px solid rgba(0, 102, 255, 0.15)',
              padding: '16px 20px',
              maxWidth: 400,
              boxShadow: '0 4px 14px rgba(15, 30, 54, 0.08)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', marginBottom: 4 }}>
              No OD Corridors Available for Active Filter
            </div>
            <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.45 }}>
              {emptyReason || 'Adjust Rail Network Mode, Time Horizon, Day Profile, or Distance filter.'}
            </div>
          </div>
        </div>
      )}

      {/* Network Mode Legend at Bottom Center */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(6px)',
          borderRadius: 20,
          border: '1px solid rgba(0, 102, 255, 0.15)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
          padding: '4px 14px',
          fontSize: 10.5,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EA580C' }} />
          <span style={{ color: '#EA580C' }}>KTM Komuter</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0066FF' }} />
          <span style={{ color: '#0066FF' }}>Rapid Rail</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0D9488' }} />
          <span style={{ color: '#0D9488' }}>KTM Intercity</span>
        </div>
      </div>

      <MapContainer
        center={KLANG_VALLEY_CENTER}
        zoom={10.5}
        style={{ width: '100%', height: '100%', borderRadius: 0 }}
        zoomControl={false}
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="&copy; Esri, DeLorme, NAVTEQ"
          maxZoom={16}
        />

        <MapFlyController selectedFlow={selectedFlow} viewPreset={viewPreset} />

        {/* Render Curved Directional OD Flow Arcs */}
        {mappableFlows.map((flow) => {
          if (!flow.originCoords || !flow.destCoords) return null;
          const isSelected = selectedFlowId === flow.id;
          const points = getBezierPoints(flow.originCoords, flow.destCoords);

          const modeColor =
            flow.mode === 'rapid_rail'
              ? '#0066FF'
              : flow.mode === 'komuter'
                ? '#EA580C'
                : '#0D9488';

          // Proportional stroke width based on normalized daily passenger movement
          const relIntensity = flow.avgDaily / maxDailyInView;
          let strokeColor = modeColor;
          let weight = Math.max(1.8, Math.min(4.6, 1.8 + relIntensity * 2.8));
          let opacity = 0.78;

          if (selectedFlowId) {
            if (isSelected) {
              strokeColor = '#FF5A00';
              weight = 5.5;
              opacity = 1;
            } else {
              opacity = 0.14;
            }
          }

          return (
            <Polyline
              key={flow.id}
              positions={points}
              pathOptions={{
                color: strokeColor,
                weight,
                opacity,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              eventHandlers={{
                click: () => onSelectFlow(flow),
              }}
            >
              <Tooltip sticky>
                <div style={{ fontSize: 11, color: '#0F1E36', minWidth: 185 }}>
                  <div style={{ fontWeight: 700, borderBottom: '1px solid #E2E8F0', paddingBottom: 3 }}>
                    #{flow.rank} {flow.originClean} ➔ {flow.destinationClean}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 3 }}>
                    <span style={{ color: '#64748B' }}>Period Total:</span>
                    <strong style={{ color: '#0066FF' }}>
                      {flow.volume.toLocaleString()} ({formatMillions(flow.volume)})
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 2 }}>
                    <span style={{ color: '#64748B' }}>Daily Average:</span>
                    <strong style={{ color: '#0F1E36' }}>
                      {flow.avgDaily.toLocaleString()} / day ({flow.observationDays}d)
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 2 }}>
                    <span style={{ color: '#64748B' }}>Service:</span>
                    <span style={{ fontWeight: 600 }}>{flow.modeLabel}</span>
                  </div>
                  {flow.distanceKm !== null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 2 }}>
                      <span style={{ color: '#64748B' }}>Straight-line Dist:</span>
                      <span>{flow.distanceKm} km</span>
                    </div>
                  )}
                </div>
              </Tooltip>
            </Polyline>
          );
        })}

        {/* Render Station Nodes */}
        {stationNodes.map((node) => {
          const isOrigin = selectedFlow?.originClean === node.name;
          const isDest = selectedFlow?.destinationClean === node.name;
          const isHighlighted = isOrigin || isDest;
          const radius = Math.min(9.5, Math.max(4, Math.log10(node.total + 10) * 1.4));

          return (
            <CircleMarker
              key={node.name}
              center={node.coords}
              radius={isHighlighted ? 9 : radius}
              pathOptions={{
                fillColor: isHighlighted ? (isOrigin ? '#0066FF' : '#FF5A00') : '#FFFFFF',
                fillOpacity: 0.95,
                color: isHighlighted ? '#FFFFFF' : '#0066FF',
                weight: isHighlighted ? 2.5 : 1.5,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                <div style={{ fontSize: 11, color: '#0F1E36', minWidth: 130 }}>
                  <div style={{ fontWeight: 700, color: '#0066FF' }}>{node.name}</div>
                  {isHighlighted && (
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: isOrigin ? '#0066FF' : '#FF5A00' }}>
                      {isOrigin ? 'Selected Origin' : 'Selected Destination'}
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 3, marginTop: 3 }}>
                    <div>Outflow (Origin): <strong>{formatMillions(node.outflow)}</strong></div>
                    <div>Inflow (Dest): <strong>{formatMillions(node.inflow)}</strong></div>
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
};
