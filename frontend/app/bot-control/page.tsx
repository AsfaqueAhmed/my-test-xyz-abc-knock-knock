'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchDashboard, botStart, botStop, botPause, botResume, botCloseAll, botEmergencyStop } from '../../lib/api';
import { useState } from 'react';

export default function BotControlPage() {
  const qc = useQueryClient();
  const [confirmEmergency, setConfirmEmergency] = useState(false);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [log, setLog] = useState<{ time: string; msg: string; type: 'info' | 'warn' | 'error' }[]>([]);

  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard, refetchInterval: 3000 });
  const d = dash as any;

  const botRunning = d?.botRunning;
  const botPaused = d?.botPaused;
  const emergencyStop = d?.emergencyStop;

  function addLog(msg: string, type: 'info' | 'warn' | 'error' = 'info') {
    setLog(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev.slice(0, 49)]);
  }

  function makeMut(fn: () => Promise<any>, label: string, type: 'info' | 'warn' | 'error' = 'info') {
    return useMutation({
      mutationFn: fn,
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        addLog(label, type);
      },
      onError: (e: any) => addLog(`Error: ${e.message}`, 'error'),
    });
  }

  const startMut = makeMut(botStart, '▶ Bot started — trading enabled');
  const stopMut = makeMut(botStop, '■ Bot stopped — trading disabled', 'warn');
  const pauseMut = makeMut(botPause, '⏸ Bot paused — no new entries', 'warn');
  const resumeMut = makeMut(botResume, '▶ Bot resumed');
  const closeAllMut = useMutation({
    mutationFn: botCloseAll,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboard', 'positions'] }); addLog('⚠ All positions closed', 'warn'); setConfirmCloseAll(false); },
    onError: (e: any) => addLog(`Error: ${e.message}`, 'error'),
  });
  const emergencyMut = useMutation({
    mutationFn: botEmergencyStop,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboard', 'positions'] }); addLog('🛑 EMERGENCY STOP executed — all positions closed, trading halted', 'error'); setConfirmEmergency(false); },
    onError: (e: any) => addLog(`Error: ${e.message}`, 'error'),
  });

  let statusLabel = 'STOPPED';
  let statusColor = 'var(--red)';
  if (emergencyStop) { statusLabel = 'EMERGENCY STOP'; statusColor = 'var(--red)'; }
  else if (botRunning && botPaused) { statusLabel = 'PAUSED'; statusColor = 'var(--yellow)'; }
  else if (botRunning) { statusLabel = 'RUNNING'; statusColor = 'var(--green)'; }

  const anyPending = startMut.isPending || stopMut.isPending || pauseMut.isPending || resumeMut.isPending;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Bot Control</h1>
        <p style={{ fontSize: 12, color: 'var(--text3)' }}>Start, stop and manage the trading bot</p>
      </div>

      {/* Emergency stop banner */}
      {emergencyStop && (
        <div style={{
          background: 'rgba(255,71,87,0.15)',
          border: '1px solid rgba(255,71,87,0.5)',
          borderRadius: 8, padding: '14px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>🛑</span>
          <div>
            <div style={{ color: 'var(--red)', fontWeight: 700 }}>EMERGENCY STOP ACTIVE</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>All trading is halted. Restart the bot to resume.</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Status */}
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Current Status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--text2)' }}>Bot State</span>
              <span style={{ color: statusColor, fontWeight: 700 }}>● {statusLabel}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--text2)' }}>Balance</span>
              <span style={{ fontWeight: 600 }}>${(d?.balance || 0).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--text2)' }}>Equity</span>
              <span style={{ fontWeight: 600 }}>${(d?.equity || 0).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--text2)' }}>Open Positions</span>
              <span>{d?.openPositionsCount || 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--text2)' }}>Daily PnL</span>
              <span style={{ color: (d?.dailyPnl || 0) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                {(d?.dailyPnl || 0) >= 0 ? '+' : ''}${(d?.dailyPnl || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Main controls */}
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Controls</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!botRunning ? (
              <button className="btn btn-green" style={{ justifyContent: 'center', padding: '12px' }} onClick={() => startMut.mutate()} disabled={anyPending}>
                ▶ Start Bot
              </button>
            ) : (
              <button className="btn btn-ghost" style={{ justifyContent: 'center', padding: '12px' }} onClick={() => stopMut.mutate()} disabled={anyPending}>
                ■ Stop Bot
              </button>
            )}
            {botRunning && !botPaused && (
              <button className="btn btn-yellow" style={{ justifyContent: 'center', padding: '12px' }} onClick={() => pauseMut.mutate()} disabled={anyPending}>
                ⏸ Pause Trading
              </button>
            )}
            {botRunning && botPaused && (
              <button className="btn btn-green" style={{ justifyContent: 'center', padding: '12px' }} onClick={() => resumeMut.mutate()} disabled={anyPending}>
                ▶ Resume Trading
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="card" style={{ border: '1px solid rgba(255,71,87,0.2)', marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Danger Zone</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Close All */}
          <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Close All Positions</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
              Close all currently open positions at market price. Bot continues running.
            </div>
            {!confirmCloseAll ? (
              <button className="btn btn-red" onClick={() => setConfirmCloseAll(true)} disabled={closeAllMut.isPending}>
                Close All Positions
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-red" onClick={() => closeAllMut.mutate()} disabled={closeAllMut.isPending}>
                  {closeAllMut.isPending ? 'Closing…' : 'Confirm Close All'}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmCloseAll(false)}>Cancel</button>
              </div>
            )}
          </div>

          {/* Emergency Stop */}
          <div style={{ background: 'rgba(255,71,87,0.05)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--red)' }}>Emergency Stop</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
              Immediately close ALL positions and halt all trading activity. Use in emergencies only.
            </div>
            {!confirmEmergency ? (
              <button className="btn btn-red" style={{ background: 'rgba(255,71,87,0.25)', borderColor: 'rgba(255,71,87,0.5)' }} onClick={() => setConfirmEmergency(true)}>
                🛑 Emergency Stop
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-red" style={{ background: 'rgba(255,71,87,0.35)' }} onClick={() => emergencyMut.mutate()} disabled={emergencyMut.isPending}>
                  {emergencyMut.isPending ? 'Executing…' : '🛑 CONFIRM EMERGENCY'}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmEmergency(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Activity log */}
      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
          Activity Log
          {log.length > 0 && (
            <button className="btn btn-ghost" style={{ float: 'right', padding: '2px 8px', fontSize: 11 }} onClick={() => setLog([])}>Clear</button>
          )}
        </div>
        {log.length === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>No activity yet — use the controls above</div>
        ) : (
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {log.map((entry, i) => (
              <div key={i} style={{
                padding: '4px 0',
                borderBottom: '1px solid var(--border)',
                color: entry.type === 'error' ? 'var(--red)' : entry.type === 'warn' ? 'var(--yellow)' : 'var(--text2)',
                display: 'flex', gap: 12,
              }}>
                <span style={{ color: 'var(--text3)', minWidth: 80 }}>{entry.time}</span>
                <span>{entry.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
