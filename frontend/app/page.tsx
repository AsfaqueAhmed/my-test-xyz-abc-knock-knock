'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboard } from '../lib/api';

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function PnlCard({ label, value }: { label: string; value: number }) {
  const pos = value >= 0;
  return (
    <StatCard
      label={label}
      value={`${pos ? '+' : ''}$${Math.abs(value).toFixed(2)}`}
      color={pos ? 'var(--green)' : 'var(--red)'}
    />
  );
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    refetchInterval: 5000,
  });

  if (isLoading) return <div style={{ color: 'var(--text2)', padding: 20 }}>Loading dashboard...</div>;
  if (error) return <div style={{ color: 'var(--red)', padding: 20 }}>Failed to connect to backend. Ensure the backend is running on port 3001.</div>;
  if (!data) return null;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Dashboard</h1>
        <p style={{ fontSize: 12, color: 'var(--text3)' }}>Real-time overview · Paper Trading Mode</p>
      </div>

      {/* Top metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Available" value={`$${(data.balance || 0).toFixed(2)}`} sub="Free capital" />
        <StatCard label="Invested" value={`$${(data.investedBalance || 0).toFixed(2)}`} sub={`${data.openPositionsCount || 0} position${data.openPositionsCount === 1 ? '' : 's'}`} color="var(--yellow)" />
        <StatCard label="Equity" value={`$${(data.equity || 0).toFixed(2)}`} sub={`Unrealized: $${(data.unrealizedPnl || 0).toFixed(2)}`} color={data.unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <PnlCard label="Daily PnL" value={data.dailyPnl || 0} />
        <PnlCard label="Weekly PnL" value={data.weeklyPnl || 0} />
        <PnlCard label="Monthly PnL" value={data.monthlyPnl || 0} />
        <StatCard label="Win Rate" value={`${(data.winRate || 0).toFixed(1)}%`} sub={`${data.totalTrades || 0} total trades`} />
        <StatCard label="Profit Factor" value={(data.profitFactor || 0).toFixed(2)} />
        <StatCard label="Open Positions" value={String(data.openPositionsCount || 0)} />
      </div>

      {/* Tickers */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Market Prices</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {(data.tickers || []).map((t: any) => (
            <div key={t.symbol} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>{t.symbol.replace('USDT', '')}</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>${t.price < 1 ? t.price.toFixed(5) : t.price.toFixed(2)}</div>
              {t.change24h !== undefined && (
                <div style={{ fontSize: 11, color: t.change24h >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 2 }}>
                  {t.change24h >= 0 ? '+' : ''}{(t.change24h || 0).toFixed(2)}%
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
