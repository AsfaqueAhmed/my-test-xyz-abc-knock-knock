'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPositions, closePosition } from '../../lib/api';
import { useState, useMemo } from 'react';

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
    OPEN_LONG: 'badge-green', LONG_TRAILING: 'badge-blue',
    OPEN_SHORT: 'badge-red', SHORT_TRAILING: 'badge-yellow', CLOSED: 'badge-gray',
  };
  const labels: Record<string, string> = {
    OPEN_LONG: 'LONG', LONG_TRAILING: 'TRAILING ▲',
    OPEN_SHORT: 'SHORT', SHORT_TRAILING: 'TRAILING ▼', CLOSED: 'CLOSED',
  };
  return <span className={map[status] || 'badge-gray'}>{labels[status] || status}</span>;
}

type SortKey = 'symbol' | 'pnl' | 'roi' | 'openedAt' | 'status';
type SortDir = 'asc' | 'desc';

function SortTh({
  label, sortKey, current, dir, onSort, align = 'left',
}: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void; align?: 'left' | 'right';
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: align, whiteSpace: 'nowrap',
        color: active ? 'var(--blue)' : undefined }}
    >
      {label}{' '}
      <span style={{ color: active ? 'var(--blue)' : 'var(--border2)', fontSize: 10 }}>
        {active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}
      </span>
    </th>
  );
}

export default function PositionsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('openedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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

  function getPnl(p: any) {
    return p.status !== 'CLOSED' ? Number(p.unrealizedPnl || 0) : Number(p.realizedPnl || 0);
  }
  function getRoi(p: any) {
    const isOpen = p.status !== 'CLOSED';
    const price = isOpen ? Number(p.currentPrice) : Number(p.exitPrice || 0);
    const avg = Number(p.avgEntryPrice);
    return avg > 0 ? (price - avg) / avg * 100 * (p.side === 'SHORT' ? -1 : 1) : 0;
  }

  const sorted = useMemo(() => {
    const arr = positions as any[];
    return [...arr].sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortKey === 'symbol')   { av = a.symbol; bv = b.symbol; }
      else if (sortKey === 'pnl') { av = getPnl(a); bv = getPnl(b); }
      else if (sortKey === 'roi') { av = getRoi(a); bv = getRoi(b); }
      else if (sortKey === 'status') { av = a.status; bv = b.status; }
      else                        { av = new Date(a.openedAt).getTime(); bv = new Date(b.openedAt).getTime(); }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [positions, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Positions</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>{open.length} open · {closed.length} closed</p>
        </div>
        <div className="page-header-actions">
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
        <>
          {/* Desktop table */}
          <div className="desktop-only card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <SortTh label="Symbol"   sortKey="symbol"   current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Status"   sortKey="status"   current={sortKey} dir={sortDir} onSort={handleSort} />
                    <th>Entry</th><th>Avg Entry</th><th>Current / Exit</th>
                    <th>Hard Stop</th><th>Trailing Stop</th><th>Qty</th><th>Investment</th>
                    <SortTh label="PnL ($)"  sortKey="pnl"      current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortTh label="ROI"      sortKey="roi"      current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <th>Entries</th><th>Fees</th>
                    <SortTh label="Opened"   sortKey="openedAt" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => {
                    const isOpen = p.status !== 'CLOSED';
                    const pnl = getPnl(p);
                    const currentPrice = isOpen ? Number(p.currentPrice) : Number(p.exitPrice || 0);
                    const avgEntry = Number(p.avgEntryPrice);
                    const roi = getRoi(p);
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
                        <td style={{ color: isOpen ? 'var(--red)' : 'var(--text3)', fontSize: 12 }}>
                          {isOpen ? `$${fmtPrice(Number(p.hardStop))}` : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: isOpen && p.trailingStop ? 'var(--yellow)' : 'var(--text3)' }}>
                          {isOpen && p.trailingStop ? `$${fmtPrice(Number(p.trailingStop))}` : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text2)' }}>{Number(p.quantity).toFixed(4)}</td>
                        <td style={{ fontSize: 12 }}>
                          <div style={{ fontWeight: 600 }}>${investment.toFixed(2)}</div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>×{leverage} · ${notional.toFixed(2)}</div>
                        </td>
                        <td style={{ color: pnlColor, fontWeight: 600, textAlign: 'right' }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}</td>
                        <td style={{ color: pnlColor, fontWeight: 600, textAlign: 'right' }}>{roi >= 0 ? '+' : ''}{roi.toFixed(2)}%</td>
                        <td style={{ color: 'var(--text2)' }}>{p.entryCount}</td>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>${Number(p.fees || 0).toFixed(5)}</td>
                        <td style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(p.openedAt).toLocaleString()}</td>
                        <td>
                          {isOpen ? (
                            <button className="btn btn-red" style={{ padding: '4px 10px', fontSize: 11 }}
                              disabled={closeMut.isPending} onClick={() => closeMut.mutate(String(p.id))}>
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

          {/* Mobile cards */}
          <div className="mobile-only">
            {/* Mobile sort controls */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Sort:</span>
              {([
                { key: 'openedAt', label: 'Date' },
                { key: 'pnl',      label: 'PnL' },
                { key: 'roi',      label: 'ROI' },
                { key: 'symbol',   label: 'Symbol' },
                { key: 'status',   label: 'Status' },
              ] as { key: SortKey; label: string }[]).map(({ key, label }) => (
                <button key={key} onClick={() => handleSort(key)} style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid',
                  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                  borderColor: sortKey === key ? 'var(--blue)' : 'var(--border)',
                  background: sortKey === key ? 'rgba(61,127,255,0.1)' : 'var(--bg3)',
                  color: sortKey === key ? 'var(--blue)' : 'var(--text3)',
                }}>
                  {label}{sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              ))}
            </div>

            {sorted.map((p) => {
              const isOpen = p.status !== 'CLOSED';
              const pnl = getPnl(p);
              const currentPrice = isOpen ? Number(p.currentPrice) : Number(p.exitPrice || 0);
              const avgEntry = Number(p.avgEntryPrice);
              const roi = getRoi(p);
              const leverage = Number(p.leverage) || 1;
              const notional = avgEntry * Number(p.quantity);
              const investment = notional / leverage;
              const pnlColor = pnl >= 0 ? 'var(--green)' : 'var(--red)';
              return (
                <div key={p.id} className="m-card">
                  <div className="m-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{p.symbol}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    {isOpen ? (
                      <button className="btn btn-red" style={{ padding: '4px 12px', fontSize: 12 }}
                        disabled={closeMut.isPending} onClick={() => closeMut.mutate(String(p.id))}>
                        Close
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{p.exitReason}</span>
                    )}
                  </div>
                  <hr className="m-divider" />
                  <div className="m-row">
                    <div>
                      <div className="m-label">{isOpen ? 'Unrealized PnL' : 'Realized PnL'}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: pnlColor }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="m-label">ROI</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: pnlColor }}>{roi >= 0 ? '+' : ''}{roi.toFixed(2)}%</div>
                    </div>
                  </div>
                  <hr className="m-divider" />
                  <div className="m-row">
                    <div>
                      <div className="m-label">Avg Entry</div>
                      <div className="m-val">${fmtPrice(avgEntry)}</div>
                    </div>
                    <div style={{ color: 'var(--text3)', alignSelf: 'flex-end', paddingBottom: 2 }}>→</div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="m-label">{isOpen ? 'Current' : 'Exit'}</div>
                      <div className="m-val">${fmtPrice(currentPrice)}</div>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="m-row" style={{ marginTop: 8 }}>
                      <div>
                        <div className="m-label">Hard Stop</div>
                        <div style={{ fontSize: 12, color: 'var(--red)' }}>${fmtPrice(Number(p.hardStop))}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="m-label">Trailing Stop</div>
                        <div style={{ fontSize: 12, color: p.trailingStop ? 'var(--yellow)' : 'var(--text3)' }}>
                          {p.trailingStop ? `$${fmtPrice(Number(p.trailingStop))}` : '—'}
                        </div>
                      </div>
                    </div>
                  )}
                  <hr className="m-divider" />
                  <div className="m-row">
                    <div>
                      <div className="m-label">Investment</div>
                      <div className="m-val">${investment.toFixed(2)} <span style={{ color: 'var(--text3)' }}>×{leverage}</span></div>
                    </div>
                    <div>
                      <div className="m-label">Entries</div>
                      <div className="m-val" style={{ textAlign: 'center' }}>{p.entryCount}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="m-label">Fees</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>${Number(p.fees || 0).toFixed(5)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text3)' }}>
                    Opened {new Date(p.openedAt).toLocaleString()}
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
