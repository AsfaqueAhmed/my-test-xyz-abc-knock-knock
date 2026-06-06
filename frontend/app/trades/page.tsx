'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchTrades } from '../../lib/api';
import { SymbolLink } from '../components/SymbolLink';
import { useState } from 'react';

type Period = 'today' | 'week' | 'month' | 'all';

function ExitBadge({ reason }: { reason: string }) {
  if (reason === 'TRAILING_STOP') return <span className="badge-yellow">TRAIL STOP</span>;
  if (reason === 'HARD_STOP') return <span className="badge-red">HARD STOP</span>;
  if (reason === 'MANUAL') return <span className="badge-blue">MANUAL</span>;
  if (reason === 'EMERGENCY_CLOSE') return <span className="badge-red">EMERGENCY</span>;
  return <span className="badge-gray">{reason}</span>;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function TradesPage() {
  const [period, setPeriod] = useState<Period>('week');

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['trades', period],
    queryFn: () => fetchTrades(period),
    refetchInterval: 10000,
  });

  const arr = trades as any[];

  const totalPnl = arr.reduce((s: number, t: any) => s + t.pnl, 0);
  const totalFees = arr.reduce((s: number, t: any) => s + t.fees, 0);
  const wins = arr.filter((t: any) => t.pnl > 0);
  const losses = arr.filter((t: any) => t.pnl <= 0);
  const winRate = arr.length > 0 ? (wins.length / arr.length * 100) : 0;
  const grossWin = wins.reduce((s: number, t: any) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s: number, t: any) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Trade History</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>{arr.length} trades</p>
        </div>
        <div className="page-header-actions">
          {(['today', 'week', 'month', 'all'] as Period[]).map(p => (
            <button key={p} className={period === p ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setPeriod(p)}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total PnL', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'Win Rate', value: `${winRate.toFixed(1)}%`, color: winRate >= 50 ? 'var(--green)' : 'var(--red)' },
          { label: 'Profit Factor', value: pf === 999 ? '∞' : pf.toFixed(2), color: pf >= 1 ? 'var(--green)' : 'var(--red)' },
          { label: 'Trades', value: `${arr.length}`, sub: `${wins.length}W / ${losses.length}L` },
          { label: 'Total Fees', value: `$${totalFees.toFixed(3)}`, color: 'var(--red)' },
          { label: 'Avg Trade', value: arr.length > 0 ? `${(totalPnl / arr.length) >= 0 ? '+' : ''}$${(totalPnl / arr.length).toFixed(2)}` : '$0.00', color: totalPnl / (arr.length || 1) >= 0 ? 'var(--green)' : 'var(--red)' },
        ].map(({ label, value, color, sub }) => (
          <div key={label} className="card">
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text2)', padding: 20 }}>Loading...</div>
      ) : arr.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text3)' }}>No trades for this period</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="desktop-only card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th>
                    <th>Qty</th><th>PnL ($)</th><th>PnL %</th><th>Fees</th>
                    <th>Duration</th><th>Exit Reason</th><th>Closed At</th>
                  </tr>
                </thead>
                <tbody>
                  {arr.map((t: any) => {
                    const pnlColor = t.pnl >= 0 ? 'var(--green)' : 'var(--red)';
                    return (
                      <tr key={t.id}>
                        <td><SymbolLink symbol={t.symbol} style={{ fontWeight: 700 }}>{t.symbol}</SymbolLink></td>
                        <td>
                          {t.side === 'LONG'
                            ? <span className="badge-green">▲ LONG</span>
                            : <span className="badge-red">▼ SHORT</span>}
                        </td>
                        <td>${Number(t.entryPrice).toFixed(2)}</td>
                        <td>${Number(t.exitPrice).toFixed(2)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text2)' }}>{Number(t.quantity).toFixed(4)}</td>
                        <td style={{ color: pnlColor, fontWeight: 600 }}>
                          {t.pnl >= 0 ? '+' : ''}${Number(t.pnl).toFixed(2)}
                        </td>
                        <td style={{ color: pnlColor, fontWeight: 600 }}>
                          {t.pnlPct >= 0 ? '+' : ''}{Number(t.pnlPct).toFixed(2)}%
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--red)' }}>${Number(t.fees).toFixed(3)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text2)' }}>{formatDuration(t.duration)}</td>
                        <td><ExitBadge reason={t.exitReason} /></td>
                        <td style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(t.exitTime).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="mobile-only">
            {arr.map((t: any) => {
              const pnlColor = t.pnl >= 0 ? 'var(--green)' : 'var(--red)';
              return (
                <div key={t.id} className="m-card">
                  {/* Header: symbol + side + exit reason */}
                  <div className="m-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <SymbolLink symbol={t.symbol} style={{ fontWeight: 700, fontSize: 14 }}>{t.symbol}</SymbolLink>
                      {t.side === 'LONG'
                        ? <span className="badge-green">▲ LONG</span>
                        : <span className="badge-red">▼ SHORT</span>}
                    </div>
                    <ExitBadge reason={t.exitReason} />
                  </div>

                  <hr className="m-divider" />

                  {/* PnL — prominent */}
                  <div className="m-row">
                    <div>
                      <div className="m-label">PnL</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: pnlColor }}>
                        {t.pnl >= 0 ? '+' : ''}${Number(t.pnl).toFixed(2)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="m-label">ROI</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: pnlColor }}>
                        {t.pnlPct >= 0 ? '+' : ''}{Number(t.pnlPct).toFixed(2)}%
                      </div>
                    </div>
                  </div>

                  <hr className="m-divider" />

                  {/* Prices */}
                  <div className="m-row">
                    <div>
                      <div className="m-label">Entry</div>
                      <div className="m-val">${Number(t.entryPrice).toFixed(2)}</div>
                    </div>
                    <div style={{ color: 'var(--text3)', alignSelf: 'flex-end', paddingBottom: 2 }}>→</div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="m-label">Exit</div>
                      <div className="m-val">${Number(t.exitPrice).toFixed(2)}</div>
                    </div>
                  </div>

                  <hr className="m-divider" />

                  {/* Meta */}
                  <div className="m-row">
                    <div>
                      <div className="m-label">Duration</div>
                      <div className="m-val">{formatDuration(t.duration)}</div>
                    </div>
                    <div>
                      <div className="m-label">Qty</div>
                      <div className="m-val">{Number(t.quantity).toFixed(4)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="m-label">Fees</div>
                      <div style={{ fontSize: 12, color: 'var(--red)' }}>${Number(t.fees).toFixed(3)}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text3)' }}>
                    {new Date(t.exitTime).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
