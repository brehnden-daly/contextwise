#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distCli = resolve(__dirname, '../dist/cli.js');
const srcCli = resolve(__dirname, '../src/cli/index.js');

const cliModule = existsSync(distCli) ? distCli : srcCli;

const { runCli } = await import(pathToFileURL(cliModule).href);
await runCli().catch((err) => {
  process.stderr.write(`ContextWise Fatal Error: ${err}\n`);
  process.exit(1);
});
