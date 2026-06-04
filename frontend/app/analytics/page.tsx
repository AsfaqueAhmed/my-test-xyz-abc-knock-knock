'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchAnalytics } from '../../lib/api';
import { useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';

const CHART_THEME = {
  background: 'transparent',
  gridColor: 'rgba(30,45,74,0.6)',
  textColor: '#5566aa',
  tooltipBg: '#0f1525',
  tooltipBorder: '#1e2d4a',
};

function CustomTooltip({ active, payload, label, prefix = '$' }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: CHART_THEME.tooltipBg,
      border: `1px solid ${CHART_THEME.tooltipBorder}`,
      borderRadius: 6,
      padding: '8px 12px',
      fontSize: 12,
    }}>
      <div style={{ color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {prefix}{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => fetchAnalytics(days),
    refetchInterval: 30000,
  });

  if (isLoading || !data) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Analytics</h1>
        <div style={{ color: 'var(--text2)' }}>Loading analytics...</div>
      </div>
    );
  }

  const { equity = [], summary = {}, dailyPnl = [], drawdown = [] } = data as any;
  const s = summary as any;

  // Enrich equity data
  const equityData = equity.map((d: any) => ({ ...d, equity: Number(d.equity.toFixed(2)) }));

  // Daily PnL data
  const pnlData = dailyPnl.map((d: any) => ({
    date: d.date?.split('T')[0] || d.date,
    pnl: Number(d.dailyPnl?.toFixed(2) || 0),
    trades: d.totalTrades || 0,
  }));

  // Drawdown data
  const ddData = drawdown.map((d: any) => ({
    date: d.date,
    drawdown: -Number(d.drawdown?.toFixed(2) || 0),
  }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Analytics</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>Performance metrics & charts</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} className={days === d ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setDays(d)}>
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatBox label="Total PnL" value={`${s.totalPnl >= 0 ? '+' : ''}$${(s.totalPnl || 0).toFixed(2)}`} color={s.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatBox label="Win Rate" value={`${(s.winRate || 0).toFixed(1)}%`} color={(s.winRate || 0) >= 50 ? 'var(--green)' : 'var(--red)'} />
        <StatBox label="Profit Factor" value={(s.profitFactor || 0) === 999 ? '∞' : (s.profitFactor || 0).toFixed(2)} color={(s.profitFactor || 0) >= 1 ? 'var(--green)' : 'var(--red)'} />
        <StatBox label="Total Trades" value={String(s.totalTrades || 0)} />
        <StatBox label="Largest Winner" value={`$${(s.largestWinner || 0).toFixed(2)}`} color="var(--green)" />
        <StatBox label="Largest Loser" value={`$${(s.largestLoser || 0).toFixed(2)}`} color="var(--red)" />
        <StatBox label="Avg Trade" value={`${(s.avgTrade || 0) >= 0 ? '+' : ''}$${(s.avgTrade || 0).toFixed(2)}`} color={(s.avgTrade || 0) >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatBox label="Total Fees" value={`$${(s.totalFees || 0).toFixed(3)}`} color="var(--red)" />
      </div>

      {/* Equity Curve */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Equity Curve
        </div>
        {equityData.length < 2 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text3)' }}>No equity data yet — start trading to see the curve</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={equityData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3d7fff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3d7fff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.gridColor} />
              <XAxis dataKey="date" tick={{ fill: CHART_THEME.textColor, fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: CHART_THEME.textColor, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="equity" name="Equity" stroke="#3d7fff" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Daily PnL */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Daily PnL
        </div>
        {pnlData.length < 1 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text3)' }}>No daily PnL data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pnlData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.gridColor} />
              <XAxis dataKey="date" tick={{ fill: CHART_THEME.textColor, fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: CHART_THEME.textColor, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="var(--border2)" />
              <Bar dataKey="pnl" name="Daily PnL" fill="#3d7fff"
                radius={[2, 2, 0, 0]}
                label={false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Drawdown */}
      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Drawdown %
        </div>
        {ddData.length < 2 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text3)' }}>No drawdown data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={ddData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff4757" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ff4757" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.gridColor} />
              <XAxis dataKey="date" tick={{ fill: CHART_THEME.textColor, fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: CHART_THEME.textColor, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
              <Tooltip content={<CustomTooltip prefix="" />} />
              <Area type="monotone" dataKey="drawdown" name="Drawdown %" stroke="#ff4757" strokeWidth={2} fill="url(#ddGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
