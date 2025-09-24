#!/usr/bin/env node
import { startServer } from './webServer.js';

function parseArgs(argv) {
  const options = { port: null, host: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--port requires a value');
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--port must be a positive number');
      }
      options.port = parsed;
      i += 1;
    } else if (arg === '--host' || arg === '-H') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--host requires a value');
      }
      const trimmed = next.trim();
      if (!trimmed) {
        throw new Error('--host requires a value');
      }
      options.host = trimmed;
      i += 1;
    }
  }
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const { server, port, host } = await startServer({ port: args.port, host: args.host });
    const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
    const bindingLabel = host && host !== displayHost ? ` (bound to ${host})` : '';
    console.log(`Apollo 11 mission HUD listening on http://${displayHost}:${port}${bindingLabel}`);

    const shutdown = () => {
      console.log('\nShutting down mission server...');
      server.close(() => {
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start mission HUD server:', error);
    process.exit(1);
  }
}

main();
