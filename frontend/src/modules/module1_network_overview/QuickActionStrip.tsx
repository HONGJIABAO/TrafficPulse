import type { MapOverlay } from './NetworkOverview';
import type { TabId } from '@/modules/shared/types';

interface Props {
  activeOverlay: MapOverlay;
  onOverlayChange: (o: MapOverlay) => void;
  onNavigateTab?: (tab: TabId) => void;
}

interface ActionItem {
  id: MapOverlay;
  icon: string;
  label: string;
  isNavigation?: boolean;
  targetTab?: TabId;
}

const ACTIONS: ActionItem[] = [
  { id: 'map', icon: '🗺️', label: 'Map View' },
  { id: 'station', icon: '📍', label: 'Station View' },
  { id: 'od', icon: '🔄', label: 'OD View', isNavigation: true, targetTab: 'od_peak_hours' },
  { id: 'heatmap', icon: '🔥', label: 'Heatmap' },
  { id: 'forecast', icon: '📈', label: 'Forecast', isNavigation: true, targetTab: 'drivers_forecast' },
];

export function QuickActionStrip({ activeOverlay, onOverlayChange, onNavigateTab }: Props) {
  const handleClick = (action: ActionItem) => {
    if (action.isNavigation && action.targetTab && onNavigateTab) {
      onNavigateTab(action.targetTab);
    } else {
      onOverlayChange(action.id);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
      }}
    >
      {ACTIONS.map((action) => {
        const isActive = activeOverlay === action.id && !action.isNavigation;
        return (
          <button
            key={action.id}
            onClick={() => handleClick(action)}
            title={action.label}
            style={{
              width: 52,
              height: 52,
              borderRadius: 10,
              border: isActive
                ? '2px solid #0066FF'
                : '1px solid rgba(0, 102, 255, 0.14)',
              background: isActive
                ? 'linear-gradient(135deg, #0066FF 0%, #0052CC 100%)'
                : 'rgba(255, 255, 255, 0.94)',
              backdropFilter: 'blur(8px)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              boxShadow: isActive
                ? '0 4px 14px rgba(0, 102, 255, 0.35)'
                : '0 2px 8px rgba(15, 30, 54, 0.08)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              padding: '4px 2px',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = '#F8FAFF';
                e.currentTarget.style.borderColor = 'rgba(0, 102, 255, 0.35)';
                e.currentTarget.style.transform = 'translateX(-2px)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.94)';
                e.currentTarget.style.borderColor = 'rgba(0, 102, 255, 0.14)';
                e.currentTarget.style.transform = 'translateX(0)';
              }
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>{action.icon}</span>
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: '0.2px',
                color: isActive ? '#FFFFFF' : '#0F1E36',
                textAlign: 'center',
                lineHeight: 1.1,
                whiteSpace: 'nowrap',
              }}
            >
              {action.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default QuickActionStrip;
