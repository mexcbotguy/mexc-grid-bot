# MEXC Grid Trading Bot

A Node.js grid trading bot for the [MEXC](https://www.mexc.com/) exchange. It automatically places layered buy and sell orders across a price range and profits from market oscillation.

## How Grid Trading Works

Grid trading captures profit from sideways price movement by placing a series of limit orders at fixed intervals within a defined price range.

```
  $72,000  ┤ ── SELL ──────────  Grid Upper
            │
  $70,600  ┤ ── SELL
            │
  $69,200  ┤ ── SELL
            │
  $67,800  ┤ ── SELL
            │
  $66,400  ┤ ── SELL
            │                    ◄── Current Price ($65,500)
  $65,000  ┤ ── BUY
            │
  $63,600  ┤ ── BUY
            │
  $62,200  ┤ ── BUY
            │
  $60,800  ┤ ── BUY
            │
  $59,400  ┤ ── BUY
            │
  $58,000  ┤ ── BUY ───────────  Grid Lower
```

1. **Setup** — You define an upper price, lower price, and number of grid lines. The bot divides the range into evenly spaced levels.
2. **Initial orders** — Buy orders are placed at every level below the current price. Sell orders are placed at every level above.
3. **The cycle** — When a buy order fills (price dipped down), the bot immediately places a sell order one grid level higher. When that sell fills (price bounced back up), it places a buy order one grid level lower. Each completed buy-sell cycle captures the grid step as profit.
4. **Repeat** — As long as the price stays within the grid range, the bot keeps cycling orders and accumulating small profits on every bounce.

## Installation

```bash
git clone https://github.com/mexcbotguy/mexc-grid-bot.git
cd mexc-grid-bot
npm install
```

## Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `MEXC_API_KEY` | Your MEXC API key | *(required)* |
| `MEXC_API_SECRET` | Your MEXC API secret | *(required)* |
| `SYMBOL` | Trading pair | `BTCUSDT` |
| `GRID_UPPER` | Upper price boundary | `72000` |
| `GRID_LOWER` | Lower price boundary | `58000` |
| `GRID_LINES` | Number of grid levels | `10` |
| `INVESTMENT` | Total quote currency to allocate across buy orders | `1000` |
| `POLL_INTERVAL` | How often to check order status (ms) | `10000` |
| `DRY_RUN` | Simulate trades without placing real orders | `true` |

### Choosing Good Settings

- **Range**: Set `GRID_UPPER` and `GRID_LOWER` to bracket the current price. Look at recent support/resistance levels on a chart. If the price moves outside this range, the bot stops cycling and you hold the asset at a loss (price below range) or miss further upside (price above range).
- **Grid lines**: More lines = smaller profit per trade but more frequent trades. Fewer lines = larger profit per trade but less frequent. 10–20 is a reasonable starting point.
- **Investment**: This is how much quote currency (e.g., USDT) the bot distributes across the buy-side grid. Each buy order gets roughly `INVESTMENT / number_of_buy_levels` in value.

## Usage

### Dry Run (Recommended First Step)

Dry run mode simulates the full bot cycle without placing real orders. It uses live price data but fakes order fills when the price crosses a grid level.

```bash
npm run dry-run
```

### Live Trading

Once you're comfortable with the behavior, set `DRY_RUN=false` in your `.env` and start:

```bash
npm start
```

### Stopping

Press `Ctrl+C` to stop. The bot will:

1. Save its state to `grid-state.json`
2. Cancel all open orders on the exchange (live mode only)
3. Print a summary of all trades and profit

### Crash Recovery

The bot writes its state to `grid-state.json` after every fill. If it crashes or you restart it with the same configuration, it picks up where it left off instead of placing duplicate orders.

## Live Output

While running, the bot prints a status line on each poll cycle:

```
[2:34:15 PM] Price: 65432 | Orders: 5B/5S | Fills: 3B/2S | Profit: 42.80 | Uptime: 12m
```

| Field | Meaning |
|---|---|
| **Price** | Current market price |
| **Orders** | Active buy (B) and sell (S) orders on the book |
| **Fills** | Total buy and sell orders that have filled since start |
| **Profit** | Realized profit in quote currency (completed buy-sell cycles) |
| **Uptime** | Minutes since the bot started |

## Project Structure

```
mexc-grid-bot/
├── index.js            Entry point, startup banner, signal handling
├── src/
│   ├── config.js       Loads and validates .env configuration
│   ├── exchange.js     Thin wrapper around the MEXC SDK
│   └── grid-bot.js     Core grid logic: levels, orders, fill handling
├── .env.example        Configuration template
├── .gitignore
└── package.json
```

## Risks and Disclaimers

- **Not financial advice.** This bot is a tool, not a strategy guarantee. You can lose money.
- **Range risk.** If the price breaks out of your grid range, the bot stops cycling. You'll be left holding the base asset (price dropped below range) or fully in quote currency (price rose above range).
- **Exchange risk.** API outages, rate limits, or exchange maintenance can prevent the bot from placing or canceling orders.
- **No stop-loss.** This bot does not include a stop-loss mechanism. Consider monitoring it and shutting it down manually if the market moves sharply against you.
- **Test first.** Always start with `DRY_RUN=true` and small amounts before scaling up.

## License

ISC
