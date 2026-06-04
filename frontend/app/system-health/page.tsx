'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth, fetchDashboard } from '../../lib/api';

function StatusRow({ label, status, detail }: { label: string; status: 'ok' | 'warn' | 'error'; detail?: string }) {
  const colors = { ok: 'var(--green)', warn: 'var(--yellow)', error: 'var(--red)' };
  const icons = { ok: '●', warn: '◐', error: '●' };
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <span style={{ fontSize: 14 }}>{label}</span>
        {detail && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{detail}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: colors[status], fontSize: 10 }}>{icons[status]}</span>
        <span style={{ color: colors[status], fontWeight: 700, fontSize: 13 }}>
          {status === 'ok' ? 'ONLINE' : status === 'warn' ? 'DEGRADED' : 'OFFLINE'}
        </span>
      </div>
    </div>
  );
}

export default function SystemHealthPage() {
  const { data: health, dataUpdatedAt, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
    retry: false,
  });

  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard, refetchInterval: 5000 });

  const h = health as any;
  const d = dash as any;

  const backendOk = !isError && !!h;
  const dbOk = backendOk && h?.database === 'connected';
  const wsOk = backendOk && h?.websocket;
  const lastUpdate = h?.lastMarketUpdate ? new Date(h.lastMarketUpdate) : null;
  const staleSecs = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : null;
  const marketFresh = staleSecs !== null && staleSecs < 60;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>System Health</h1>
        <p style={{ fontSize: 12, color: 'var(--text3)' }}>
          Last checked: {new Date(dataUpdatedAt).toLocaleTimeString()}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Services */}
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Services
          </div>
          <StatusRow
            label="NestJS Backend"
            status={backendOk ? 'ok' : 'error'}
            detail={backendOk ? `Port 3001` : 'Cannot reach http://localhost:3001'}
          />
          <StatusRow
            label="PostgreSQL Database"
            status={dbOk ? 'ok' : 'error'}
            detail={dbOk ? 'Connected' : 'Database unreachable'}
          />
          <StatusRow
            label="Binance WebSocket"
            status={wsOk ? 'ok' : 'warn'}
            detail={wsOk ? 'fstream.binance.com' : 'Disconnected — reconnecting...'}
          />
          <StatusRow
            label="Market Data Feed"
            status={marketFresh ? 'ok' : 'warn'}
            detail={lastUpdate
              ? `Last update: ${staleSecs}s ago (${lastUpdate.toLocaleTimeString()})`
              : 'No market data received yet'
            }
          />
        </div>

        {/* Bot stats */}
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Bot Runtime
          </div>
          {[
            { label: 'Trading Mode', value: 'Paper Trading' },
            { label: 'Bot Status', value: d?.emergencyStop ? 'EMERGENCY STOP' : d?.botRunning ? (d?.botPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED' },
            { label: 'Open Positions', value: d?.openPositionsCount ?? '—' },
            { label: 'Balance', value: d?.balance != null ? `$${d.balance.toFixed(2)}` : '—' },
            { label: 'Equity', value: d?.equity != null ? `$${d.equity.toFixed(2)}` : '—' },
            { label: 'Total Trades', value: d?.totalTrades ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
              <span style={{ color: 'var(--text2)' }}>{label}</span>
              <span style={{ fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Connectivity check */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
          Connection Details
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {[
            { label: 'Backend URL', value: 'http://localhost:3001/api' },
            { label: 'WebSocket Feed', value: 'wss://fstream.binance.com' },
            { label: 'REST API', value: 'https://fapi.binance.com' },
            { label: 'Database', value: 'postgresql://localhost:5432' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'monospace' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick start guide */}
      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
          Quick Start
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { step: '1', cmd: 'docker compose up -d', desc: 'Start PostgreSQL' },
            { step: '2', cmd: 'cd backend && npx prisma migrate deploy', desc: 'Run database migrations' },
            { step: '3', cmd: 'cd backend && npm run start:dev', desc: 'Start the NestJS backend' },
            { step: '4', cmd: 'cd frontend && npm run dev', desc: 'Start the Next.js frontend (this app)' },
          ].map(({ step, cmd, desc }) => (
            <div key={step} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: 'var(--blue2)', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>{step}</div>
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', background: 'var(--bg3)', padding: '3px 8px', borderRadius: 4, display: 'inline-block', marginBottom: 2 }}>
                  {cmd}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
