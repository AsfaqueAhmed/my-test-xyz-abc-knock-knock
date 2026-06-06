'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchCandles, checkManualTrade, manualTrade, type Candle, type ManualTradeCheck } from '../../lib/api';
import { useChartStore } from '../../lib/chartStore';

type TF = '1m' | '5m' | '15m';
type WsStatus = 'connecting' | 'live' | 'disconnected';

function fmtPrice(p: number) {
  if (!p) return '—';
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(4);
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ─── SVG Chart ────────────────────────────────────────────────────────────────

function CandleChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(380);

  useEffect(() => {
    if (!containerRef.current) return;
    setWidth(containerRef.current.clientWidth);
    const ro = new ResizeObserver(e => setWidth(e[0].contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  if (candles.length === 0) {
    return (
      <div ref={containerRef} style={{ width: '100%', height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  const PAD = { top: 12, right: 8, bottom: 20, left: 58 };
  const PRICE_H = 260;
  const VOL_H = 50;
  const GAP = 8;
  const TOTAL_H = PAD.top + PRICE_H + GAP + VOL_H + PAD.bottom;
  const chartW = width - PAD.left - PAD.right;

  const minP = Math.min(...candles.map(c => c.low));
  const maxP = Math.max(...candles.map(c => c.high));
  const priceRange = maxP - minP || minP * 0.001;
  const paddedMin = minP - priceRange * 0.04;
  const paddedMax = maxP + priceRange * 0.04;
  const paddedRange = paddedMax - paddedMin;
  const maxVol = Math.max(...candles.map(c => c.volume));

  const sy = (p: number) => PAD.top + PRICE_H - ((p - paddedMin) / paddedRange) * PRICE_H;
  const sv = (v: number) => (v / maxVol) * VOL_H;

  const slotW = chartW / candles.length;
  const bodyW = Math.max(slotW - (slotW > 6 ? 2 : 1), 1);
  const volTop = PAD.top + PRICE_H + GAP;

  const yLabels = Array.from({ length: 5 }, (_, i) => {
    const p = paddedMin + (paddedRange * i) / 4;
    return { price: p, y: sy(p) };
  });

  const xStep = Math.max(Math.floor(candles.length / 6), 1);
  const xLabels: { label: string; x: number }[] = [];
  for (let i = 0; i < candles.length; i += xStep) {
    xLabels.push({ label: fmtTime(candles[i].openTime), x: PAD.left + (i + 0.5) * slotW });
  }

  const last = candles[candles.length - 1];
  const lastY = sy(last.close);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg width={width} height={TOTAL_H} style={{ display: 'block', userSelect: 'none' }}>
        {yLabels.map(({ price, y }, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={width - PAD.right} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
            <text x={PAD.left - 5} y={y + 4} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.35)">
              {fmtPrice(price)}
            </text>
          </g>
        ))}

        {/* Live price line */}
        <line x1={PAD.left} y1={lastY} x2={width - PAD.right} y2={lastY} stroke="rgba(41,182,246,0.35)" strokeWidth={1} strokeDasharray="3 3" />
        <text x={PAD.left - 5} y={lastY + 4} textAnchor="end" fontSize={9} fontWeight={700} fill="var(--blue)">
          {fmtPrice(last.close)}
        </text>

        {/* Candles */}
        {candles.map((c, i) => {
          const x = PAD.left + i * slotW;
          const cx = x + slotW / 2;
          const isGreen = c.close >= c.open;
          const color = isGreen ? '#00d68f' : '#ff4757';
          const bodyTop = sy(Math.max(c.open, c.close));
          const bH = Math.max(sy(Math.min(c.open, c.close)) - bodyTop, 1);
          return (
            <g key={i}>
              <line x1={cx} y1={sy(c.high)} x2={cx} y2={sy(c.low)} stroke={color} strokeWidth={1} />
              <rect x={x + (slotW - bodyW) / 2} y={bodyTop} width={bodyW} height={bH} fill={color} />
            </g>
          );
        })}

        {/* Volume */}
        <line x1={PAD.left} y1={volTop} x2={width - PAD.right} y2={volTop} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        {candles.map((c, i) => {
          const x = PAD.left + i * slotW;
          const bH = sv(c.volume);
          const color = c.close >= c.open ? 'rgba(0,214,143,0.45)' : 'rgba(255,71,87,0.45)';
          return <rect key={i} x={x + (slotW - bodyW) / 2} y={volTop + VOL_H - bH} width={bodyW} height={bH} fill={color} />;
        })}

        {xLabels.map(({ label, x }, i) => (
          <text key={i} x={x} y={TOTAL_H - 4} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.3)">
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─── Trade Panel ─────────────────────────────────────────────────────────────

function TradePanel({ symbol }: { symbol: string }) {
  const [dir, setDir] = useState<'LONG' | 'SHORT'>('LONG');
  const [amount, setAmount] = useState('');
  const [check, setCheck] = useState<ManualTradeCheck | null>(null);
  const [checkErr, setCheckErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    setCheck(null); setCheckErr(''); setResult(null);
    setLoading(true);
    checkManualTrade(symbol, dir)
      .then(d => { setCheck(d); setAmount(String(Math.floor(d.effectiveMax))); })
      .catch(e => setCheckErr(e?.response?.data?.message || e.message))
      .finally(() => setLoading(false));
  }, [symbol, dir]);

  async function submit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || !check) return;
    setSubmitting(true); setResult(null);
    try {
      const res = await manualTrade(symbol, dir, amt);
      setResult({ ok: true, msg: `${res.side} ${res.symbol} @ $${res.price} · $${res.capital.toFixed(0)} capital` });
    } catch (e: any) {
      setResult({ ok: false, msg: e?.response?.data?.message || e.message });
    } finally {
      setSubmitting(false);
    }
  }

  const maxAmt = check?.effectiveMax ?? 0;
  const parsedAmt = parseFloat(amount) || 0;
  const exceeds = parsedAmt > maxAmt;
  const isLong = dir === 'LONG';

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      {/* Direction toggle */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['LONG', 'SHORT'] as const).map(d => (
          <button key={d} onClick={() => setDir(d)} style={{
            flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${dir === d ? (d === 'LONG' ? 'var(--green)' : 'var(--red)') : 'var(--border)'}`,
            background: dir === d ? (d === 'LONG' ? 'rgba(0,214,143,0.15)' : 'rgba(255,71,87,0.15)') : 'var(--bg3)',
            color: dir === d ? (d === 'LONG' ? 'var(--green)' : 'var(--red)') : 'var(--text3)',
            transition: 'all 0.15s',
          }}>
            {d === 'LONG' ? '▲ Long' : '▼ Short'}
          </button>
        ))}
      </div>

      {/* Liquidity info */}
      {loading && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Checking liquidity…</div>}
      {checkErr && <div style={{ fontSize: 11, color: 'var(--red)' }}>{checkErr}</div>}
      {check && !loading && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
          <span style={{ color: 'var(--text3)' }}>Max safe <span style={{ color: 'var(--text)', fontWeight: 700 }}>${check.maxSafePositionSize.toFixed(0)}</span></span>
          <span style={{ color: 'var(--text3)' }}>Effective max <span style={{ color: 'var(--blue)', fontWeight: 700 }}>${check.effectiveMax.toFixed(0)}</span></span>
        </div>
      )}

      {/* Amount input */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="Amount USD"
          style={{
            flex: 1, fontSize: 14, fontWeight: 700, padding: '8px 10px', borderRadius: 7,
            border: `1px solid ${exceeds ? 'var(--red)' : 'var(--border)'}`,
            background: 'var(--bg3)', color: 'var(--text)',
          }}
        />
        {check && (
          <button onClick={() => setAmount(String(Math.floor(check.effectiveMax)))} style={{
            fontSize: 10, fontWeight: 700, padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--blue)', whiteSpace: 'nowrap',
          }}>MAX</button>
        )}
        <button
          onClick={submit}
          disabled={submitting || !check || exceeds || parsedAmt <= 0 || !!result?.ok}
          style={{
            fontSize: 13, fontWeight: 800, padding: '8px 18px', borderRadius: 7, cursor: 'pointer',
            border: 'none', whiteSpace: 'nowrap',
            background: isLong ? 'var(--green)' : 'var(--red)', color: '#000',
            opacity: (submitting || !check || exceeds || parsedAmt <= 0 || !!result?.ok) ? 0.45 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {submitting ? '…' : result?.ok ? '✓ Done' : `${isLong ? '▲' : '▼'} ${dir}`}
        </button>
      </div>

      {exceeds && <div style={{ fontSize: 10, color: 'var(--red)' }}>Exceeds effective max ${maxAmt.toFixed(0)}</div>}

      {/* Result */}
      {result && (
        <div style={{
          fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 6,
          background: result.ok ? 'rgba(0,214,143,0.1)' : 'rgba(255,71,87,0.1)',
          color: result.ok ? 'var(--green)' : 'var(--red)',
          border: `1px solid ${result.ok ? 'var(--green)' : 'var(--red)'}`,
        }}>
          {result.msg}
        </div>
      )}
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export function ChartDrawer() {
  const { symbol, close } = useChartStore();
  const [tf, setTf] = useState<TF>('1m');
  const [tradeOpen, setTradeOpen] = useState(false);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Load REST history + open WS whenever symbol or tf changes
  useEffect(() => {
    if (!symbol) {
      closeWs();
      setCandles([]);
      setWsStatus('disconnected');
      setTradeOpen(false);
      return;
    }

    let cancelled = false;
    closeWs();
    setLoading(true);
    setCandles([]);

    // 1. Fetch historical candles once
    fetchCandles(symbol, tf, 150).then(data => {
      if (cancelled) return;
      setCandles(data);
      setLoading(false);

      // 2. Open WebSocket for live updates
      const stream = `${symbol.toLowerCase()}@kline_${tf}`;
      const ws = new WebSocket(`wss://fstream.binance.com/ws/${stream}`);
      wsRef.current = ws;
      setWsStatus('connecting');

      ws.onopen = () => { if (!cancelled) setWsStatus('live'); };

      ws.onmessage = (e) => {
        if (cancelled) return;
        const msg = JSON.parse(e.data);
        if (msg.e !== 'kline') return;
        const k = msg.k;
        const updated: Candle = {
          openTime: k.t,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          closeTime: k.T,
        };
        setCandles(prev => {
          if (prev.length === 0) return [updated];
          const last = prev[prev.length - 1];
          if (last.openTime === updated.openTime) {
            // Update current open candle
            return [...prev.slice(0, -1), updated];
          }
          // New candle opened — append and drop oldest to keep 150
          return [...prev.slice(-149), updated];
        });
      };

      ws.onerror = () => { if (!cancelled) setWsStatus('disconnected'); };
      ws.onclose = () => { if (!cancelled) setWsStatus('disconnected'); };
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      closeWs();
    };
  }, [symbol, tf, closeWs]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [close]);

  const isOpen = !!symbol;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const pctChange = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;

  return (
    <>
      {isOpen && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 }} />
      )}

      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(460px, 100vw)',
        background: 'var(--bg2)', borderLeft: '1px solid var(--border)',
        zIndex: 61, display: 'flex', flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: isOpen ? '-8px 0 32px rgba(0,0,0,0.4)' : 'none',
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{symbol}</span>
            {last && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>${fmtPrice(last.close)}</span>}
            {pctChange !== null && (
              <span style={{ fontSize: 12, fontWeight: 700, color: pctChange >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}%
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* WS status dot */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: wsStatus === 'live' ? 'var(--green)' : wsStatus === 'connecting' ? 'var(--yellow, #f0b429)' : 'var(--text3)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
              {wsStatus}
            </span>
            <button onClick={close} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text3)', fontSize: 16, cursor: 'pointer', padding: '3px 8px', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* TF tabs + Trade toggle */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          {(['1m', '5m', '15m'] as TF[]).map(t => (
            <button key={t} onClick={() => setTf(t)} style={{
              fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${tf === t ? 'var(--blue)' : 'var(--border)'}`,
              background: tf === t ? 'rgba(41,182,246,0.15)' : 'var(--bg3)',
              color: tf === t ? 'var(--blue)' : 'var(--text3)',
              transition: 'all 0.15s',
            }}>
              {t}
            </button>
          ))}
          <button
            onClick={() => setTradeOpen(o => !o)}
            style={{
              marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${tradeOpen ? 'var(--green)' : 'var(--border)'}`,
              background: tradeOpen ? 'rgba(0,214,143,0.15)' : 'var(--bg3)',
              color: tradeOpen ? 'var(--green)' : 'var(--text3)',
              transition: 'all 0.15s',
            }}
          >
            {tradeOpen ? '✕ Close' : '⚡ Trade'}
          </button>
        </div>

        {/* Chart */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '12px 8px 8px' }}>
          {loading ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
              Loading candles…
            </div>
          ) : (
            <CandleChart candles={candles} />
          )}
        </div>

        {/* Trade panel */}
        {tradeOpen && symbol && <TradePanel symbol={symbol} />}
      </div>
    </>
  );
}
