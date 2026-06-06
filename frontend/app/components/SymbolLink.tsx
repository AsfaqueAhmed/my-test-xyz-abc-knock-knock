'use client';
import { useChartStore } from '../../lib/chartStore';

export function SymbolLink({
  symbol,
  children,
  style,
}: {
  symbol: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const open = useChartStore(s => s.open);
  return (
    <span
      onClick={e => { e.stopPropagation(); open(symbol); }}
      style={{
        cursor: 'pointer',
        borderBottom: '1px dashed rgba(255,255,255,0.2)',
        transition: 'border-color 0.15s, color 0.15s',
        ...style,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderBottomColor = 'var(--blue)'; (e.currentTarget as HTMLElement).style.color = 'var(--blue)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(255,255,255,0.2)'; (e.currentTarget as HTMLElement).style.color = ''; }}
    >
      {children}
    </span>
  );
}
