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
