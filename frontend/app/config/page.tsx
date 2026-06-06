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

function Toggle({ label, name, value, onChange, hint }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{hint}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange({ target: { name, value: !value, type: 'checkbox', checked: !value } })}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
          background: value ? 'var(--green)' : 'var(--border)',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          left: value ? 23 : 3,
        }} />
      </button>
    </div>
  );
}

function Section({ title, children, cols = 'repeat(auto-fill, minmax(200px, 1fr))' }: { title: string; children: React.ReactNode; cols?: string }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 14 }}>
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
    if (config) setForm({
      ...config,
      scanIntervalSec: Math.round((config.scanIntervalMs ?? 5000) / 1000),
    });
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
      [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { scanIntervalSec, ...rest } = form;
    mutation.mutate({
      ...rest,
      scanIntervalMs: (scanIntervalSec ?? 5) * 1000,
    });
  };

  if (!config) return <div style={{ color: 'var(--text2)', padding: 20 }}>Loading config...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Configuration</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)' }}>Bot trading parameters — changes apply immediately</p>
        </div>
        <div className="page-header-actions" style={{ alignItems: 'center' }}>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>✓ Saved</span>}
          <button className="btn btn-primary" onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : '💾 Save Config'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Paper trading toggle */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
            Trading Mode
          </div>
          <Toggle
            label="Paper Trading"
            name="paperTrading"
            value={!!form.paperTrading}
            onChange={handleChange}
            hint="When enabled, no real orders are placed on Binance. All trades are simulated."
          />
          {!form.paperTrading && (
            <div style={{ marginTop: 12, padding: 12, background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--red)' }}>
              ⚠ Live trading will place REAL orders on Binance. Ensure your API keys are configured and you understand the risks.
            </div>
          )}
        </div>

        <Section title="Position Sizing">
          <Field label="Max Active Positions" name="maxActivePositions" value={form.maxActivePositions ?? ''} onChange={handleChange} min={1} max={20} step={1} hint="Max simultaneous open positions" />
          <Field label="Max Entries Per Symbol" name="maxEntriesPerSymbol" value={form.maxEntriesPerSymbol ?? ''} onChange={handleChange} min={1} max={10} step={1} hint="Max pyramid entries per symbol" />
          <Field label="Capital Per Entry ($)" name="maxCapitalPerEntry" value={form.maxCapitalPerEntry ?? ''} onChange={handleChange} min={10} step={10} hint="USDT allocated per entry" />
          <Field label="Leverage (x)" name="leverage" value={form.leverage ?? ''} onChange={handleChange} min={1} max={125} step={1} hint="Futures leverage multiplier" />
        </Section>

        <Section title="Trailing Stop Algorithm">
          <Field label="Activation %" name="activationPct" value={form.activationPct ?? ''} onChange={handleChange} min={0.1} max={20} step={0.1} hint="Profit % to activate trailing" />
          <Field label="Trailing %" name="trailingPct" value={form.trailingPct ?? ''} onChange={handleChange} min={0.1} max={20} step={0.1} hint="Trail distance from peak/trough" />
          <Field label="Hard Stop %" name="hardStopPct" value={form.hardStopPct ?? ''} onChange={handleChange} min={0.1} max={50} step={0.1} hint="Absolute maximum loss per trade" />
        </Section>

        {/* ── Trading Logic ─────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
            Trading Logic
          </div>

          {/* Feature toggles */}
          <div style={{ marginBottom: 20 }}>
            <Toggle
              label="Require Volume Confirmation"
              name="requireVolumeGate"
              value={!!form.requireVolumeGate}
              onChange={handleChange}
              hint="Block entries when 5m volume ratio < 1.3× average"
            />
            <Toggle
              label="Position Replacement"
              name="replacementEnabled"
              value={!!form.replacementEnabled}
              onChange={handleChange}
              hint="Allow bot to replace a weak position when a better opportunity scores higher"
            />
          </div>

          {/* Thresholds */}
          <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Thresholds</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Field label="Trade Score Threshold" name="tradeScoreThreshold" value={form.tradeScoreThreshold ?? ''} onChange={handleChange} min={0} max={100} step={1} hint="Min score (0–100) to enter a trade" />
            <Field label="Replacement Threshold" name="replacementThreshold" value={form.replacementThreshold ?? ''} onChange={handleChange} min={0} max={100} step={1} hint="Min opportunity gap to replace a position" />
          </div>

          {/* Trade score weights */}
          <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Score Weights
            <span style={{ marginLeft: 8, textTransform: 'none', fontSize: 10, color: 'var(--text3)' }}>
              (must sum to 100 — currently {[form.weightMomentum, form.weightTrend, form.weightVolume, form.weightBreakout, form.weightCandle].reduce((a, b) => (a || 0) + (b || 0), 0)})
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Field label="Momentum %" name="weightMomentum" value={form.weightMomentum ?? ''} onChange={handleChange} min={0} max={100} step={1} hint="Multi-TF momentum" />
            <Field label="Trend %" name="weightTrend" value={form.weightTrend ?? ''} onChange={handleChange} min={0} max={100} step={1} hint="EMA alignment" />
            <Field label="Volume %" name="weightVolume" value={form.weightVolume ?? ''} onChange={handleChange} min={0} max={100} step={1} hint="Volume ratio" />
            <Field label="Breakout %" name="weightBreakout" value={form.weightBreakout ?? ''} onChange={handleChange} min={0} max={100} step={1} hint="Price breakout/breakdown" />
            <Field label="Candle %" name="weightCandle" value={form.weightCandle ?? ''} onChange={handleChange} min={0} max={100} step={1} hint="Candle structure" />
          </div>

          {/* Momentum timeframe weights */}
          <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Momentum Timeframe Weights
            <span style={{ marginLeft: 8, textTransform: 'none', fontSize: 10, color: 'var(--text3)' }}>
              (must sum to 1 — currently {[form.mwt30s, form.mwt1m, form.mwt2m, form.mwt5m, form.mwt10m, form.mwt15m, form.mwt30m].reduce((a, b) => (a || 0) + (b || 0), 0).toFixed(2)})
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 14 }}>
            <Field label="30s" name="mwt30s" value={form.mwt30s ?? ''} onChange={handleChange} min={0} max={1} step={0.01} />
            <Field label="1m"  name="mwt1m"  value={form.mwt1m  ?? ''} onChange={handleChange} min={0} max={1} step={0.01} />
            <Field label="2m"  name="mwt2m"  value={form.mwt2m  ?? ''} onChange={handleChange} min={0} max={1} step={0.01} />
            <Field label="5m"  name="mwt5m"  value={form.mwt5m  ?? ''} onChange={handleChange} min={0} max={1} step={0.01} />
            <Field label="10m" name="mwt10m" value={form.mwt10m ?? ''} onChange={handleChange} min={0} max={1} step={0.01} />
            <Field label="15m" name="mwt15m" value={form.mwt15m ?? ''} onChange={handleChange} min={0} max={1} step={0.01} />
            <Field label="30m" name="mwt30m" value={form.mwt30m ?? ''} onChange={handleChange} min={0} max={1} step={0.01} />
          </div>
        </div>

        <Section title="Risk Management">
          <Field label="Max Daily Drawdown %" name="maxDailyDrawdownPct" value={form.maxDailyDrawdownPct ?? ''} onChange={handleChange} min={0.5} max={50} step={0.5} hint="Halt trading if daily loss exceeds this" />
          <Field label="Max Exposure %" name="maxExposurePct" value={form.maxExposurePct ?? ''} onChange={handleChange} min={10} step={5} hint="Max notional exposure as % of current balance" />
        </Section>

        <Section title="Cooldown Rules">
          <Field label="Cooldown Trigger Entries" name="cooldownEntries" value={form.cooldownEntries ?? ''} onChange={handleChange} min={1} max={20} step={1} hint="Entries within window to trigger cooldown" />
          <Field label="Cooldown Window (min)" name="cooldownWindowMin" value={form.cooldownWindowMin ?? ''} onChange={handleChange} min={1} max={60} step={1} hint="Time window for entry counting" />
          <Field label="Cooldown Duration (min)" name="cooldownDurationMin" value={form.cooldownDurationMin ?? ''} onChange={handleChange} min={1} max={120} step={1} hint="How long trading is paused per symbol" />
        </Section>

        <Section title="False Alarm Filter">
          <Field label="Failure Threshold" name="falseAlarmFailureThreshold" value={form.falseAlarmFailureThreshold ?? ''} onChange={handleChange} min={1} max={500} step={1} hint="Consecutive failures before cooldown kicks in" />
          <Field label="Base Cooldown (turns)" name="falseAlarmBaseCooldown" value={form.falseAlarmBaseCooldown ?? ''} onChange={handleChange} min={1} max={10000} step={1} hint="Initial cooldown length in scan turns" />
          <Field label="Cooldown Multiplier" name="falseAlarmMultiplier" value={form.falseAlarmMultiplier ?? ''} onChange={handleChange} min={1} max={10} step={0.1} hint="Exponential back-off factor per repeated offense" />
          <Field label="Max Cooldown (turns)" name="falseAlarmMaxCooldown" value={form.falseAlarmMaxCooldown ?? ''} onChange={handleChange} min={1} max={100000} step={1} hint="Upper cap on cooldown length" />
        </Section>

        <Section title="Scanner Pipeline">
          <Field label="Scan Interval (sec)" name="scanIntervalSec" value={form.scanIntervalSec ?? ''} onChange={handleChange} min={1} max={60} step={1} hint="How often to fetch prices from Binance and snapshot history" />
          <Field label="Price History (hrs)" name="priceHistoryHours" value={form.priceHistoryHours ?? ''} onChange={handleChange} min={1} max={24} step={1} hint="Rolling price history window kept in memory" />
          <Field label="Top Candidates" name="topCandidatesCount" value={form.topCandidatesCount ?? ''} onChange={handleChange} min={1} max={50} step={1} hint="Candidates passed to deep analysis per scan" />
        </Section>
      </form>
    </div>
  );
}
