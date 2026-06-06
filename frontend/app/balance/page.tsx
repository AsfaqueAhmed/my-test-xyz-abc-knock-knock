'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchBalanceStats, fetchLedger, depositBalance, withdrawBalance, LedgerEntry } from '../../lib/api';
import { useState } from 'react';

const PAGE_SIZE = 50;

// ─── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: LedgerEntry['type'] }) {
  switch (type) {
    case 'DEPOSIT':    return <span className="badge-green">DEPOSIT</span>;
    case 'WITHDRAWAL': return <span className="badge-red">WITHDRAW</span>;
    case 'TRADE_OPEN': return <span className="badge-yellow">TRADE FEE</span>;
    case 'TRADE_CLOSE':return <span className="badge-blue">TRADE PNL</span>;
    default:           return <span className="badge-gray">{type}</span>;
  }
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Action panel ─────────────────────────────────────────────────────────────

type ActionMode = null | 'deposit' | 'withdraw';

function ActionPanel({
  mode, balance, onClose,
  onDeposit, onWithdraw,
  isPending,
}: {
  mode: ActionMode;
  balance: number;
  onClose: () => void;
  onDeposit: (amount: number, desc: string) => void;
  onWithdraw: (amount: number, desc: string) => void;
  isPending: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [desc, setDesc]     = useState('');

  if (!mode) return null;

  const isDeposit = mode === 'deposit';
  const accentColor = isDeposit ? 'var(--green)' : 'var(--red)';
  const max = !isDeposit ? balance : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    if (isDeposit) onDeposit(n, desc);
    else onWithdraw(n, desc);
  };

  return (
    <div className="card" style={{ marginBottom: 24, border: `1px solid ${accentColor}33` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: accentColor }}>
          {isDeposit ? '↓ Deposit Funds' : '↑ Withdraw Funds'}
        </div>
        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onClose}>✕ Cancel</button>
      </div>

      {!isDeposit && (
        <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--text2)' }}>
          Available: <span style={{ color: 'var(--text)', fontWeight: 600 }}>${balance.toFixed(2)}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label>Amount ($)</label>
          <input
            type="number"
            min={0.01}
            max={max}
            step={0.01}
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ borderColor: amount && parseFloat(amount) > 0 ? accentColor : undefined }}
            autoFocus
          />
        </div>
        <div>
          <label>Note (optional)</label>
          <input
            type="text"
            placeholder={isDeposit ? 'e.g. Initial deposit' : 'e.g. Profit withdrawal'}
            value={desc}
            onChange={e => setDesc(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={isPending || !amount || parseFloat(amount) <= 0}
          className={`btn ${isDeposit ? 'btn-green' : 'btn-red'}`}
          style={{ whiteSpace: 'nowrap' }}
        >
          {isPending ? 'Processing…' : isDeposit ? '↓ Deposit' : '↑ Withdraw'}
        </button>
      </form>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BalancePage() {
  const qc = useQueryClient();
  const [page, setPage]       = useState(0);
  const [mode, setMode]       = useState<ActionMode>(null);
  const [flash, setFlash]     = useState<{ msg: string; ok: boolean } | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['balance-stats'],
    queryFn: fetchBalanceStats,
    refetchInterval: 10000,
  });

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['balance-ledger', page],
    queryFn: () => fetchLedger(PAGE_SIZE, page * PAGE_SIZE),
    refetchInterval: 10000,
  });

  const notify = (msg: string, ok: boolean) => {
    setFlash({ msg, ok });
    setTimeout(() => setFlash(null), 3000);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['balance-stats'] });
    qc.invalidateQueries({ queryKey: ['balance-ledger'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const depositMut = useMutation({
    mutationFn: ({ amount, desc }: { amount: number; desc: string }) =>
      depositBalance(amount, desc || undefined),
    onSuccess: () => { invalidate(); setMode(null); notify('Deposit successful', true); },
    onError:   (e: any) => notify(e?.response?.data?.message || 'Deposit failed', false),
  });

  const withdrawMut = useMutation({
    mutationFn: ({ amount, desc }: { amount: number; desc: string }) =>
      withdrawBalance(amount, desc || undefined),
    onSuccess: () => { invalidate(); setMode(null); notify('Withdrawal successful', true); },
    onError:   (e: any) => notify(e?.response?.data?.message || 'Withdrawal failed', false),
  });

  const isPending = depositMut.isPending || withdrawMut.isPending;
  const balance   = stats?.currentBalance ?? 0;
  const total     = ledger?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const entries   = ledger?.entries ?? [];

  const amtColor = (e: LedgerEntry) => {
    if (e.type === 'DEPOSIT')    return 'var(--green)';
    if (e.type === 'WITHDRAWAL') return 'var(--red)';
    if (e.type === 'TRADE_OPEN') return 'var(--red)';
    return e.amount >= 0 ? 'var(--green)' : 'var(--red)';
  };

  const fmtAmt = (e: LedgerEntry) =>
    `${e.amount >= 0 ? '+' : ''}$${Math.abs(e.amount).toFixed(4)}`;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Balance</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>Manage funds and track every transaction</p>
        </div>
        <div className="page-header-actions">
          {flash && (
            <span style={{ fontSize: 13, color: flash.ok ? 'var(--green)' : 'var(--red)' }}>
              {flash.ok ? '✓' : '✗'} {flash.msg}
            </span>
          )}
          <button
            className="btn btn-green"
            onClick={() => setMode(mode === 'deposit' ? null : 'deposit')}
            disabled={isPending}
          >
            ↓ Deposit
          </button>
          <button
            className="btn btn-red"
            onClick={() => setMode(mode === 'withdraw' ? null : 'withdraw')}
            disabled={isPending}
          >
            ↑ Withdraw
          </button>
        </div>
      </div>

      {/* Stats */}
      {statsLoading ? (
        <div style={{ color: 'var(--text2)', marginBottom: 24 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <Stat label="Current Balance" value={`$${balance.toFixed(2)}`} color="var(--text)" />
          <Stat label="Total Deposited" value={`$${(stats?.totalDeposited ?? 0).toFixed(2)}`} color="var(--green)" />
          <Stat label="Total Withdrawn" value={`$${(stats?.totalWithdrawn ?? 0).toFixed(2)}`} color="var(--red)" />
          <Stat
            label="Net PnL"
            value={`${(stats?.totalPnl ?? 0) >= 0 ? '+' : ''}$${(stats?.totalPnl ?? 0).toFixed(2)}`}
            color={(stats?.totalPnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'}
          />
          <Stat label="Total Fees Paid" value={`$${(stats?.totalFees ?? 0).toFixed(4)}`} color="var(--yellow)" />
          <Stat label="Closed Trades" value={`${stats?.tradeCount ?? 0}`} color="var(--text2)" />
        </div>
      )}

      {/* Action panel */}
      <ActionPanel
        mode={mode}
        balance={balance}
        onClose={() => setMode(null)}
        onDeposit={(amount, desc) => depositMut.mutate({ amount, desc })}
        onWithdraw={(amount, desc) => withdrawMut.mutate({ amount, desc })}
        isPending={isPending}
      />

      {/* Ledger */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Transaction Ledger
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{total} entries</div>
        </div>

        {ledgerLoading ? (
          <div style={{ padding: 32, color: 'var(--text2)', textAlign: 'center' }}>Loading ledger…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 48, color: 'var(--text3)', textAlign: 'center' }}>
            No transactions yet — deposit funds to get started
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="desktop-only" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Balance After</th>
                    <th>Symbol</th>
                    <th>Description</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td><TypeBadge type={e.type} /></td>
                      <td style={{ fontWeight: 700, color: amtColor(e) }}>{fmtAmt(e)}</td>
                      <td style={{ color: 'var(--text2)' }}>${Number(e.balanceAfter).toFixed(2)}</td>
                      <td style={{ fontWeight: e.symbol ? 600 : 400, color: e.symbol ? 'var(--text)' : 'var(--text3)' }}>
                        {e.symbol ?? '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{e.description}</td>
                      <td style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(e.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="mobile-only" style={{ padding: 12 }}>
              {entries.map((e) => (
                <div key={e.id} className="m-card">
                  <div className="m-row">
                    <TypeBadge type={e.type} />
                    <span style={{ fontSize: 18, fontWeight: 700, color: amtColor(e) }}>{fmtAmt(e)}</span>
                  </div>
                  <hr className="m-divider" />
                  <div className="m-row">
                    <div>
                      <div className="m-label">Balance After</div>
                      <div className="m-val">${Number(e.balanceAfter).toFixed(2)}</div>
                    </div>
                    {e.symbol && (
                      <div style={{ textAlign: 'right' }}>
                        <div className="m-label">Symbol</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{e.symbol}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
                    {e.description} · {new Date(e.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '5px 14px' }}
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  ← Prev
                </button>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                  Page {page + 1} / {totalPages}
                </span>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '5px 14px' }}
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
