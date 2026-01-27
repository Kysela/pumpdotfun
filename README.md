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

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd pumpdotfun

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

## Configuration

Edit `.env` file:

```env
# Solana RPC Configuration
# For better performance, use a dedicated RPC provider (Helius, QuickNode, etc.)
SOLANA_RPC_HTTP=https://api.mainnet-beta.solana.com
SOLANA_RPC_WS=wss://api.mainnet-beta.solana.com

# Logging
LOG_LEVEL=info
LOG_DIR=./logs
```

### Recommended RPC Providers

For production use, a dedicated RPC is strongly recommended:
- [Helius](https://helius.xyz/)
- [QuickNode](https://www.quicknode.com/)
- [Triton](https://triton.one/)

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
# Build
npm run build

# Run
npm start
```

### Watch Mode (for development)

```bash
npm run watch
```

## Project Structure

```
src/
├── config/
│   └── index.ts          # Configuration constants
├── types/
│   └── index.ts          # TypeScript interfaces
├── utils/
│   ├── ringBuffer.ts     # Rolling window buffers
│   ├── logger.ts         # Console/file logging
│   └── eventEmitter.ts   # Internal event bus
├── data/
│   └── websocket.ts      # Solana WebSocket connection
├── core/
│   ├── tokenTracker.ts   # Token lifecycle management
│   ├── filters.ts        # Hard filters
│   ├── signals.ts        # Signal conditions (EAS, LSF, MC)
│   ├── scoring.ts        # Scoring model
│   └── signalEngine.ts   # Main orchestration
├── trading/
│   ├── position.ts       # Paper position management
│   ├── entryEngine.ts    # Entry rules
│   ├── exitEngine.ts     # Exit engine
│   └── killSwitch.ts     # Kill switch logic
├── logging/
│   ├── tradeLogger.ts    # JSONL trade logging
│   └── metrics.ts        # Performance metrics
└── index.ts              # Entry point
```

## Logs

Trades are logged to JSONL files in the `logs/` directory:

```json
{"tokenAddress":"...","entryTime":1234567890,"entryScore":22,"entryPrice":0.15,"exitTime":1234567950,"exitReason":"profit_target_full","maxUnrealizedPnL":250,"realizedPnL":0.45}
```

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

## API Events

The system emits the following events:

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

## License

MIT

---

**Remember:** Price is a lagging indicator. Signals come from behavior, not charts.
