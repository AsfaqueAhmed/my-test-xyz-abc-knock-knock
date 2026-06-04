'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchSignals } from '../../lib/api';
import { useState } from 'react';

function DirectionBadge({ dir }: { dir: string }) {
  if (dir === 'LONG' || dir === 'BULLISH') return <span className="badge-green">▲ {dir}</span>;
  if (dir === 'SHORT' || dir === 'BEARISH') return <span className="badge-red">▼ {dir}</span>;
  return <span className="badge-gray">— {dir}</span>;
}

function MomentumBar({ score }: { score: number }) {
  const pct = Math.min(Math.abs(score) / 2 * 100, 100);
  const color = score >= 0 ? 'var(--green)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color, minWidth: 45, textAlign: 'right', fontWeight: 600 }}>
        {score >= 0 ? '+' : ''}{score.toFixed(3)}
      </span>
    </div>
  );
}

export default function SignalsPage() {
  const [liveMode, setLiveMode] = useState(false);

  const { data: signals = [], isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['signals', liveMode],
    queryFn: () => fetchSignals(liveMode),
    refetchInterval: liveMode ? 10000 : 30000,
  });

  const sigArr = signals as any[];
  const validSignals = sigArr.filter((s) => s.valid || s.acted !== undefined);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Signal Scanner</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>
            {liveMode ? 'Live analysis' : 'Historical signals'} · Last update: {new Date(dataUpdatedAt).toLocaleTimeString()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={!liveMode ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setLiveMode(false)}>Historical</button>
          <button className={liveMode ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setLiveMode(true)}>⚡ Live Scan</button>
        </div>
      </div>

      {/* Live scan grid */}
      {liveMode && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginBottom: 24 }}>
          {sigArr.map((s: any, i: number) => {
            const isLong = s.direction === 'LONG';
            const isShort = s.direction === 'SHORT';
            const borderColor = isLong ? 'rgba(0,214,143,0.3)' : isShort ? 'rgba(255,71,87,0.3)' : 'var(--border)';
            return (
              <div key={`${s.symbol}-${i}`} className="card" style={{ border: `1px solid ${borderColor}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{s.symbol}</span>
                  <DirectionBadge dir={s.direction} />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Momentum Score</div>
                  <MomentumBar score={s.momentumScore || 0} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
                  <div>
                    <span style={{ color: 'var(--text3)' }}>Trend: </span>
                    <span style={{ color: s.trendDirection === 'BULLISH' ? 'var(--green)' : s.trendDirection === 'BEARISH' ? 'var(--red)' : 'var(--text2)' }}>
                      {s.trendDirection}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text3)' }}>Vol Ratio: </span>
                    <span style={{ color: s.volumeRatio > 1.5 ? 'var(--green)' : 'var(--text2)' }}>
                      {(s.volumeRatio || 0).toFixed(2)}x
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text3)' }}>Breakout: </span>
                    <span style={{ color: s.breakoutType ? 'var(--green)' : 'var(--text3)' }}>
                      {s.breakoutType || 'None'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text3)' }}>Confidence: </span>
                    <span>{((s.confidence || 0) * 100).toFixed(0)}%</span>
                  </div>
                </div>
                {s.reasons && s.reasons.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
                    {s.reasons.slice(0, 3).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Historical table */}
      {!liveMode && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ padding: 24, color: 'var(--text2)' }}>Loading signals...</div>
          ) : sigArr.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>No signals recorded yet</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th><th>Symbol</th><th>Direction</th><th>Score</th>
                  <th>Confidence</th><th>Trend</th><th>Vol Ratio</th><th>Breakout</th><th>Acted</th>
                </tr>
              </thead>
              <tbody>
                {sigArr.map((s: any) => (
                  <tr key={s.id}>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(s.createdAt).toLocaleString()}</td>
                    <td style={{ fontWeight: 700 }}>{s.symbol}</td>
                    <td><DirectionBadge dir={s.direction} /></td>
                    <td><MomentumBar score={s.momentumScore} /></td>
                    <td>{((s.confidence || 0) * 100).toFixed(0)}%</td>
                    <td>
                      <span style={{ color: s.trendDirection === 'BULLISH' ? 'var(--green)' : s.trendDirection === 'BEARISH' ? 'var(--red)' : 'var(--text2)', fontSize: 12 }}>
                        {s.trendDirection}
                      </span>
                    </td>
                    <td style={{ color: s.volumeRatio > 1.5 ? 'var(--green)' : 'var(--text2)', fontSize: 12 }}>
                      {(s.volumeRatio || 0).toFixed(2)}x
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {s.breakoutType ? <span style={{ color: s.breakoutType === 'BULLISH' ? 'var(--green)' : 'var(--red)' }}>{s.breakoutType}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td>{s.acted ? <span className="badge-green">YES</span> : <span className="badge-gray">NO</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
