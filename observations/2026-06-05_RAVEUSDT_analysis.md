# RAVEUSDT — Trade Analysis Observation
**Date:** 2026-06-05  
**Window fetched:** 16:42 – 19:41 UTC (180 × 1m candles)  
**Hypothetical entry time:** ~19:41 UTC ("12AM" scenario)  
**Data file:** `data/raveusdt_1m_3hr.json`

---

## Market Summary

| Field | Value |
|---|---|
| Open (16:42) | 0.3401 |
| Close (19:41) | 0.3266 |
| High | 0.3480 (17:07) |
| Low | 0.3154 (19:18) |
| 3hr Change | -3.97% |
| Total Volume | ~10.3M USDT |

### Key Price Events
- **16:42–17:07** — Slow grind up from 0.3401 → 0.3480 (peak)
- **17:10–18:19** — Gradual bleed, 0.3480 → 0.3390
- **18:52** — First crack: 517K volume candle, -1.3% in 1 min
- **18:54** — Crash candle: 852K volume (10× avg), low 0.3190. Likely liquidation cascade.
- **19:16–19:18** — Second leg down, low 0.3154 (session low)
- **19:19–19:41** — Dead-cat recovery, 0.3154 → 0.3266 on low volume

---

## Full Platform Analysis (at entry price 0.334)

When the fresh analysis ran, price had recovered to **0.334** (up from 0.3266 close of saved data).

### Pipeline Scores — LONG direction

| Layer | Weight | Score | Notes |
|---|---|---|---|
| Momentum | 40% | 100/100 | Strong multi-TF push: 5m +1.4%, 30m +5.1% |
| Trend | 20% | 50/100 | EMA20 > EMA50 only — EMA200 still above |
| Volume | 15% | 0/100 | 0.52× avg on 5m — critically thin |
| Breakout | 15% | 100/100 | Price broke above 3-candle high of 0.3300 |
| Candle | 10% | 100/100 | Strong bull, engulfing, clean wicks, 3 green |
| **Trade Score** | | **75/100** | Threshold: 80 — FAILED |

### Hard Gate Failures (all must pass)
- `volumeRatio >= 1.3` → **0.52× — FAILED**
- `breakoutConfirmed` → ✓
- `atrPct <= 5%` → 1.65% ✓
- `rangeExpansion <= 3×` → 1.27× ✓
- `liquidityPassed` → ✓ ($22M 24h vol, OI fine)

**Verdict at time of analysis: ⛔ TRADE REJECTED**

---

## Critical Error: Wrong Direction Assumed

The analysis was initially run as **LONG**, but the underlying structure favoured **SHORT**.

### Score Comparison at Snapshot Price (0.3279)

| Metric | LONG | SHORT |
|---|---|---|
| Momentum | 69 | 69 |
| Trend | **0** — NOT BULLISH | **100** — Full bearish stack |
| Volume | 0 | 0 |
| Breakout | 50 (near only) | 0 |
| Candle | 0 | 0 |
| **Trade Score** | **35.1** | **47.6** |

**SHORT scored 12.5 points higher than LONG at the same price.**

### Why the Structure Was Bearish
- EMA20 (0.3258) < EMA50 (0.3262) < EMA200 (0.3352) — perfect bearish EMA stack
- Price trading **below the 200 EMA** — dominant trend is down
- 60m change: **-2.2%** — the broad trend was bearish
- The visible momentum (+0.69 raw score) was a short-term dead-cat bounce off the 0.3154 low, not a genuine reversal
- Recovery volume was 0.11–0.52× average — sellers resting, not buyers engaging

**Lesson:** Short-term momentum (5–15m) can appear bullish during a bear market bounce. EMA200 position and 60m direction are the tiebreaker for structural bias.

---

## Hypothetical Backtest — LONG from 0.334

Simulated using platform position logic:
- Capital: $1,000 | Leverage: 5× | Fee rate: 0.04%
- Hard stop: -5% from entry = **0.3173**
- Trailing activation: +5% from entry = **0.3507**
- Trailing stop: 3% below peak once activated

### Position Lifecycle

| Phase | Time | Details |
|---|---|---|
| Entry | 18:23 UTC | @ 0.334000 |
| Peak | 18:40 UTC | 0.3375 (+1.05%) — trailing never activated |
| Crash begins | 18:52 UTC | 852K vol candle, -$90 unrealized |
| Hard stop hit | 19:17 UTC | Low 0.3171 < stop 0.3173 |
| Exit | 19:17 UTC | @ 0.3173 |

### Result

| Field | Value |
|---|---|
| Entry | 0.334000 |
| Exit | 0.317300 |
| Peak reached | 0.337500 (+1.05%) |
| Raw PnL | -$250.00 |
| Fees | -$3.90 |
| **Net PnL** | **-$253.90** |
| Price move | -5.00% |
| Capital loss | **-25.4%** (leveraged 5×) |

The trailing stop never activated — the position never moved +5% from entry. The hard stop did its job and capped the loss, but -25.4% on capital is the maximum pain the platform allows per trade by design.

### What SHORT Would Have Yielded
A SHORT from 0.334 → exit at 0.3173 (same level):
- Price move: +5.0% in favour
- Leveraged gain: **+25% on capital**
- Net PnL: ~**+$246** (after fees)

---

## Key Takeaways

1. **Volume gate is non-negotiable.** The bot rejected this LONG correctly. The 0.52× volume flag was the exact signal that the recovery had no real buyers — confirmed by the subsequent crash.

2. **Check both directions before deciding.** Running only LONG missed the stronger SHORT signal (47.6 vs 35.1). The platform does this automatically via `topBullish` and `topBearish` — manual analysis should too.

3. **EMA200 position beats short-term momentum.** When price is below EMA200 and EMA20 < EMA50 < EMA200, any short-term bullish momentum should be treated as a counter-trend bounce, not a reversal entry.

4. **Dead-cat bounces look bullish on 5–15m momentum.** The +5.1% 30m change that made momentum score 100/100 was entirely from the 0.3154 low recovery. Without looking at EMA200 context, this reads as a strong long setup. Context kills the signal.

5. **The hard stop prevented a worse outcome.** Without it, holding through the 19:17 low (0.3171) and continuing down would have compounded losses further. The -5% / -25% cap is working as intended.

---

## Platform Validation Notes

The following platform behaviours were confirmed to work as designed in this test:
- `DeepAnalysisService`: volume gate hard-rejected a low-confidence recovery bounce ✓
- `TradeValidatorService`: weighted score correctly under-weighted weak volume ✓
- `PositionEngineService`: hard stop triggered correctly at exact -5% level ✓
- Trailing stop logic: correctly never activated (peak was only +1.05%, threshold +5%) ✓
- `MomentumRankerService`: SHORT would have ranked higher than LONG in `topBearish` at this moment ✓
