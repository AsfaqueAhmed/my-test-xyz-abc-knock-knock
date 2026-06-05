# Server Setup Guide

## Requirements

Make sure your VPS has the following installed:

- Docker
- Docker Compose
- Git

---

## First-Time Setup

### 1. SSH into your VPS

```bash
ssh user@your-vps-ip
```

### 2. Clone the repository

```bash
git clone https://github.com/AsfaqueAhmed/my-test-xyz-abc-knock-knock.git
cd my-test-xyz-abc-knock-knock
```

### 3. Create your `.env` file

```bash
cp .env.example .env
nano .env
```

Fill in your real values:

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-strong-password
POSTGRES_DB=trading

BINANCE_API_KEY=your-binance-api-key
BINANCE_API_SECRET=your-binance-api-secret

PAPER_TRADING=false
INITIAL_BALANCE=10000

SITE_URL=http://your-vps-ip
```

### 4. Start the application

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 5. Verify it's running

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

The frontend will be available at `http://your-vps-ip:3000`
The backend API will be available at `http://your-vps-ip:3001`

---

## Deploying Updates

Whenever you push new code from your local machine:

**On your Mac:**

```bash
git add .
git commit -m "your commit message"
git push
```

**On your VPS:**

```bash
ssh user@your-vps-ip
cd my-test-xyz-abc-knock-knock
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Deploying a Single Service (Without Rebuilding Everything)

When you only change the backend or only the frontend, there is no need to rebuild and restart the entire stack. Target the service by name.

### Backend only

```bash
# On your Mac — push the change
git add .
git commit -m "feat(backend): ..."
git push

# On your VPS
cd my-test-xyz-abc-knock-knock
git pull
docker compose -f docker-compose.prod.yml up -d --build --no-deps backend
```

`--no-deps` prevents Docker from also recreating `postgres` and `frontend`.

### Frontend only

```bash
# On your VPS
git pull
docker compose -f docker-compose.prod.yml up -d --build --no-deps frontend
```

### Restart a service without rebuilding (config / env change only)

```bash
docker compose -f docker-compose.prod.yml restart backend
# or
docker compose -f docker-compose.prod.yml restart frontend
```

---

## Database Migrations

Migrations run automatically when the backend container starts (the `CMD` in the Dockerfile calls `prisma migrate deploy` before `node dist/src/main`). For manual control use the commands below.

### Run pending migrations now (without restarting the app)

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

### Check migration status

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate status
```

### Apply a new migration after a schema change

1. **Locally** — generate the migration file and commit it:

```bash
# In your local backend directory
npx prisma migrate dev --name describe_your_change
git add prisma/migrations
git commit -m "chore(db): add migration describe_your_change"
git push
```

2. **On the VPS** — pull and apply:

```bash
cd my-test-xyz-abc-knock-knock
git pull
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

3. If the schema change also requires a backend rebuild, combine both steps:

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build --no-deps backend
# migrations run automatically on container start
```

### Reset the database (⚠️ destroys all data — dev/staging only)

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate reset --force
```

---

## Useful Commands

| Command | Description |
|---|---|
| `docker compose -f docker-compose.prod.yml ps` | Check running containers |
| `docker compose -f docker-compose.prod.yml logs -f backend` | Follow backend logs |
| `docker compose -f docker-compose.prod.yml logs -f frontend` | Follow frontend logs |
| `docker compose -f docker-compose.prod.yml down` | Stop all containers |
| `docker compose -f docker-compose.prod.yml restart backend` | Restart backend only |

---

## Firewall

Make sure these ports are open on your VPS:

```bash
ufw allow 22    # SSH
ufw allow 3000  # Frontend
ufw allow 3001  # Backend API
ufw enable
```
