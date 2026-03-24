'use strict';

const fs = require('fs');
const path = require('path');
const Exchange = require('./exchange');

const STATE_FILE = path.join(__dirname, '..', 'grid-state.json');

class GridBot {
  constructor(config) {
    this.config = config;
    this.exchange = new Exchange(config.apiKey, config.apiSecret);
    this.running = false;
    this.gridLevels = [];    // Array of price levels
    this.gridOrders = {};    // { priceLevel: { orderId, side, price, quantity, status } }
    this.stats = {
      totalBuys: 0,
      totalSells: 0,
      realizedProfit: 0,
      startTime: null,
    };
    this.symbolInfo = null;
    this.pricePrecision = 2;
    this.quantityPrecision = 6;
    this.minQuantity = 0;
    this.minNotional = 0;
  }

  /**
   * Initialize exchange info and determine precision
   */
  initSymbolInfo() {
    console.log(`Fetching exchange info for ${this.config.symbol}...`);
    this.symbolInfo = this.exchange.getSymbolInfo(this.config.symbol);

    // Extract precision from symbol info
    if (this.symbolInfo.quotePrecision) {
      this.pricePrecision = this.symbolInfo.quotePrecision;
    }
    if (this.symbolInfo.baseAssetPrecision) {
      this.quantityPrecision = this.symbolInfo.baseAssetPrecision;
    }

    // Parse filters for min qty, step size, min notional
    if (this.symbolInfo.filters) {
      for (const filter of this.symbolInfo.filters) {
        if (filter.filterType === 'LOT_SIZE') {
          this.minQuantity = parseFloat(filter.minQty || '0');
          const stepSize = filter.stepSize || '0';
          // Derive quantity precision from step size
          const stepStr = String(stepSize);
          if (stepStr.includes('.')) {
            this.quantityPrecision = stepStr.split('.')[1].replace(/0+$/, '').length;
          }
        }
        if (filter.filterType === 'PRICE_FILTER') {
          const tickSize = filter.tickSize || '0';
          const tickStr = String(tickSize);
          if (tickStr.includes('.')) {
            this.pricePrecision = tickStr.split('.')[1].replace(/0+$/, '').length;
          }
        }
        if (filter.filterType === 'MIN_NOTIONAL') {
          this.minNotional = parseFloat(filter.minNotional || '0');
        }
      }
    }

    console.log(`  Price precision:    ${this.pricePrecision} decimals`);
    console.log(`  Quantity precision: ${this.quantityPrecision} decimals`);
    console.log(`  Min quantity:       ${this.minQuantity}`);
    console.log(`  Min notional:       ${this.minNotional}`);
  }

  /**
   * Calculate grid price levels (evenly spaced)
   */
  calculateGrid() {
    const { gridUpper, gridLower, gridLines } = this.config;
    const step = (gridUpper - gridLower) / gridLines;
    this.gridStep = step;

    this.gridLevels = [];
    for (let i = 0; i <= gridLines; i++) {
      const price = this.roundPrice(gridLower + i * step);
      this.gridLevels.push(price);
    }

    console.log(`\nGrid levels (${this.gridLevels.length} levels, step: ${this.roundPrice(step)}):`);
    for (const level of this.gridLevels) {
      console.log(`  ${level}`);
    }
  }

  /**
   * Calculate quantity per grid order based on total investment
   */
  calculateQuantityPerGrid(currentPrice) {
    // Distribute investment equally across the buy side grid levels
    const buyLevels = this.gridLevels.filter(l => l < currentPrice).length;
    const sellLevels = this.gridLevels.filter(l => l > currentPrice).length;

    // Each buy order gets an equal share of the investment
    // For sell orders, we assume we already hold the base asset or will acquire it
    if (buyLevels === 0 && sellLevels === 0) {
      throw new Error('Current price is outside the grid range!');
    }

    // Investment per grid level (in quote currency)
    const investmentPerLevel = this.config.investment / Math.max(buyLevels, 1);
    // Quantity at the average buy price
    const avgBuyPrice = this.gridLevels
      .filter(l => l < currentPrice)
      .reduce((sum, l) => sum + l, 0) / Math.max(buyLevels, 1) || currentPrice;

    const quantityPerGrid = this.roundQuantity(investmentPerLevel / avgBuyPrice);

    console.log(`\nOrder sizing:`);
    console.log(`  Buy levels:     ${buyLevels}`);
    console.log(`  Sell levels:    ${sellLevels}`);
    console.log(`  Per-level qty:  ${quantityPerGrid}`);
    console.log(`  Per-level cost: ~${this.roundPrice(quantityPerGrid * currentPrice)} quote`);

    // Validate min notional
    const minOrderValue = quantityPerGrid * this.gridLevels[0];
    if (this.minNotional > 0 && minOrderValue < this.minNotional) {
      throw new Error(
        `Order value ${minOrderValue.toFixed(2)} is below minimum notional ${this.minNotional}. ` +
        `Increase INVESTMENT or decrease GRID_LINES.`
      );
    }

    return quantityPerGrid;
  }

  /**
   * Place initial grid orders around the current price
   */
  placeInitialOrders(currentPrice, quantityPerGrid) {
    console.log(`\nPlacing initial grid orders (current price: ${currentPrice})...\n`);

    for (const level of this.gridLevels) {
      if (Math.abs(level - currentPrice) / currentPrice < 0.001) {
        // Skip levels too close to current price
        console.log(`  SKIP  ${level} (too close to current price)`);
        continue;
      }

      const side = level < currentPrice ? 'BUY' : 'SELL';
      this.placeGridOrder(level, side, quantityPerGrid);
    }
  }

  /**
   * Place a single grid order
   */
  placeGridOrder(priceLevel, side, quantity) {
    const price = this.roundPrice(priceLevel);
    const qty = this.roundQuantity(quantity);

    try {
      if (this.config.dryRun) {
        // In dry run mode, simulate the order
        const fakeId = `DRY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.gridOrders[price] = {
          orderId: fakeId,
          side,
          price,
          quantity: qty,
          status: 'NEW',
          placedAt: new Date().toISOString(),
        };
        console.log(`  ${side === 'BUY' ? '🟢' : '🔴'} [DRY] ${side} ${qty} @ ${price}`);
      } else {
        const result = this.exchange.placeLimitOrder(this.config.symbol, side, qty, price);
        this.gridOrders[price] = {
          orderId: result.orderId,
          side,
          price,
          quantity: qty,
          status: result.status || 'NEW',
          placedAt: new Date().toISOString(),
        };
        console.log(`  ${side === 'BUY' ? '🟢' : '🔴'} ${side} ${qty} @ ${price} (order: ${result.orderId})`);
      }
    } catch (err) {
      console.error(`  ⚠️  Failed to place ${side} @ ${price}: ${err.message}`);
    }
  }

  /**
   * Check all grid orders and handle fills
   */
  checkOrders(quantityPerGrid) {
    const currentPrice = this.exchange.getPrice(this.config.symbol);
    let fills = 0;

    for (const [priceStr, order] of Object.entries(this.gridOrders)) {
      if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') continue;

      const price = parseFloat(priceStr);

      if (this.config.dryRun) {
        // Simulate fills: a buy fills if price dropped below, sell fills if price rose above
        const filled =
          (order.side === 'BUY' && currentPrice <= price) ||
          (order.side === 'SELL' && currentPrice >= price);

        if (filled) {
          order.status = 'FILLED';
          fills++;
          this.handleFill(order, quantityPerGrid, currentPrice);
        }
      } else {
        // Query real order status
        try {
          const status = this.exchange.queryOrder(this.config.symbol, order.orderId);
          if (status.status === 'FILLED') {
            order.status = 'FILLED';
            fills++;
            this.handleFill(order, quantityPerGrid, currentPrice);
          } else if (status.status === 'CANCELED' || status.status === 'REJECTED') {
            order.status = status.status;
            console.log(`  Order at ${price} was ${status.status}`);
          }
        } catch (err) {
          console.error(`  Error checking order at ${price}: ${err.message}`);
        }
      }
    }

    return { currentPrice, fills };
  }

  /**
   * Handle a filled order by placing the opposite order one grid level away
   */
  handleFill(filledOrder, quantityPerGrid, currentPrice) {
    const gridStep = this.gridStep;
    const filledPrice = parseFloat(filledOrder.price);

    if (filledOrder.side === 'BUY') {
      // Buy filled -> place sell one grid level above
      this.stats.totalBuys++;
      const sellPrice = this.roundPrice(filledPrice + gridStep);
      const profit = gridStep * quantityPerGrid;

      console.log(`  ✅ BUY filled @ ${filledPrice} -> placing SELL @ ${sellPrice} (potential profit: ${this.roundPrice(profit)})`);

      // Remove the old order entry, place new sell
      delete this.gridOrders[filledOrder.price];
      this.placeGridOrder(sellPrice, 'SELL', quantityPerGrid);
    } else {
      // Sell filled -> place buy one grid level below
      this.stats.totalSells++;
      const buyPrice = this.roundPrice(filledPrice - gridStep);
      const profit = gridStep * quantityPerGrid;
      this.stats.realizedProfit += profit;

      console.log(`  ✅ SELL filled @ ${filledPrice} -> placing BUY @ ${buyPrice} (profit: +${this.roundPrice(profit)})`);

      // Remove the old order entry, place new buy
      delete this.gridOrders[filledOrder.price];
      this.placeGridOrder(buyPrice, 'BUY', quantityPerGrid);
    }
  }

  /**
   * Print current status
   */
  printStatus(currentPrice) {
    const activeOrders = Object.values(this.gridOrders).filter(
      o => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED'
    );
    const buys = activeOrders.filter(o => o.side === 'BUY').length;
    const sells = activeOrders.filter(o => o.side === 'SELL').length;
    const elapsed = this.stats.startTime
      ? Math.floor((Date.now() - this.stats.startTime) / 1000 / 60)
      : 0;

    console.log(
      `[${new Date().toLocaleTimeString()}] ` +
      `Price: ${currentPrice} | ` +
      `Orders: ${buys}B/${sells}S | ` +
      `Fills: ${this.stats.totalBuys}B/${this.stats.totalSells}S | ` +
      `Profit: ${this.roundPrice(this.stats.realizedProfit)} | ` +
      `Uptime: ${elapsed}m`
    );
  }

  /**
   * Save state to disk for crash recovery
   */
  saveState() {
    const state = {
      gridOrders: this.gridOrders,
      stats: this.stats,
      gridLevels: this.gridLevels,
      gridStep: this.gridStep,
      config: {
        symbol: this.config.symbol,
        gridUpper: this.config.gridUpper,
        gridLower: this.config.gridLower,
        gridLines: this.config.gridLines,
        investment: this.config.investment,
      },
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  /**
   * Load state from disk
   */
  loadState() {
    if (!fs.existsSync(STATE_FILE)) return false;

    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const state = JSON.parse(raw);

      // Verify config matches
      if (
        state.config.symbol !== this.config.symbol ||
        state.config.gridUpper !== this.config.gridUpper ||
        state.config.gridLower !== this.config.gridLower ||
        state.config.gridLines !== this.config.gridLines
      ) {
        console.log('Saved state config mismatch, starting fresh.');
        return false;
      }

      this.gridOrders = state.gridOrders || {};
      this.stats = state.stats || this.stats;
      this.gridLevels = state.gridLevels || [];
      this.gridStep = state.gridStep || 0;

      console.log(`Restored state from ${state.savedAt}`);
      console.log(`  Active orders: ${Object.keys(this.gridOrders).length}`);
      console.log(`  Stats: ${this.stats.totalBuys}B/${this.stats.totalSells}S, profit: ${this.stats.realizedProfit}`);
      return true;
    } catch (err) {
      console.error('Failed to load state:', err.message);
      return false;
    }
  }

  /**
   * Main bot loop
   */
  async start() {
    this.running = true;
    this.stats.startTime = Date.now();

    // 1. Initialize exchange info
    this.initSymbolInfo();

    // 2. Get current price
    const currentPrice = this.exchange.getPrice(this.config.symbol);
    console.log(`\nCurrent ${this.config.symbol} price: ${currentPrice}`);

    // Validate price is within grid range
    if (currentPrice < this.config.gridLower || currentPrice > this.config.gridUpper) {
      console.error(
        `\n⚠️  Current price ${currentPrice} is outside grid range ` +
        `[${this.config.gridLower} - ${this.config.gridUpper}]`
      );
      console.error('Adjust GRID_LOWER and GRID_UPPER in your .env to bracket the current price.');
      return;
    }

    // 3. Calculate grid
    this.calculateGrid();

    // 4. Try to restore previous state
    const restored = this.loadState();

    if (!restored) {
      // 5. Calculate order quantity and place initial orders
      const quantityPerGrid = this.calculateQuantityPerGrid(currentPrice);
      this.placeInitialOrders(currentPrice, quantityPerGrid);
    }

    // Determine quantity per grid for ongoing operations
    const quantityPerGrid = this.calculateQuantityPerGrid(currentPrice);

    this.saveState();

    console.log('\n--- Bot is running. Press Ctrl+C to stop ---\n');

    // 6. Main polling loop
    while (this.running) {
      try {
        const { currentPrice: price, fills } = this.checkOrders(quantityPerGrid);
        this.printStatus(price);

        if (fills > 0) {
          this.saveState();
        }
      } catch (err) {
        console.error(`Error in main loop: ${err.message}`);
      }

      // Wait for next poll
      await this.sleep(this.config.pollInterval);
    }
  }

  /**
   * Stop the bot gracefully
   */
  async stop() {
    this.running = false;

    console.log('\nSaving state...');
    this.saveState();

    if (!this.config.dryRun) {
      console.log('Cancelling all open orders...');
      try {
        this.exchange.cancelAllOrders(this.config.symbol);
        console.log('All orders cancelled.');
      } catch (err) {
        console.error('Error cancelling orders:', err.message);
      }
    }

    // Print final stats
    console.log('\n--- Final Stats ---');
    console.log(`  Total buys:      ${this.stats.totalBuys}`);
    console.log(`  Total sells:     ${this.stats.totalSells}`);
    console.log(`  Realized profit: ${this.roundPrice(this.stats.realizedProfit)} (quote currency)`);
    const elapsed = Math.floor((Date.now() - this.stats.startTime) / 1000 / 60);
    console.log(`  Runtime:         ${elapsed} minutes`);
  }

  // --- Utility methods ---

  roundPrice(value) {
    const factor = Math.pow(10, this.pricePrecision);
    return Math.round(value * factor) / factor;
  }

  roundQuantity(value) {
    const factor = Math.pow(10, this.quantityPrecision);
    return Math.round(value * factor) / factor;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = GridBot;
