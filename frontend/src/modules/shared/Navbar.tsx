// Shared Navbar Shell for switching between modules
// Placeholder component - no feature code implemented yet

import type { ModuleTab } from './types';

interface NavbarProps {
  currentTab?: ModuleTab;
  onTabChange?: (tab: ModuleTab) => void;
}

export function Navbar({ currentTab = 'network_overview', onTabChange }: NavbarProps) {
  const tabs: { key: ModuleTab; label: string }[] = [
    { key: 'network_overview', label: '1. Network Overview & Spatial Map' },
    { key: 'od_peak_hours', label: '2. OD Flow & Peak Hours' },
    { key: 'drivers_forecast', label: '3. Demand Drivers & Forecast' },
    { key: 'whatif_simulator', label: '4. What-If Simulator' },
  ];

  return (
    <nav style={{ display: 'flex', gap: '1rem', padding: '1rem', borderBottom: '1px solid #ccc' }}>
      <strong>TrafficPulse</strong>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange?.(tab.key)}
          style={{ fontWeight: currentTab === tab.key ? 'bold' : 'normal' }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export default Navbar;
