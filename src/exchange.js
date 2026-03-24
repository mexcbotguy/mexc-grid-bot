'use strict';

const Mexc = require('mexc-sdk');

/**
 * Wrapper around the MEXC SDK that handles errors and provides
 * a clean interface for the grid bot.
 */
class Exchange {
  constructor(apiKey, apiSecret) {
    this.client = new Mexc.Spot(apiKey, apiSecret);
  }

  /**
   * Get current price for a symbol
   */
  getPrice(symbol) {
    try {
      const result = this.client.tickerPrice(symbol);
      const data = JSON.parse(result);
      return parseFloat(data.price);
    } catch (err) {
      throw new Error(`Failed to get price for ${symbol}: ${err.message}`);
    }
  }

  /**
   * Get exchange info for a symbol (tick size, lot size, min notional, etc.)
   */
  getSymbolInfo(symbol) {
    try {
      const result = this.client.exchangeInfo({ symbol });
      const data = JSON.parse(result);
      const symbolInfo = data.symbols && data.symbols[0];
      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found on exchange`);
      }
      return symbolInfo;
    } catch (err) {
      if (err.message.includes('not found')) throw err;
      throw new Error(`Failed to get exchange info: ${err.message}`);
    }
  }

  /**
   * Get account balances
   */
  getBalances() {
    try {
      const result = this.client.accountInfo();
      const data = JSON.parse(result);
      const balances = {};
      if (data.balances) {
        for (const b of data.balances) {
          const free = parseFloat(b.free);
          const locked = parseFloat(b.locked);
          if (free > 0 || locked > 0) {
            balances[b.asset] = { free, locked };
          }
        }
      }
      return balances;
    } catch (err) {
      throw new Error(`Failed to get balances: ${err.message}`);
    }
  }

  /**
   * Place a limit order
   */
  placeLimitOrder(symbol, side, quantity, price) {
    try {
      const result = this.client.newOrder(symbol, side, 'LIMIT', {
        quantity: String(quantity),
        price: String(price),
        timeInForce: 'GTC',
        newOrderRespType: 'RESULT',
      });
      return JSON.parse(result);
    } catch (err) {
      throw new Error(`Failed to place ${side} order at ${price}: ${err.message}`);
    }
  }

  /**
   * Place a test order (validates but doesn't execute)
   */
  placeTestOrder(symbol, side, quantity, price) {
    try {
      const result = this.client.newOrderTest(symbol, side, 'LIMIT', {
        quantity: String(quantity),
        price: String(price),
        timeInForce: 'GTC',
      });
      return JSON.parse(result);
    } catch (err) {
      throw new Error(`Test order failed for ${side} at ${price}: ${err.message}`);
    }
  }

  /**
   * Cancel a specific order
   */
  cancelOrder(symbol, orderId) {
    try {
      const result = this.client.cancelOrder(symbol, { orderId: String(orderId) });
      return JSON.parse(result);
    } catch (err) {
      throw new Error(`Failed to cancel order ${orderId}: ${err.message}`);
    }
  }

  /**
   * Cancel all open orders for a symbol
   */
  cancelAllOrders(symbol) {
    try {
      const result = this.client.cancelOpenOrders(symbol);
      return JSON.parse(result);
    } catch (err) {
      // If there are no open orders, MEXC may return an error
      if (err.message.includes('Unknown order') || err.message.includes('no order')) {
        return [];
      }
      throw new Error(`Failed to cancel all orders: ${err.message}`);
    }
  }

  /**
   * Get all open orders for a symbol
   */
  getOpenOrders(symbol) {
    try {
      const result = this.client.openOrders(symbol);
      return JSON.parse(result);
    } catch (err) {
      throw new Error(`Failed to get open orders: ${err.message}`);
    }
  }

  /**
   * Query a specific order
   */
  queryOrder(symbol, orderId) {
    try {
      const result = this.client.queryOrder(symbol, { orderId: String(orderId) });
      return JSON.parse(result);
    } catch (err) {
      throw new Error(`Failed to query order ${orderId}: ${err.message}`);
    }
  }

  /**
   * Get order book
   */
  getOrderBook(symbol, limit = 20) {
    try {
      const result = this.client.depth(symbol, { limit });
      return JSON.parse(result);
    } catch (err) {
      throw new Error(`Failed to get order book: ${err.message}`);
    }
  }
}

module.exports = Exchange;
