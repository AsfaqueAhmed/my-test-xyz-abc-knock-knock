'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchConfig, updateConfig } from '../../lib/api';
import { useState, useEffect } from 'react';

function Field({ label, name, value, onChange, type = 'number', min, max, step, hint }: any) {
  return (
    <div>
      <label>{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step || (type === 'number' ? '0.1' : undefined)}
      />
      {hint && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const qc = useQueryClient();
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: fetchConfig });
  const [form, setForm] = useState<any>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const mutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setForm((prev: any) => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) : type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  if (!config) return <div style={{ color: 'var(--text2)', padding: 20 }}>Loading config...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Configuration</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>Bot trading parameters — changes apply immediately</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>✓ Saved</span>}
          <button className="btn btn-primary" onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : '💾 Save Config'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Section title="Position Sizing">
          <Field label="Max Active Symbols" name="maxActiveSymbols" value={form.maxActiveSymbols ?? ''} onChange={handleChange} min={1} max={20} step={1} hint="Max simultaneous open positions" />
          <Field label="Max Entries Per Symbol" name="maxEntriesPerSymbol" value={form.maxEntriesPerSymbol ?? ''} onChange={handleChange} min={1} max={10} step={1} hint="Max pyramid entries per symbol" />
          <Field label="Capital Per Entry ($)" name="maxCapitalPerEntry" value={form.maxCapitalPerEntry ?? ''} onChange={handleChange} min={10} step={10} hint="USDT allocated per entry" />
          <Field label="Initial Balance ($)" name="initialBalance" value={form.initialBalance ?? ''} onChange={handleChange} min={100} step={100} hint="Starting paper balance" />
          <Field label="Leverage (x)" name="leverage" value={form.leverage ?? ''} onChange={handleChange} min={1} max={125} step={1} hint="Futures leverage multiplier" />
        </Section>

        <Section title="Trailing Stop Algorithm">
          <Field label="Activation %" name="activationPct" value={form.activationPct ?? ''} onChange={handleChange} min={0.1} max={20} step={0.1} hint="Profit % to activate trailing" />
          <Field label="Trailing %" name="trailingPct" value={form.trailingPct ?? ''} onChange={handleChange} min={0.1} max={20} step={0.1} hint="Trail distance from peak/trough" />
          <Field label="Hard Stop %" name="hardStopPct" value={form.hardStopPct ?? ''} onChange={handleChange} min={0.1} max={50} step={0.1} hint="Absolute maximum loss per trade" />
        </Section>

        <Section title="Signal Thresholds">
          <Field label="Momentum Threshold" name="momentumThreshold" value={form.momentumThreshold ?? ''} onChange={handleChange} min={0.01} max={5} step={0.01} hint="Min momentum score to generate signal" />
        </Section>

        <Section title="Risk Management">
          <Field label="Max Daily Drawdown %" name="maxDailyDrawdownPct" value={form.maxDailyDrawdownPct ?? ''} onChange={handleChange} min={0.5} max={50} step={0.5} hint="Halt trading if daily loss exceeds this" />
          <Field label="Max Exposure %" name="maxExposurePct" value={form.maxExposurePct ?? ''} onChange={handleChange} min={10} max={100} step={5} hint="Max % of balance in open positions" />
        </Section>

        <Section title="Cooldown Rules">
          <Field label="Cooldown Trigger Entries" name="cooldownEntries" value={form.cooldownEntries ?? ''} onChange={handleChange} min={1} max={20} step={1} hint="Entries within window to trigger cooldown" />
          <Field label="Cooldown Window (min)" name="cooldownWindowMin" value={form.cooldownWindowMin ?? ''} onChange={handleChange} min={1} max={60} step={1} hint="Time window for entry counting" />
          <Field label="Cooldown Duration (min)" name="cooldownDurationMin" value={form.cooldownDurationMin ?? ''} onChange={handleChange} min={1} max={120} step={1} hint="How long trading is paused per symbol" />
        </Section>

        {/* Symbols */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
            Monitored Symbols
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','MATICUSDT'].map(sym => {
              const active = (form.symbols || []).includes(sym);
              return (
                <button
                  key={sym}
                  type="button"
                  className={active ? 'btn btn-primary' : 'btn btn-ghost'}
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={() => {
                    const current: string[] = form.symbols || [];
                    setForm((prev: any) => ({
                      ...prev,
                      symbols: active ? current.filter(s => s !== sym) : [...current, sym],
                    }));
                  }}
                >
                  {sym.replace('USDT', '')}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
            {(form.symbols || []).length} symbols selected
          </div>
        </div>

        {/* Paper trading toggle */}
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
            Trading Mode
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Paper Trading</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                When enabled, no real orders are placed on Binance. All trades are simulated.
              </div>
            </div>
            <div>
              <span className={form.paperTrading ? 'badge-green' : 'badge-red'} style={{ fontSize: 14, padding: '6px 16px' }}>
                {form.paperTrading ? 'PAPER MODE ✓' : 'LIVE MODE ⚠'}
              </span>
            </div>
          </div>
          {!form.paperTrading && (
            <div style={{ marginTop: 12, padding: 12, background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--red)' }}>
              ⚠ Live trading will place REAL orders on Binance. Ensure your API keys are configured and you understand the risks.
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
