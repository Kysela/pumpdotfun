# Pump.fun Signal Detection + Paper Trading System

A deterministic, rule-based signal detection system for pump.fun tokens on Solana. This system detects **attention acceleration** and **liquidity shape** before mass participation — NOT price prediction.

> **⚠️ PAPER TRADING ONLY** — This system uses virtual funds only. No real transactions are made.

## Core Principle

> This system does NOT predict price. It detects ATTENTION ACCELERATION and LIQUIDITY SHAPE before mass participation. Price is a lagging indicator. Signals come from behavior, not charts.

## Features

- **Real-time WebSocket streaming** from Solana mainnet
- **Token lifecycle tracking** (first 20 minutes only)
- **Rolling window metrics** (30s, 60s, 180s, 5min)
- **Hard filters** to drop suspicious tokens
- **Signal conditions**: EAS, LSF, MC (all must pass)
- **Deterministic scoring model**
- **Paper trading with entry/exit rules**
- **Kill switch** for emergency exits
- **JSONL logging** for analysis
- **Performance metrics** tracking
- **Railway-ready** deployment configuration

---

## Quick Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

### One-Click Deployment

1. Click the "Deploy on Railway" button above
2. Connect your GitHub account
3. Add environment variables (see below)
4. Deploy!

### Manual Deployment from GitHub

1. **Create a new project on Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your forked/cloned repository

2. **Add Environment Variables**
   
   In Railway dashboard → Variables:
   
   | Variable | Required | Description |
   |----------|----------|-------------|
   | `SOLANA_RPC_HTTP` | Yes | Solana HTTP RPC endpoint |
   | `SOLANA_RPC_WS` | Yes | Solana WebSocket RPC endpoint |
   | `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |

3. **Deploy**
   
   Railway will automatically:
   - Detect the Node.js project
   - Run `npm install` and `npm run build`
   - Start the application
   - Set up health checks at `/health`

### Recommended RPC Providers

The public Solana RPC is rate-limited. For production, use a dedicated provider:

| Provider | Free Tier | Link |
|----------|-----------|------|
| Helius | Yes (100k req/day) | [helius.xyz](https://helius.xyz/) |
| QuickNode | Yes (limited) | [quicknode.com](https://www.quicknode.com/) |
| Triton | No | [triton.one](https://triton.one/) |

Example with Helius:
```
SOLANA_RPC_HTTP=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_RPC_WS=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

---

## Endpoints

Once deployed, the following endpoints are available:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (Railway uses this) |
| `GET /status` | Detailed system status with metrics |
| `GET /metrics` | Prometheus-compatible metrics |

---

## Local Development

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd pumpdotfun

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your RPC endpoints
```

### Running Locally

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start

# Run simulation (test with synthetic data)
npm run simulate

# Analyze trade logs
npm run analyze
```

---

## Signal Conditions

### A) Early Attention Signal (EAS)
- `buyers_5m >= 6`
- `tx_interval_mean < 20s`
- `tx_acceleration > 0`

### B) Liquidity Shape Filter (LSF)
- `avg_buy_size` between 0.05–0.5 SOL
- `buy_size_std` LOW
- `largest_buy <= 2 SOL`

### C) Momentum Confirmation (MC)
- `tx_count_60s >= 5`
- `tx_interval_delta == TRUE`

All three conditions must pass for signal generation.

## Hard Filters (DROP Token)

Tokens are immediately dropped if:
- `largest_buy > 2 SOL`
- `avg_buy_size > 0.8 SOL`
- `avg_buy_size < 0.03 SOL`
- High `buy_size_std` (whale noise)
- Dev wallet buys more than once
- Metadata edited more than once

## Scoring Model

```
score = buyers_5m * 2
      + tx_acceleration * 3
      + repeat_buyers * 2
      - (largest_buy > 1 SOL ? 5 : 0)
      - (tx_count_60s == 0 ? 10 : 0)
```

Entry requires `score >= 18`.

## Exit Rules (NON-NEGOTIABLE)

### Partial Exit
- `+120% profit` → Sell 50%

### Full Exit (any of these)
- `+220% profit`
- No tx for 60 seconds
- `tx_count_60s` decreases twice consecutively
- Token hits first stagnation after spike

### Kill Switch (immediate exit)
- Zero tx for 60 seconds
- Sudden large buy > 3 SOL
- Dev wallet interacts again

**No overrides. No discretion. No re-entry.**

---

## Project Structure

```
├── src/
│   ├── config/           # Configuration constants
│   ├── types/            # TypeScript interfaces
│   ├── utils/            # Utilities (logger, events, buffers)
│   ├── data/             # Solana WebSocket connection
│   ├── core/             # Signal detection engine
│   ├── trading/          # Paper trading (entry/exit/kill switch)
│   ├── logging/          # JSONL logging & metrics
│   ├── server/           # Health check HTTP server
│   ├── scripts/          # Utility scripts
│   └── index.ts          # Entry point
├── Dockerfile            # Docker configuration
├── railway.toml          # Railway configuration
├── nixpacks.toml         # Nixpacks configuration
└── Procfile              # Process definition
```

---

## Performance Metrics

Track these metrics to validate the system:
- **Win Rate** — Target: >= 35%
- **Average R Multiple** — Target: >= 2.5
- **Max Drawdown** — Target: < 20%

The system is considered **VALID** only when all three criteria are met after 100+ paper trades.

## Iteration Rules

Rules may ONLY be modified after:
1. Minimum 100 paper trades
2. Statistical review of exits vs signals
3. **One change per iteration** — no stacking tweaks

## Strict Prohibitions

- ❌ No ML models
- ❌ No sentiment analysis
- ❌ No Twitter/Telegram signals
- ❌ No manual overrides
- ❌ No revenge entries

---

## API Events

The system emits the following internal events:

| Event | Description |
|-------|-------------|
| `transaction` | New buy transaction detected |
| `token_new` | New token discovered |
| `token_dropped` | Token failed filters |
| `signal_detected` | Signal conditions met |
| `score_update` | Score recalculated |
| `position_opened` | Paper position opened |
| `position_partial_exit` | 50% position sold |
| `position_closed` | Position fully closed |
| `kill_switch_triggered` | Emergency exit triggered |

---

## License

MIT

---

**Remember:** Price is a lagging indicator. Signals come from behavior, not charts.
