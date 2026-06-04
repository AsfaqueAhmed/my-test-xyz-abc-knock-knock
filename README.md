# Momentum Trading Platform

A full-stack Binance Futures momentum trading bot with real-time market data, automated signal generation, position management, and a web dashboard.

> **Paper Trading Mode by default** — no real orders are placed until you explicitly enable live trading.

---

## Architecture

```
Binance Futures WebSocket
        ↓
  Market Data Service   ← real-time 30s/1m/2m/5m/10m/15m/30m candles
        ↓
  Indicators Service    ← EMA20/50/200, momentum score, volume, breakout
        ↓
  Signal Engine         ← LONG / SHORT signal generation
        ↓
  Position Engine       ← state machine: OPEN → TRAILING → CLOSED
        ↓
  Risk Engine           ← drawdown protection, cooldowns, emergency stop
        ↓
  PostgreSQL (Docker)
        ↓
  NestJS REST API  →  Next.js Dashboard
```

---

## Tech Stack

| Layer       | Technology                                      |
|-------------|------------------------------------------------|
| Backend     | NestJS 11, TypeScript                          |
| Database    | PostgreSQL 16 (Docker), Prisma ORM             |
| Scheduling  | @nestjs/schedule                               |
| Events      | @nestjs/event-emitter                          |
| Frontend    | Next.js 15, TypeScript                         |
| UI          | TailwindCSS, Recharts                          |
| Data fetch  | TanStack Query                                 |
| Exchange    | Binance Futures WebSocket + REST API           |

---

## Prerequisites

- Node.js 20+
- Docker + Docker Compose
- npm or yarn

---

## Quick Start

### 1. Clone and install

```bash
# Install backend deps
cd backend
npm install

# Install frontend deps
cd ../frontend
npm install
```

### 2. Start PostgreSQL

```bash
cd ..   # project root
docker compose up -d
```

PostgreSQL will be available at `localhost:5432`.

### 3. Configure environment

Backend `.env` is pre-configured for local dev:
```env
DATABASE_URL="postgresql://trading:trading123@localhost:5432/trading_db"
PORT=3001
BINANCE_API_KEY=""       # optional — only needed for live trading
BINANCE_API_SECRET=""    # optional — only needed for live trading
PAPER_TRADING=true
INITIAL_BALANCE=10000
```

### 4. Run database migrations

```bash
cd backend
npx prisma migrate dev --name init
npx prisma db seed        # seeds default bot configuration
```

### 5. Start the backend

```bash
cd backend
npm run start:dev
```

Backend runs on **http://localhost:3001**

### 6. Start the frontend

```bash
cd frontend
npm run dev
```

Dashboard runs on **http://localhost:3000**

---

## Dashboard Pages

| Page          | URL                  | Description                              |
|---------------|----------------------|------------------------------------------|
| Dashboard     | `/`                  | Balance, equity, PnL, market prices      |
| Positions     | `/positions`         | Open/closed positions with close button  |
| Signals       | `/signals`           | Live signal scanner + historical signals |
| Trades        | `/trades`            | Trade history with period filter         |
| Analytics     | `/analytics`         | Equity curve, daily PnL, drawdown charts |
| Risk          | `/risk`              | Drawdown, cooldowns, risk events         |
| Config        | `/config`            | All bot parameters                       |
| Bot Control   | `/bot-control`       | Start/stop/pause/emergency stop          |
| System Health | `/system-health`     | Connection status, quick start guide     |

---

## API Endpoints

All endpoints are prefixed with `/api`.

### Bot Control
```
POST /api/bot/start          # Enable trading
POST /api/bot/stop           # Disable trading
POST /api/bot/pause          # Pause new entries (keep managing open)
POST /api/bot/resume         # Resume entries
POST /api/bot/close-all      # Close all open positions
POST /api/bot/emergency-stop # Close all + halt all trading
```

### Data
```
GET /api/dashboard           # Full dashboard snapshot
GET /api/positions           # All positions (?status=open for open only)
GET /api/positions/:id       # Single position
POST /api/positions/close    # { id } — manually close a position
GET /api/signals             # Historical signals (?live=true for live scan)
GET /api/trades              # Trade history (?period=today|week|month|all)
GET /api/analytics           # Equity, PnL, drawdown (?days=30)
GET /api/risk                # Risk stats, cooldowns, events
GET /api/config              # Current bot config
PUT /api/config              # Update bot config
GET /api/health              # System health check
GET /api/market/tickers      # All ticker prices
GET /api/market/candles/:symbol/:timeframe  # OHLCV data
```

---

## Trading Strategy

### Entry Conditions (LONG)
1. Momentum score ≥ threshold (weighted across 7 timeframes)
2. EMA20 > EMA50 > EMA200 (bullish alignment)
3. Volume ratio > 1.5× average (volume confirmation)
4. Price > highest high of previous 3 candles (breakout)
5. Cooldown not active
6. Risk checks pass (drawdown, position limits)

### Entry Conditions (SHORT)
Mirror of LONG with bearish conditions.

### Position Management
```
Entry → OPEN_LONG/OPEN_SHORT
  ↓ price moves activationPct% in profit
LONG_TRAILING / SHORT_TRAILING  ← trailing stop activated
  ↓ price hits trailingStop OR hardStop
CLOSED
```

### Momentum Score Formula
```
score = 0.05 × 30s_change
      + 0.10 × 1m_change
      + 0.15 × 2m_change
      + 0.20 × 5m_change
      + 0.20 × 10m_change
      + 0.15 × 15m_change
      + 0.15 × 30m_change
```

---

## Default Configuration

| Parameter              | Default | Description                        |
|------------------------|---------|------------------------------------|
| Max Active Symbols     | 5       | Max simultaneous open positions    |
| Max Entries Per Symbol | 3       | Max pyramid entries                |
| Capital Per Entry      | $1,000  | USDT per trade                     |
| Initial Balance        | $10,000 | Paper trading starting balance     |
| Leverage               | 5×      | Futures leverage                   |
| Activation %           | 2%      | Profit to activate trailing        |
| Trailing %             | 3%      | Trail distance from peak           |
| Hard Stop %            | 5%      | Maximum loss per trade             |
| Momentum Threshold     | 0.3     | Min score for signal               |
| Max Daily Drawdown     | 5%      | Halt trading if exceeded           |
| Cooldown Trigger       | 3 entries / 10 min → 5 min pause |              |

---

## Enabling Live Trading

> ⚠ **Warning**: Live trading places real orders on Binance with real money.

1. Add your Binance Futures API keys to `backend/.env`:
   ```env
   BINANCE_API_KEY=your_api_key
   BINANCE_API_SECRET=your_api_secret
   ```
2. Set `PAPER_TRADING=false` in `.env`
3. Update the config via the Config page or `PUT /api/config`
4. Start the bot via the Bot Control page

---

## Project Structure

```
trading-platform/
├── docker-compose.yml          # PostgreSQL only
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # All DB models
│   │   └── seed.ts             # Default config seed
│   └── src/
│       ├── prisma/             # PrismaService (global)
│       ├── market-data/        # Binance WS + REST, candle cache
│       ├── indicators/         # EMA, momentum, volume, breakout
│       ├── signal-engine/      # Signal generation + persistence
│       ├── position-engine/    # Position state machine + updates
│       ├── risk-engine/        # Risk checks, cooldowns, emergency stop
│       ├── analytics/          # Equity curve, stats, drawdown
│       ├── config/             # Bot configuration (DB-backed)
│       └── app.controller.ts   # All REST routes
└── frontend/
    └── app/
        ├── page.tsx            # Dashboard
        ├── positions/          # Positions table
        ├── signals/            # Signal scanner
        ├── trades/             # Trade history
        ├── analytics/          # Charts
        ├── risk/               # Risk monitor
        ├── config/             # Configuration form
        ├── bot-control/        # Bot controls
        └── system-health/      # Health status
```

---

## Development Notes

- The Prisma client is generated at `npx prisma generate` — must be run after installing deps locally
- WebSocket reconnects automatically on disconnect with exponential backoff
- Historical candles (200 × 1m) are loaded from Binance REST API on startup
- All timeframes (30s–30m) are aggregated in-memory from 1m candles
- Paper trading fees: 0.04% per side (Binance taker rate)
- BigInt IDs from Prisma are serialized as strings in API responses
