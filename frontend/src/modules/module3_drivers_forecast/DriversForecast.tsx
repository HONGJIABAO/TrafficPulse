// Module 3 Placeholder — Demand Drivers & Forecasting
// Owner: Team Member 3
// Data: frontend/src/data/forecast_demand.json

export function DriversForecast() {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 58px)', background: '#F1F4F9',
    }}>
      <div style={{
        textAlign: 'center', padding: 48,
        background: '#fff', borderRadius: 16,
        border: '1px solid rgba(0,102,255,0.1)',
        boxShadow: '0 2px 12px rgba(0,102,255,0.07)',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📈</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F1E36', marginBottom: 8 }}>
          Demand Drivers & Forecasting
        </h2>
        <p style={{ color: '#64748B', fontSize: 14 }}>
          Module 3 — Under Construction by Member 3
        </p>
        <p style={{ color: '#94A3B8', fontSize: 12, marginTop: 8 }}>
          Data ready at: <code>frontend/src/data/forecast_demand.json</code>
        </p>
      </div>
    </div>
  );
}

export default DriversForecast;
