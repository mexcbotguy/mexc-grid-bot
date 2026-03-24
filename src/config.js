'use strict';

const config = {
  apiKey: process.env.MEXC_API_KEY || '',
  apiSecret: process.env.MEXC_API_SECRET || '',
  symbol: (process.env.SYMBOL || 'BTCUSDT').toUpperCase(),
  gridUpper: parseFloat(process.env.GRID_UPPER || '72000'),
  gridLower: parseFloat(process.env.GRID_LOWER || '58000'),
  gridLines: parseInt(process.env.GRID_LINES || '10', 10),
  investment: parseFloat(process.env.INVESTMENT || '1000'),
  pollInterval: parseInt(process.env.POLL_INTERVAL || '10000', 10),
  dryRun: (process.env.DRY_RUN || 'true').toLowerCase() === 'true',
};

// Validation
if (!config.apiKey || !config.apiSecret) {
  console.error('Error: MEXC_API_KEY and MEXC_API_SECRET must be set in .env');
  process.exit(1);
}

if (config.gridUpper <= config.gridLower) {
  console.error('Error: GRID_UPPER must be greater than GRID_LOWER');
  process.exit(1);
}

if (config.gridLines < 2) {
  console.error('Error: GRID_LINES must be at least 2');
  process.exit(1);
}

if (config.investment <= 0) {
  console.error('Error: INVESTMENT must be positive');
  process.exit(1);
}

module.exports = config;
