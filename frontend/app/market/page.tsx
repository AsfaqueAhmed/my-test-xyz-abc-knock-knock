'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMarketTokens, checkManualTrade, manualTrade, type MarketToken, type ManualTradeCheck } from '../../lib/api';

// Show the natural precision of a price without hard decimal caps.
// Uses 8 significant figures, strips trailing zeros, and avoids scientific notation.
function fmtPrice(price: number): string {
  if (!price || price <= 0) return '—';
  // Round to 8 significant figures to eliminate floating-point noise
  const sig = parseFloat(price.toPrecision(8));
  const str = sig.toString();
  // JS may produce scientific notation for very tiny prices (e.g. 0.000000012)
  if (str.includes('e-')) {
    const exp = parseInt(str.split('e-')[1], 10);
    return sig.toFixed(exp + 7);
  }
  return str;
}

type SortKey = keyof MarketToken;
type SortDir = 'asc' | 'desc';

const TIMEFRAME_COLS: { key: keyof MarketToken; label: string }[] = [
  { key: 'change30s', label: '30s' },
  { key: 'change1m', label: '1m' },
  { key: 'change5m', label: '5m' },
  { key: 'change10m', label: '10m' },
  { key: 'change15m', label: '15m' },
  { key: 'change30m', label: '30m' },
  { key: 'change24h', label: '24h' },
];

function PctCell({ value }: { value: number }) {
  const v = value ?? 0;
  const pos = v > 0;
  const neg = v < 0;
  const color = pos ? 'var(--green)' : neg ? 'var(--red)' : 'var(--text3)';
  const bg = pos
    ? 'rgba(0,214,143,0.08)'
    : neg
    ? 'rgba(255,71,87,0.08)'
    : 'transparent';
  return (
    <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
      <span style={{
        display: 'inline-block',
        background: bg,
        color,
        borderRadius: 4,
        padding: '2px 6px',
        fontWeight: pos || neg ? 600 : 400,
        minWidth: 56,
        textAlign: 'right',
      }}>
        {pos ? '+' : ''}{v.toFixed(2)}%
      </span>
    </td>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span style={{ color: 'var(--border2)', marginLeft: 4 }}>⇅</span>;
  return <span style={{ color: 'var(--blue)', marginLeft: 4 }}>{dir === 'asc' ? '↑' : '↓'}</span>;
}

function ThSortable({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = 'right',
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        padding: '10px 10px',
        fontSize: 11,
        color: active ? 'var(--blue)' : 'var(--text3)',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        userSelect: 'none',
        textAlign: align,
        whiteSpace: 'nowrap',
        transition: 'color 0.1s',
      }}
    >
      {label}
      <SortIcon active={active} dir={dir} />
    </th>
  );
}

function TradeModal({
  token,
  onClose,
}: {
  token: MarketToken;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [amount, setAmount] = useState('');
  const [check, setCheck] = useState<ManualTradeCheck | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCheck(null);
    setCheckError('');
    setResult(null);
    setCheckLoading(true);
    checkManualTrade(token.symbol, direction)
      .then(d => { setCheck(d); setAmount(String(Math.floor(d.effectiveMax))); })
      .catch(e => setCheckError(e?.response?.data?.message || e.message))
      .finally(() => setCheckLoading(false));
  }, [token.symbol, direction]);

  async function handleSubmit() {
    if (!check) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await manualTrade(token.symbol, direction, amt);
      setResult({ success: true, message: `Opened ${res.side} ${res.symbol} @ $${res.price} · capital $${res.capital.toFixed(2)}` });
    } catch (e: any) {
      setResult({ success: false, message: e?.response?.data?.message || e.message });
    } finally {
      setSubmitting(false);
    }
  }

  const maxAmt = check ? check.effectiveMax : 0;
  const parsedAmt = parseFloat(amount) || 0;
  const amountExceeds = parsedAmt > maxAmt;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 400, maxWidth: '95vw' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{token.symbol}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Manual Trade</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Price */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>Current Price</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>${fmtPrice(token.price)}</span>
        </div>

        {/* Direction */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Direction</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['LONG', 'SHORT'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid',
                  borderColor: direction === d ? (d === 'LONG' ? 'var(--green)' : 'var(--red)') : 'var(--border)',
                  background: direction === d ? (d === 'LONG' ? 'rgba(0,214,143,0.12)' : 'rgba(255,71,87,0.12)') : 'var(--bg3)',
                  color: direction === d ? (d === 'LONG' ? 'var(--green)' : 'var(--red)') : 'var(--text3)',
                  transition: 'all 0.15s',
                }}
              >
                {d === 'LONG' ? '▲ Long' : '▼ Short'}
              </button>
            ))}
          </div>
        </div>

        {/* Liquidity info */}
        {checkLoading && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>Checking liquidity...</div>}
        {checkError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 16 }}>{checkError}</div>}
        {check && !checkLoading && (
          <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: 12, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Max safe size</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>${check.maxSafePositionSize.toFixed(0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Effective max</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)' }}>${check.effectiveMax.toFixed(0)}</span>
            </div>
          </div>
        )}

        {/* Amount */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Amount (USD)</span>
            {check && (
              <button
                onClick={() => setAmount(String(Math.floor(check.effectiveMax)))}
                style={{ fontSize: 10, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                MAX
              </button>
            )}
          </div>
          <input
            ref={amountRef}
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            min={1}
            max={maxAmt}
            style={{
              width: '100%', fontSize: 16, fontWeight: 700, padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${amountExceeds ? 'var(--red)' : 'var(--border)'}`,
              background: 'var(--bg3)', color: 'var(--text)', boxSizing: 'border-box',
            }}
          />
          {amountExceeds && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
              Exceeds effective max ${maxAmt.toFixed(0)}
            </div>
          )}
        </div>

        {/* Result */}
        {result && (
          <div style={{
            padding: '10px 12px', borderRadius: 8, marginBottom: 16, fontSize: 12, fontWeight: 600,
            background: result.success ? 'rgba(0,214,143,0.1)' : 'rgba(255,71,87,0.1)',
            color: result.success ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${result.success ? 'var(--green)' : 'var(--red)'}`,
          }}>
            {result.message}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !check || amountExceeds || parsedAmt <= 0 || !!result?.success}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none',
            background: direction === 'LONG' ? 'var(--green)' : 'var(--red)',
            color: '#fff', opacity: (submitting || !check || amountExceeds || parsedAmt <= 0 || !!result?.success) ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {submitting ? 'Opening...' : result?.success ? 'Opened ✓' : `Open ${direction}`}
        </button>
      </div>
    </div>
  );
}

export default function MarketPage() {
  const [sortKey, setSortKey] = useState<SortKey>('volume24h');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');
  const [tradeToken, setTradeToken] = useState<MarketToken | null>(null);

  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['market-tokens'],
    queryFn: fetchMarketTokens,
    refetchInterval: 3000,
  });

  const sorted = useMemo(() => {
    if (!data) return [];
    const filtered = search.trim()
      ? data.filter(
          t =>
            t.symbol.toLowerCase().includes(search.toLowerCase()) ||
            (t.name || '').toLowerCase().includes(search.toLowerCase()),
        )
      : data;

    return [...filtered].sort((a, b) => {
      const av = a[sortKey] as number | string | null;
      const bv = b[sortKey] as number | string | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, search]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const updatedStr = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : '—';

  return (
    <div style={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {tradeToken && <TradeModal token={tradeToken} onClose={() => setTradeToken(null)} />}

      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Market</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>
            Live price &amp; multi-timeframe changes · auto-refresh 3s · last update {updatedStr}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            placeholder="Search symbol or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220, fontSize: 12 }}
          />
          {data && (
            <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
              {sorted.length} / {data.length} tokens
            </span>
          )}
        </div>
      </div>

      {/* States */}
      {isLoading && (
        <div style={{ color: 'var(--text2)', padding: 24, textAlign: 'center' }}>Loading market data...</div>
      )}
      {error && (
        <div style={{ color: 'var(--red)', padding: 24, textAlign: 'center' }}>
          Failed to load market data. Ensure the backend is running.
        </div>
      )}

      {/* Desktop table — fills remaining height, scrolls independently */}
      {!isLoading && !error && (
        <>
          <div
            className="desktop-only card"
            style={{ flex: 1, minHeight: 0, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', paddingBottom: 24 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 2 }}>
                    <ThSortable label="#" sortKey="symbol" current={sortKey} dir={sortDir} onSort={handleSort} align="left" />
                    <ThSortable label="Symbol / Name" sortKey="symbol" current={sortKey} dir={sortDir} onSort={handleSort} align="left" />
                    <ThSortable label="Price" sortKey="price" current={sortKey} dir={sortDir} onSort={handleSort} />
                    {TIMEFRAME_COLS.map(col => (
                      <ThSortable
                        key={col.key}
                        label={col.label}
                        sortKey={col.key}
                        current={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                    ))}
                    <ThSortable label="Vol 24h" sortKey="volume24h" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <th style={{ padding: '10px 10px', fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', width: 70 }} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={11} style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                        No tokens found
                      </td>
                    </tr>
                  )}
                  {sorted.map((token, idx) => {
                    const baseSymbol = token.symbol.replace('USDT', '').replace('BUSD', '');
                    const displayName = token.name && token.name !== token.symbol ? token.name : baseSymbol;
                    const priceStr = fmtPrice(token.price);

                    return (
                      <tr key={token.symbol} style={{ borderBottom: '1px solid rgba(30,45,74,0.5)' }}>
                        <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)', width: 36, textAlign: 'right' }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: '8px 10px', minWidth: 140 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                              style={{
                                width: 30, height: 30, borderRadius: 6, background: 'var(--bg3)',
                                border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--blue)',
                                flexShrink: 0, letterSpacing: '-0.02em',
                              }}
                            >
                              {baseSymbol.slice(0, 3)}
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{token.symbol}</div>
                              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{displayName}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          ${priceStr}
                        </td>
                        {TIMEFRAME_COLS.map(col => (
                          <PctCell key={col.key} value={token[col.key] as number} />
                        ))}
                        <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text2)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {token.volume24h > 1_000_000_000
                            ? `$${(token.volume24h / 1_000_000_000).toFixed(2)}B`
                            : token.volume24h > 1_000_000
                            ? `$${(token.volume24h / 1_000_000).toFixed(1)}M`
                            : token.volume24h > 1_000
                            ? `$${(token.volume24h / 1_000).toFixed(1)}K`
                            : token.volume24h > 0
                            ? `$${token.volume24h.toFixed(0)}`
                            : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <button
                            onClick={() => setTradeToken(token)}
                            style={{
                              fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                              border: '1px solid var(--blue)', background: 'rgba(41,182,246,0.1)',
                              color: 'var(--blue)', whiteSpace: 'nowrap', transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(41,182,246,0.2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(41,182,246,0.1)')}
                          >
                            Trade
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile token list */}
          <div className="mobile-only" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {sorted.length === 0 && (
              <div className="m-card" style={{ textAlign: 'center', color: 'var(--text3)', padding: 32 }}>No tokens found</div>
            )}
            {sorted.map((token) => {
              const baseSymbol = token.symbol.replace('USDT', '').replace('BUSD', '');
              const displayName = token.name && token.name !== token.symbol ? token.name : baseSymbol;
              const MOBILE_TF: (keyof MarketToken)[] = ['change1m', 'change5m', 'change15m', 'change24h'];
              const MOBILE_TF_LABELS: Record<string, string> = { change1m: '1m', change5m: '5m', change15m: '15m', change24h: '24h' };
              return (
                <div key={token.symbol} className="m-card">
                  {/* Row 1: icon + symbol/name + price + trade */}
                  <div className="m-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: 6, background: 'var(--bg3)',
                        border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--blue)',
                        flexShrink: 0, letterSpacing: '-0.02em',
                      }}>
                        {baseSymbol.slice(0, 3)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{token.symbol}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{displayName}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>${fmtPrice(token.price)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                        {token.volume24h > 1_000_000_000
                          ? `$${(token.volume24h / 1_000_000_000).toFixed(1)}B`
                          : token.volume24h > 1_000_000
                          ? `$${(token.volume24h / 1_000_000).toFixed(0)}M`
                          : '—'}
                      </div>
                    </div>
                  </div>
                  {/* Row 2: timeframe badges + trade button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {MOBILE_TF.map(key => {
                      const v = (token[key] as number) ?? 0;
                      const pos = v > 0;
                      const neg = v < 0;
                      const color = pos ? 'var(--green)' : neg ? 'var(--red)' : 'var(--text3)';
                      const bg = pos ? 'rgba(0,214,143,0.08)' : neg ? 'rgba(255,71,87,0.08)' : 'transparent';
                      return (
                        <span key={String(key)} style={{
                          fontSize: 11, fontWeight: 600, padding: '3px 7px', borderRadius: 4,
                          background: bg, color,
                        }}>
                          {MOBILE_TF_LABELS[String(key)]} {pos ? '+' : ''}{v.toFixed(2)}%
                        </span>
                      );
                    })}
                    <button
                      onClick={() => setTradeToken(token)}
                      style={{
                        marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
                        cursor: 'pointer', border: '1px solid var(--blue)', background: 'rgba(41,182,246,0.1)',
                        color: 'var(--blue)', flexShrink: 0,
                      }}
                    >
                      Trade
                    </button>
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
