'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchLogs, BotLog } from '../../lib/api';
import { useState } from 'react';

const LEVELS    = ['ALL', 'INFO', 'WARN', 'ERROR'] as const;
const CATEGORIES = ['ALL', 'BOT', 'POSITION', 'RISK', 'SYSTEM'] as const;

const levelColor: Record<string, string> = {
  INFO:  'var(--blue)',
  WARN:  'var(--yellow)',
  ERROR: 'var(--red)',
};

const categoryColor: Record<string, string> = {
  BOT:      'var(--green)',
  POSITION: 'var(--blue)',
  RISK:     'var(--red)',
  SYSTEM:   'var(--text3)',
};

function MetaRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.6 }}>
      <span style={{ color: 'var(--text3)', minWidth: 110 }}>{label}</span>
      <span style={{ color: 'var(--text2)', wordBreak: 'break-all' }}>{display}</span>
    </div>
  );
}

function FalseAlarmDetail({ meta }: { meta: Record<string, unknown> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(255, 171, 0, 0.08)', border: '1px solid rgba(255, 171, 0, 0.25)',
        fontSize: 12, color: 'var(--text)', lineHeight: 1.7,
      }}>
        {String(meta.description ?? '')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {[
          { label: 'Offense #',       value: meta.offenseCount },
          { label: 'Threshold (turns)', value: meta.threshold },
          { label: 'Cooldown (turns)', value: meta.cooldownTurns },
          { label: 'Ends at turn',     value: meta.cooldownEndsAtTurn },
        ].map(({ label, value }) => value !== undefined && (
          <div key={label} style={{
            padding: '8px 12px', borderRadius: 6, background: 'var(--bg2)',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--yellow)' }}>{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogRow({ log }: { log: BotLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasMeta = log.metadata && Object.keys(log.metadata).length > 0;

  return (
    <>
      <tr
        onClick={() => hasMeta && setExpanded(v => !v)}
        style={{ cursor: hasMeta ? 'pointer' : 'default', opacity: 1 }}
      >
        <td style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
          {new Date(log.createdAt).toLocaleString()}
        </td>
        <td>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            color: levelColor[log.level] || 'var(--text2)',
          }}>
            {log.level}
          </span>
        </td>
        <td>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
            color: categoryColor[log.category] || 'var(--text3)',
          }}>
            {log.category}
          </span>
        </td>
        <td style={{ fontSize: 11, color: 'var(--text3)' }}>{log.event}</td>
        <td style={{ fontSize: 12, color: 'var(--text)' }}>
          {log.symbol && (
            <span style={{ fontWeight: 700, marginRight: 6, color: 'var(--blue)' }}>
              {log.symbol}
            </span>
          )}
          {log.message}
        </td>
        <td style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>
          {hasMeta ? (expanded ? '▲' : '▼') : ''}
        </td>
      </tr>
      {expanded && hasMeta && (
        <tr>
          <td colSpan={6} style={{ padding: '0 12px 12px 12px', background: 'var(--bg3)' }}>
            <div style={{ padding: '10px 12px', borderRadius: 6, background: 'var(--bg2)' }}>
              {log.event === 'FALSE_ALARM'
                ? <FalseAlarmDetail meta={log.metadata!} />
                : Object.entries(log.metadata!).map(([k, v]) => (
                    <MetaRow key={k} label={k} value={v} />
                  ))
              }
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function LogsPage() {
  const [level,    setLevel]    = useState<string>('ALL');
  const [category, setCategory] = useState<string>('ALL');
  const [symbol,   setSymbol]   = useState('');
  const [limit,    setLimit]    = useState(200);

  const params = {
    limit,
    level:    level    !== 'ALL' ? level    : undefined,
    category: category !== 'ALL' ? category : undefined,
    symbol:   symbol.trim() || undefined,
  };

  const { data: logs = [] } = useQuery({
    queryKey: ['logs', params],
    queryFn: () => fetchLogs(params),
    refetchInterval: 5000,
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Bot Logs</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>{logs.length} entries · refreshes every 5s</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {LEVELS.map(l => (
            <button
              key={l}
              className={level === l ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ padding: '4px 10px', fontSize: 11 }}
              onClick={() => setLevel(l)}
            >
              {l}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {CATEGORIES.map(c => (
            <button
              key={c}
              className={category === c ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ padding: '4px 10px', fontSize: 11 }}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
        <input
          placeholder="Filter symbol…"
          value={symbol}
          onChange={e => setSymbol(e.target.value.toUpperCase())}
          style={{
            background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 10px', fontSize: 12, color: 'var(--text)', width: 140,
          }}
        />
        <select
          value={limit}
          onChange={e => setLimit(Number(e.target.value))}
          style={{
            background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 8px', fontSize: 12, color: 'var(--text)',
          }}
        >
          {[100, 200, 500, 1000].map(n => (
            <option key={n} value={n}>Last {n}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {logs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text3)' }}>
          No logs found. Bot events will appear here once the bot runs.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Category</th>
                  <th>Event</th>
                  <th>Message</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => <LogRow key={log.id} log={log} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
