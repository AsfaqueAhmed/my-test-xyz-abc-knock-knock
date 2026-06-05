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
| Frontend    | Next.js 16, TypeScript                         |
| UI          | TailwindCSS 4, Recharts                        |
| Data fetch  | TanStack Query                                 |
| Exchange    | Binance Futures WebSocket + REST API           |
| Container   | Docker + Docker Compose                        |

---

## Prerequisites

- Docker + Docker Compose (required)
- Node.js 20+ (only needed for local non-Docker development)

---

## Quick Start — Docker (recommended)

The entire stack (PostgreSQL + backend + frontend) runs in Docker with a single command.

### 1. Clone the repo

```bash
git clone <repo-url>
cd trading-platform
```

### 2. Create your environment file

```bash
cp .env.example .env
```

The defaults work out of the box for paper trading. To use live trading, add your Binance API keys (see [Enabling Live Trading](#enabling-live-trading)).

### 3. Start everything

```bash
docker compose up --build
```

| Service   | URL                              |
|-----------|----------------------------------|
| Dashboard | http://localhost:3000            |
| API       | http://localhost:3001/api        |
| Swagger   | http://localhost:3001/api/docs   |
| Postgres  | localhost:5432                   |

On first run Docker will:
- Pull the PostgreSQL 16 image
- Install all Node.js dependencies inside the containers
- Run `prisma generate` + `prisma migrate deploy` automatically
- Start the backend with hot-reload (`nest start --watch`)
- Start the frontend with hot-reload (`next dev`)

### 4. Stopping

```bash
docker compose down          # stop containers, keep data
docker compose down -v       # stop containers AND delete all volumes (wipe DB)
```

---

## Quick Start — Local (no Docker for app)

If you prefer to run the app processes locally and only use Docker for PostgreSQL:

### 1. Start PostgreSQL only

```bash
docker compose up postgres -d
```

### 2. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 3. Configure backend environment

The `backend/.env` is pre-configured for local dev:

```env
DATABASE_URL="postgresql://trading:trading123@localhost:5432/trading_db"
PORT=3001
BINANCE_API_KEY=""
BINANCE_API_SECRET=""
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

### 6. Start the frontend

```bash
cd frontend
npm run dev
```

---

## Docker Details

### Container overview

| Container          | Image / Build           | Port  | Description                        |
|--------------------|-------------------------|-------|------------------------------------|
| `trading_postgres` | postgres:16-alpine      | 5432  | Database (named volume)            |
| `trading_backend`  | `backend/Dockerfile.dev`| 3001  | NestJS API with hot-reload         |
| `trading_frontend` | `frontend/Dockerfile.dev`| 3000 | Next.js dashboard with hot-reload  |

### Named volumes

| Volume                  | Mounted at               | Purpose                             |
|-------------------------|--------------------------|-------------------------------------|
| `postgres_data`         | `/var/lib/postgresql/data` | Persistent database storage       |
| `backend_node_modules`  | `/app/node_modules`      | Isolated backend deps               |
| `backend_dist`          | `/app/dist`              | NestJS compiled output              |
| `frontend_node_modules` | `/app/node_modules`      | Isolated frontend deps              |
| `frontend_next`         | `/app/.next`             | Next.js build cache                 |

Source files (`backend/src`, `frontend/app`, etc.) are bind-mounted from the host so edits are picked up instantly by the hot-reload watchers.

### Networking

The frontend's `/api/*` proxy rewrites point to `http://backend:3001` inside the Docker network, so browser requests hit the Next.js dev server at port 3000 and are transparently forwarded to the backend. Outside Docker (local dev), the default fallback `http://localhost:3001` is used.

### Development Dockerfile strategy

Both dev Dockerfiles follow the same pattern:
1. `COPY package*.json` + `RUN npm ci` — populates the named `node_modules` volume at image build time
2. Host source directory is bind-mounted on top — changes are live immediately
3. The named `node_modules` volume sits on top of the bind mount — host `node_modules` never interferes

```
Host bind mount:  ./backend  →  /app          (source files)
Named volume:     backend_nm →  /app/node_modules  (overrides node_modules)
```

### Rebuilding after dependency changes

If you add/remove npm packages, rebuild the affected image so the named volume is refreshed:

```bash
docker compose up --build backend     # rebuild backend only
docker compose up --build frontend    # rebuild frontend only
docker compose up --build             # rebuild everything
```

### Useful Docker commands

```bash
# Follow logs
docker compose logs -f backend
docker compose logs -f frontend

# Open a shell in a container
docker compose exec backend sh
docker compose exec frontend sh

# Access the database
docker compose exec postgres psql -U trading -d trading_db

# Run Prisma commands inside the backend container
docker compose exec backend npx prisma studio
docker compose exec backend npx prisma migrate dev --name <name>

# Reset database (caution: destroys all data)
docker compose exec backend npx prisma migrate reset --force
```

---

## Production Deployment

### Build and run

```bash
cp .env.example .env   # fill in real secrets
docker compose -f docker-compose.prod.yml up -d --build
```

### Production vs dev differences

| Concern         | Dev (`docker-compose.yml`)       | Prod (`docker-compose.prod.yml`)         |
|-----------------|----------------------------------|------------------------------------------|
| Build           | `Dockerfile.dev`                 | `Dockerfile` (multi-stage)               |
| Source mount    | Bind-mount for hot-reload        | No bind mounts — baked into image        |
| Backend CMD     | `nest start --watch`             | `node dist/main`                         |
| Frontend CMD    | `next dev`                       | `node server.js` (standalone output)     |
| Credentials     | Hard-coded defaults in compose   | All from `.env` (no defaults)            |
| Backend health  | Postgres health check only       | Postgres + backend `/api/health` checks  |
| Node env        | `development`                    | `production`                             |

### Production Dockerfile strategy

**Backend** — 3-stage build:
1. `deps` — `npm ci --only=production`
2. `builder` — full install + `prisma generate` + `nest build`
3. `runner` — prod node_modules + generated Prisma client + compiled `dist/`

**Frontend** — 2-stage build with Next.js `output: 'standalone'`:
1. `builder` — full install + `next build`
2. `runner` — minimal image running `node server.js` from standalone output

---

## Enabling Live Trading

> **Warning**: Live trading places real orders on Binance Futures with real money.

1. Add your Binance Futures API keys to `.env` (or `backend/.env` for local dev):
   ```env
   BINANCE_API_KEY=your_api_key
   BINANCE_API_SECRET=your_api_secret
   PAPER_TRADING=false
   ```
2. Restart the backend: `docker compose restart backend` (or `npm run start:dev`)
3. Adjust risk parameters via the Config page or `PUT /api/config`
4. Start the bot via the Bot Control page or `POST /api/bot/start`

---

## Dashboard Pages

| Page          | URL               | Description                              |
|---------------|-------------------|------------------------------------------|
| Dashboard     | `/`               | Balance, equity, PnL, market prices      |
| Positions     | `/positions`      | Open/closed positions with close button  |
| Signals       | `/signals`        | Live signal scanner + historical signals |
| Trades        | `/trades`         | Trade history with period filter         |
| Analytics     | `/analytics`      | Equity curve, daily PnL, drawdown charts |
| Risk          | `/risk`           | Drawdown, cooldowns, risk events         |
| Config        | `/config`         | All bot parameters                       |
| Bot Control   | `/bot-control`    | Start/stop/pause/emergency stop          |
| System Health | `/system-health`  | Connection status, quick start guide     |

---

## API Endpoints

All endpoints are prefixed with `/api`. Full interactive docs at **http://localhost:3001/api/docs** (Swagger).

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
GET  /api/dashboard                          # Full dashboard snapshot
GET  /api/positions                          # All positions (?status=open)
GET  /api/positions/:id                      # Single position
POST /api/positions/close                    # { id } — manually close
GET  /api/signals                            # Historical signals (?live=true)
GET  /api/trades                             # Trade history (?period=today|week|month|all)
GET  /api/analytics                          # Equity, PnL, drawdown (?days=30)
GET  /api/risk                               # Risk stats, cooldowns, events
GET  /api/config                             # Current bot config
PUT  /api/config                             # Update bot config
GET  /api/health                             # System health check
GET  /api/market/tickers                     # All ticker prices
GET  /api/market/candles/:symbol/:timeframe  # OHLCV data
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
Entry → OPEN_LONG / OPEN_SHORT
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

| Parameter              | Default | Description                                      |
|------------------------|---------|--------------------------------------------------|
| Max Active Symbols     | 5       | Max simultaneous open positions                  |
| Max Entries Per Symbol | 3       | Max pyramid entries                              |
| Capital Per Entry      | $1,000  | USDT per trade                                   |
| Initial Balance        | $10,000 | Paper trading starting balance                   |
| Leverage               | 5×      | Futures leverage                                 |
| Activation %           | 2%      | Profit required to activate trailing stop        |
| Trailing %             | 3%      | Trail distance from peak/trough                  |
| Hard Stop %            | 5%      | Maximum loss per trade                           |
| Momentum Threshold     | 0.3     | Minimum score to generate a signal               |
| Max Daily Drawdown     | 5%      | Halt trading if daily loss exceeds this          |
| Cooldown Trigger       | 3 entries / 10 min → 5 min pause                |

---

## Project Structure

```
trading-platform/
├── .env.example                    # Template — copy to .env and fill secrets
├── .dockerignore                   # Root-level Docker build exclusions
├── docker-compose.yml              # Dev stack: postgres + backend + frontend
├── docker-compose.prod.yml         # Production stack (multi-stage builds)
│
├── backend/
│   ├── .dockerignore
│   ├── Dockerfile.dev              # Dev image: npm ci → hot-reload via bind mount
│   ├── Dockerfile                  # Prod image: 3-stage (deps → builder → runner)
│   ├── prisma/
│   │   ├── schema.prisma           # All DB models
│   │   └── seed.ts                 # Default config seed
│   └── src/
│       ├── prisma/                 # PrismaService (global)
│       ├── market-data/            # Binance WS + REST, candle cache
│       ├── indicators/             # EMA, momentum, volume, breakout
│       ├── signal-engine/          # Signal generation + persistence
│       ├── position-engine/        # Position state machine + updates
│       ├── risk-engine/            # Risk checks, cooldowns, emergency stop
│       ├── analytics/              # Equity curve, stats, drawdown
│       ├── config/                 # Bot configuration (DB-backed)
│       └── app.controller.ts       # All REST routes
│
└── frontend/
    ├── .dockerignore
    ├── Dockerfile.dev              # Dev image: npm ci → hot-reload via bind mount
    ├── Dockerfile                  # Prod image: 2-stage standalone build
    ├── next.config.ts              # /api/* proxy → BACKEND_URL env var
    └── app/
        ├── page.tsx                # Dashboard
        ├── positions/              # Positions table
        ├── signals/                # Signal scanner
        ├── trades/                 # Trade history
        ├── analytics/              # Charts
        ├── risk/                   # Risk monitor
        ├── config/                 # Configuration form
        ├── bot-control/            # Bot controls
        └── system-health/          # Health status
```

---

## Development Notes

- Prisma migrations run automatically on container start (`prisma migrate deploy`)
- The Prisma client is regenerated on every dev container start (`prisma generate`)
- WebSocket reconnects automatically on disconnect with exponential backoff
- Historical candles (200 × 1m) are loaded from Binance REST API on startup
- All timeframes (30s–30m) are aggregated in-memory from 1m candles
- Paper trading fees: 0.04% per side (Binance taker rate)
- BigInt IDs from Prisma are serialized as strings in API responses
- `BACKEND_URL` env var controls where the Next.js `/api/*` proxy points — defaults to `http://localhost:3001` outside Docker, set to `http://backend:3001` inside Docker compose
