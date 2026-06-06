'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchCandidates, fetchExecutionState, fetchExecCheck, type TradeCandidate, type ExecutionState } from '../../lib/api';
import { SymbolLink } from '../components/SymbolLink';

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= 60 ? 'var(--green)' : pct >= 35 ? 'var(--yellow, #f0b429)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 32, textAlign: 'right' }}>
        {value.toFixed(0)}
      </span>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <ScoreBar value={value} />
    </div>
  );
}

function CandidateCard({ c }: { c: TradeCandidate }) {
  const { data: execCheck } = useQuery({
    queryKey: ['exec-check', c.symbol, c.direction],
    queryFn: () => fetchExecCheck(c.symbol, c.direction),
    enabled: c.passed,
    refetchInterval: 8000,
    staleTime: 5000,
  });

  const isLong = c.direction === 'LONG';
  const dirColor = isLong ? 'var(--green)' : 'var(--red)';
  const borderColor = c.passed
    ? isLong ? 'rgba(0,214,143,0.35)' : 'rgba(255,71,87,0.35)'
    : 'var(--border)';

  return (
    <div className="card" style={{ border: `1px solid ${borderColor}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <SymbolLink symbol={c.symbol} style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{c.symbol}</SymbolLink>
          <div style={{ fontSize: 11, fontWeight: 700, color: dirColor, marginTop: 2 }}>
            {isLong ? '▲' : '▼'} {c.direction}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {c.passed ? (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
              background: 'rgba(0,214,143,0.12)', color: 'var(--green)', border: '1px solid rgba(0,214,143,0.3)',
            }}>PASS</span>
          ) : (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
              background: 'rgba(255,71,87,0.08)', color: 'var(--red)', border: '1px solid rgba(255,71,87,0.2)',
            }}>FAIL</span>
          )}
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>
            {c.tradeScore.toFixed(1)}<span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400 }}>/100</span>
          </div>
        </div>
      </div>

      {/* Score breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <ScoreRow label="Momentum" value={c.momentumScore} />
        <ScoreRow label="Trend" value={c.trendScore} />
        <ScoreRow label="Volume" value={c.volumeScore} />
        <ScoreRow label="Breakout" value={c.breakoutScore} />
        <ScoreRow label="Candle" value={c.candleScore} />
        <ScoreRow label="Liquidity" value={c.liquidityScore} />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
        <div>
          <div style={{ color: 'var(--text3)' }}>Vol Ratio</div>
          <div style={{ fontWeight: 700, color: c.volumeRatio >= 1.5 ? 'var(--green)' : 'var(--text2)' }}>
            {c.volumeRatio.toFixed(2)}x
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text3)' }}>Max Size</div>
          <div style={{ fontWeight: 700, color: 'var(--text2)' }}>
            ${c.maxSafePositionSize >= 1000
              ? `${(c.maxSafePositionSize / 1000).toFixed(1)}K`
              : c.maxSafePositionSize.toFixed(0)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text3)' }}>OI</div>
          <div style={{ fontWeight: 700, color: 'var(--text2)' }}>
            ${c.openInterestNotional >= 1_000_000
              ? `${(c.openInterestNotional / 1_000_000).toFixed(1)}M`
              : c.openInterestNotional >= 1000
              ? `${(c.openInterestNotional / 1000).toFixed(0)}K`
              : c.openInterestNotional.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Why not executed (passing but blocked) — live check */}
      {c.passed && execCheck && (
        execCheck.canTrade ? (
          <div style={{ fontSize: 11, color: 'var(--green)', background: 'rgba(0,214,143,0.06)', borderRadius: 4, padding: '5px 8px', borderLeft: '2px solid var(--green)' }}>
            ✓ Cleared for execution
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, background: 'rgba(240,180,41,0.06)', borderRadius: 4, padding: '6px 8px', borderLeft: '2px solid var(--yellow, #f0b429)' }}>
            {execCheck.blockers.map((b, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--yellow, #f0b429)' }}>⚠ {b}</div>
            ))}
          </div>
        )
      )}

      {/* Validation failure reason */}
      {!c.passed && c.failureReason && (
        <div style={{ fontSize: 11, color: 'var(--red)', background: 'rgba(255,71,87,0.06)', borderRadius: 4, padding: '5px 8px', borderLeft: '2px solid var(--red)' }}>
          {c.failureReason}
        </div>
      )}
    </div>
  );
}

function ExecutionBanner({ state }: { state: ExecutionState }) {
  const statusColor = !state.botRunning ? 'var(--text3)' : state.botPaused ? 'var(--yellow, #f0b429)' : state.canTrade ? 'var(--green)' : 'var(--red)';
  const statusLabel = !state.botRunning ? 'Bot stopped' : state.botPaused ? 'Bot paused' : state.canTrade ? 'Trading active' : 'Blocked';

  return (
    <div style={{
      marginBottom: 16, borderRadius: 8, border: `1px solid ${statusColor}`,
      background: `color-mix(in srgb, ${statusColor} 8%, transparent)`,
      padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text3)' }}>
            Slots <span style={{ color: state.slotsAvailable > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{state.slotsAvailable}/{state.maxPositions}</span>
          </span>
          <span style={{ color: 'var(--text3)' }}>
            Balance <span style={{ fontWeight: 700, color: 'var(--text)' }}>${state.balance.toFixed(2)}</span>
          </span>
          <span style={{ color: 'var(--text3)' }}>
            Capital/trade <span style={{ fontWeight: 700, color: 'var(--text)' }}>${state.effectiveCapital.toFixed(2)}</span>
          </span>
          <span style={{ color: 'var(--text3)' }}>
            Daily PnL <span style={{ fontWeight: 700, color: state.dailyPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {state.dailyPnl >= 0 ? '+' : ''}${state.dailyPnl.toFixed(2)}
            </span>
          </span>
        </div>
      </div>

      {/* Blockers */}
      {state.blockers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {state.blockers.map((b, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flexShrink: 0 }}>✕</span> {b}
            </div>
          ))}
        </div>
      )}

      {/* Active cooldowns */}
      {state.activeCooldowns.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {state.activeCooldowns.map((c, i) => (
            <span key={i} style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4,
              background: 'rgba(255,71,87,0.1)', color: 'var(--red)', border: '1px solid rgba(255,71,87,0.2)',
            }}>
              {c.symbol} cooldown · {new Date(c.endsAt).toLocaleTimeString()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SignalsPage() {
  const { data: candidateRes, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['candidates'],
    queryFn: fetchCandidates,
    refetchInterval: 10000,
  });

  const { data: execState } = useQuery({
    queryKey: ['execution-state'],
    queryFn: fetchExecutionState,
    refetchInterval: 5000,
  });

  const data = candidateRes?.candidates ?? [];
  const scannedAt = candidateRes?.scannedAt ? new Date(candidateRes.scannedAt) : null;
  const staleMs = scannedAt ? Date.now() - scannedAt.getTime() : null;
  const isStale = staleMs !== null && staleMs > 60_000;

  const passed = data.filter(c => c.passed);
  const failed = data.filter(c => !c.passed);
  const updatedStr = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Signal Scanner</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>
            Live candidates · auto-refresh 10s · last update {updatedStr}
          </p>
          {scannedAt && (
            <p style={{ fontSize: 11, marginTop: 2, color: isStale ? 'var(--yellow, #f0b429)' : 'var(--text3)' }}>
              {isStale ? '⚠ Stale — ' : ''}Last scan: {scannedAt.toLocaleTimeString()}
              {isStale && ' (bot may be stopped — candidates are from a previous run)'}
            </p>
          )}
        </div>
        {!isLoading && (
          <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>{passed.length} passing</span>
            <span style={{ color: 'var(--text3)' }}>{failed.length} failing</span>
          </div>
        )}
      </div>

      {execState && <ExecutionBanner state={execState} />}

      {isLoading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading candidates...</div>
      )}

      {!isLoading && data.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
          No candidates yet — waiting for scanner cycle
        </div>
      )}

      {!isLoading && data.length > 0 && (
        <>
          {passed.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                ▲ Passing ({passed.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {passed.map(c => <CandidateCard key={c.symbol} c={c} />)}
              </div>
            </div>
          )}

          {failed.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Evaluated / Failing ({failed.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {failed.map(c => <CandidateCard key={c.symbol} c={c} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
