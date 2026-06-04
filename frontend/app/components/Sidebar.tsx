'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboard } from '../../lib/api';

const navItems = [
  { href: '/', label: 'Dashboard', icon: '⬡' },
  { href: '/market', label: 'Market', icon: '◫' },
  { href: '/positions', label: 'Positions', icon: '◈' },
  { href: '/signals', label: 'Signals', icon: '⚡' },
  { href: '/trades', label: 'Trades', icon: '↔' },
  { href: '/analytics', label: 'Analytics', icon: '◰' },
  { href: '/risk', label: 'Risk', icon: '⚠' },
  { href: '/config', label: 'Config', icon: '⚙' },
  { href: '/bot-control', label: 'Bot Control', icon: '▶' },
  { href: '/logs', label: 'Logs', icon: '≡' },
  { href: '/system-health', label: 'System', icon: '◎' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard, refetchInterval: 5000 });

  const botRunning = data?.botRunning;
  const botPaused = data?.botPaused;
  const emergencyStop = data?.emergencyStop;

  let statusLabel = 'STOPPED';
  let statusColor = 'var(--red)';
  if (emergencyStop) { statusLabel = 'EMERGENCY'; statusColor = 'var(--red)'; }
  else if (botRunning && botPaused) { statusLabel = 'PAUSED'; statusColor = 'var(--yellow)'; }
  else if (botRunning) { statusLabel = 'RUNNING'; statusColor = 'var(--green)'; }

  return (
    <aside style={{
      width: 220,
      height: '100vh',
      background: 'var(--bg2)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      padding: '0',
      flexShrink: 0,
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.05em' }}>
          ◈ MOMENTUM
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>FUTURES BOT</div>
      </div>

      {/* Bot Status */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bot Status</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: statusColor,
            boxShadow: botRunning && !botPaused && !emergencyStop ? `0 0 6px ${statusColor}` : 'none',
            animation: botRunning && !botPaused && !emergencyStop ? 'pulse 2s infinite' : 'none',
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
        </div>
        {data && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text2)' }}>
            Balance: <span style={{ color: 'var(--text)' }}>${(data.balance || 0).toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0' }}>
        {navItems.map(({ href, label, icon }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 20px',
              textDecoration: 'none',
              fontSize: 13,
              color: active ? 'var(--text)' : 'var(--text2)',
              background: active ? 'rgba(61,127,255,0.1)' : 'transparent',
              borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
              transition: 'all 0.1s',
            }}>
              <span style={{ fontSize: 14, color: active ? 'var(--blue)' : 'inherit' }}>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
        <div>Paper Trading Mode</div>
        <div style={{ marginTop: 2 }}>v1.0.0</div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </aside>
  );
}
