import type { TabId } from './types';
import { NAV_TABS } from './types';

interface NavbarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function Navbar({ activeTab, onTabChange }: NavbarProps) {
  return (
    <header style={{
      background: '#FFFFFF',
      borderBottom: '1px solid rgba(0,102,255,0.1)',
      boxShadow: '0 2px 12px rgba(0,102,255,0.06)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      height: '58px',
      gap: '24px',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <div style={{
          width: 36, height: 36,
          background: 'linear-gradient(135deg, #0066FF 0%, #00C48C 100%)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>🚆</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0F1E36', lineHeight: 1.2 }}>
            TransitPulse Malaysia
          </div>
          <div style={{ fontSize: 10, color: '#64748B', letterSpacing: '0.5px' }}>
            SMARTER RAIL MOBILITY
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Nav Tabs */}
      <nav style={{ display: 'flex', gap: '4px' }}>
        {NAV_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#fff' : '#64748B',
                background: isActive
                  ? 'linear-gradient(135deg, #0066FF 0%, #0052CC 100%)'
                  : 'transparent',
                boxShadow: isActive ? '0 2px 10px rgba(0,102,255,0.35)' : 'none',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#F1F4F9';
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <span style={{ fontSize: 14 }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Badge */}
      <div style={{
        background: 'linear-gradient(135deg, #0066FF10, #00E5A310)',
        border: '1px solid rgba(0,102,255,0.2)',
        borderRadius: 6, padding: '3px 8px',
        fontSize: 10, fontWeight: 600, color: '#0066FF',
        letterSpacing: '0.5px', flexShrink: 0,
      }}>
        MDIT 2026
      </div>
    </header>
  );
}

export default Navbar;
