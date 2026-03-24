#!/usr/bin/env node
'use strict';

require('dotenv').config();

const GridBot = require('./src/grid-bot');
const config = require('./src/config');

console.log(`
╔══════════════════════════════════════════╗
║          MEXC Grid Trading Bot           ║
╚══════════════════════════════════════════╝
`);

console.log('Configuration:');
console.log(`  Symbol:         ${config.symbol}`);
console.log(`  Grid Range:     ${config.gridLower} - ${config.gridUpper}`);
console.log(`  Grid Lines:     ${config.gridLines}`);
console.log(`  Investment:     ${config.investment} (quote currency)`);
console.log(`  Poll Interval:  ${config.pollInterval}ms`);
console.log(`  Dry Run:        ${config.dryRun}`);
console.log('');

const bot = new GridBot(config);

// Graceful shutdown
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] Shutting down gracefully...`);
  bot.stop().then(() => {
    console.log('Bot stopped. Goodbye!');
    process.exit(0);
  }).catch((err) => {
    console.error('Error during shutdown:', err.message);
    process.exit(1);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

bot.start().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
