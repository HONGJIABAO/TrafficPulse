import { useState } from 'react';
import './index.css';
import { Navbar } from './modules/shared/Navbar';
import { NetworkOverview } from './modules/module1_network_overview/NetworkOverview';
import { OdPeakHours } from './modules/module2_od_peak_hours/OdPeakHours';
import { DriversForecast } from './modules/module3_drivers_forecast/DriversForecast';
import { WhatifSimulator } from './modules/module4_whatif_simulator/WhatifSimulator';
import type { TabId } from './modules/shared/types';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('network_overview');

  const renderPage = () => {
    switch (activeTab) {
      case 'network_overview':
        return <NetworkOverview onNavigateTab={setActiveTab} />;
      case 'od_peak_hours':
        return <OdPeakHours />;
      case 'drivers_forecast':
        return <DriversForecast />;
      case 'whatif_simulator':
        return <WhatifSimulator />;
      default:
        return <NetworkOverview onNavigateTab={setActiveTab} />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
