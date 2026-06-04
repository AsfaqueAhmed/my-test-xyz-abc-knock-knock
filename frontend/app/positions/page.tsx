'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPositions, closePosition } from '../../lib/api';
import { useState } from 'react';

function fmtPrice(price: number): string {
  if (!price || price <= 0) return '—';
  const sig = parseFloat(price.toPrecision(8));
  const str = sig.toString();
  if (str.includes('e-')) {
    const exp = parseInt(str.split('e-')[1], 10);
    return sig.toFixed(exp + 7);
  }
  return str;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    OPEN_LONG: 'badge-green',
    LONG_TRAILING: 'badge-blue',
    OPEN_SHORT: 'badge-red',
    SHORT_TRAILING: 'badge-yellow',
    CLOSED: 'badge-gray',
  };
  const labels: Record<string, string> = {
    OPEN_LONG: 'LONG',
    LONG_TRAILING: 'TRAILING ▲',
    OPEN_SHORT: 'SHORT',
    SHORT_TRAILING: 'TRAILING ▼',
    CLOSED: 'CLOSED',
  };
  return <span className={map[status] || 'badge-gray'}>{labels[status] || status}</span>;
}

export default function PositionsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'open'>('all');

  const { data: positions = [], isLoading } = useQuery({
    queryKey: ['positions', filter],
    queryFn: () => fetchPositions(filter === 'open' ? 'open' : undefined),
    refetchInterval: 3000,
  });

  const closeMut = useMutation({
    mutationFn: closePosition,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['positions'] }),
  });

  const open = (positions as any[]).filter((p) => p.status !== 'CLOSED');
  const closed = (positions as any[]).filter((p) => p.status === 'CLOSED');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Positions</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>{open.length} open · {closed.length} closed</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['all', 'open'] as const).map(f => (
            <button key={f} className={filter === f ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All Positions' : 'Open Only'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text2)', padding: 20 }}>Loading...</div>
      ) : (positions as any[]).length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text3)' }}>
          No positions found
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th><th style={{ width: 1, whiteSpace: 'nowrap' }}>Status</th><th>Entry</th><th>Avg Entry</th>
                  <th>Current / Exit</th><th>Hard Stop</th><th>Trailing Stop</th>
                  <th>Qty</th><th>Investment</th><th>PnL ($)</th><th>ROI</th><th>Entries</th>
                  <th>Fees</th><th>Opened</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(positions as any[]).map((p) => {
                  const isOpen = p.status !== 'CLOSED';
                  const pnl = isOpen ? Number(p.unrealizedPnl || 0) : Number(p.realizedPnl || 0);
                  const currentPrice = isOpen ? Number(p.currentPrice) : Number(p.exitPrice || 0);
                  const avgEntry = Number(p.avgEntryPrice);
                  const roi = avgEntry > 0
                    ? ((currentPrice - avgEntry) / avgEntry * 100 * (p.side === 'SHORT' ? -1 : 1))
                    : 0;
                  const leverage = Number(p.leverage) || 1;
                  const notional = avgEntry * Number(p.quantity);
                  const investment = notional / leverage;
                  const pnlColor = pnl >= 0 ? 'var(--green)' : 'var(--red)';
                  return (
                    <tr key={p.id}>
                      <td><span style={{ fontWeight: 700 }}>{p.symbol}</span></td>
                      <td style={{ width: 1, whiteSpace: 'nowrap' }}><StatusBadge status={p.status} /></td>
                      <td>${fmtPrice(Number(p.entryPrice))}</td>
                      <td>${fmtPrice(avgEntry)}</td>
                      <td>${fmtPrice(currentPrice)}</td>
                      <td style={{ color: 'var(--red)', fontSize: 12 }}>${fmtPrice(Number(p.hardStop))}</td>
                      <td style={{ fontSize: 12, color: p.trailingStop ? 'var(--yellow)' : 'var(--text3)' }}>
                        {p.trailingStop ? `$${fmtPrice(Number(p.trailingStop))}` : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{Number(p.quantity).toFixed(4)}</td>
                      <td style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600 }}>${investment.toFixed(2)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                          ×{leverage} · ${notional.toFixed(2)}
                        </div>
                      </td>
                      <td style={{ color: pnlColor, fontWeight: 600 }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}</td>
                      <td style={{ color: pnlColor, fontWeight: 600 }}>{roi >= 0 ? '+' : ''}{roi.toFixed(2)}%</td>
                      <td style={{ color: 'var(--text2)' }}>{p.entryCount}</td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>${Number(p.fees || 0).toFixed(5)}</td>
                      <td style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(p.openedAt).toLocaleString()}</td>
                      <td>
                        {isOpen ? (
                          <button
                            className="btn btn-red"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            disabled={closeMut.isPending}
                            onClick={() => closeMut.mutate(String(p.id))}
                          >
                            Close
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{p.exitReason}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
