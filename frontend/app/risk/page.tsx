'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchRisk, fetchDashboard } from '../../lib/api';

function SeverityBadge({ s }: { s: string }) {
  if (s === 'CRITICAL') return <span className="badge-red">CRITICAL</span>;
  if (s === 'HIGH') return <span className="badge-red">HIGH</span>;
  if (s === 'MEDIUM') return <span className="badge-yellow">MEDIUM</span>;
  return <span className="badge-gray">LOW</span>;
}

export default function RiskPage() {
  const { data: risk } = useQuery({ queryKey: ['risk'], queryFn: fetchRisk, refetchInterval: 5000 });
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard, refetchInterval: 5000 });

  const r = risk as any;
  const d = dash as any;

  const initialBalance = 10000;
  const balance = d?.balance || initialBalance;
  const equity = d?.equity || balance;
  const dailyPnl = d?.dailyPnl || r?.dailyPnl || 0;
  const drawdownPct = dailyPnl < 0 ? Math.abs(dailyPnl) / initialBalance * 100 : 0;
  const exposurePct = (d?.openPositionsCount || 0) / 5 * 100;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Risk Management</h1>
        <p style={{ fontSize: 12, color: 'var(--text3)' }}>Live risk monitoring & events</p>
      </div>

      {/* Emergency stop banner */}
      {r?.emergencyStop && (
        <div style={{
          background: 'rgba(255,71,87,0.15)',
          border: '1px solid rgba(255,71,87,0.4)',
          borderRadius: 8,
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: 'var(--red)',
          fontWeight: 700,
        }}>
          ⚠ EMERGENCY STOP ACTIVE — All trading is halted
        </div>
      )}

      {/* Risk gauges */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          {
            label: 'Daily Drawdown',
            value: `${drawdownPct.toFixed(2)}%`,
            limit: '5.00%',
            pct: drawdownPct / 5,
            color: drawdownPct > 4 ? 'var(--red)' : drawdownPct > 3 ? 'var(--yellow)' : 'var(--green)',
          },
          {
            label: 'Daily PnL',
            value: `${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
            limit: null,
            pct: null,
            color: dailyPnl >= 0 ? 'var(--green)' : 'var(--red)',
          },
          {
            label: 'Open Positions',
            value: `${d?.openPositionsCount || 0} / 5`,
            limit: 'Max: 5',
            pct: (d?.openPositionsCount || 0) / 5,
            color: (d?.openPositionsCount || 0) >= 5 ? 'var(--red)' : 'var(--green)',
          },
          {
            label: 'Active Cooldowns',
            value: String((r?.cooldowns || []).length),
            limit: null,
            pct: null,
            color: (r?.cooldowns || []).length > 0 ? 'var(--yellow)' : 'var(--green)',
          },
        ].map(({ label, value, limit, pct, color }) => (
          <div key={label} className="card">
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color, marginBottom: pct != null ? 10 : 0 }}>{value}</div>
            {pct != null && (
              <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(pct * 100, 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            )}
            {limit && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{limit}</div>}
          </div>
        ))}
      </div>

      {/* Active Cooldowns */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
          Active Cooldowns
        </div>
        {!r?.cooldowns?.length ? (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>No active cooldowns ✓</div>
        ) : (
          <table>
            <thead>
              <tr><th>Symbol</th><th>Reason</th><th>Ends At</th><th>Remaining</th></tr>
            </thead>
            <tbody>
              {r.cooldowns.map((c: any) => {
                const remaining = Math.max(0, Math.ceil((new Date(c.endsAt).getTime() - Date.now()) / 1000 / 60));
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.symbol}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{c.reason}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{new Date(c.endsAt).toLocaleTimeString()}</td>
                    <td><span className="badge-yellow">{remaining}m left</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Risk Events */}
      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
          Recent Risk Events
        </div>
        {!r?.riskEvents?.length ? (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>No risk events recorded ✓</div>
        ) : (
          <table>
            <thead>
              <tr><th>Time</th><th>Type</th><th>Severity</th><th>Description</th><th>Status</th></tr>
            </thead>
            <tbody>
              {r.riskEvents.map((e: any) => (
                <tr key={e.id}>
                  <td style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(e.createdAt).toLocaleString()}</td>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{e.type}</td>
                  <td><SeverityBadge s={e.severity} /></td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{e.description}</td>
                  <td>{e.resolved ? <span className="badge-green">RESOLVED</span> : <span className="badge-yellow">ACTIVE</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
