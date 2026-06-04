'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMarketTokens, type MarketToken } from '../../lib/api';

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

export default function MarketPage() {
  const [sortKey, setSortKey] = useState<SortKey>('volume24h');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');

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
    /* 100vh minus the 24px top + 24px bottom padding of <main> */
    <div style={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header — stays fixed while list scrolls */}
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

      {/* Table — fills remaining height, scrolls independently */}
      {!isLoading && !error && (
        <div
          className="card"
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
                      {/* Row # */}
                      <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)', width: 36, textAlign: 'right' }}>
                        {idx + 1}
                      </td>
                      {/* Symbol / Name */}
                      <td style={{ padding: '8px 10px', minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 6,
                              background: 'var(--bg3)',
                              border: '1px solid var(--border)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 10,
                              fontWeight: 700,
                              color: 'var(--blue)',
                              flexShrink: 0,
                              letterSpacing: '-0.02em',
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
                      {/* Price */}
                      <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        ${priceStr}
                      </td>
                      {/* Timeframe changes */}
                      {TIMEFRAME_COLS.map(col => (
                        <PctCell key={col.key} value={token[col.key] as number} />
                      ))}
                      {/* Volume */}
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
