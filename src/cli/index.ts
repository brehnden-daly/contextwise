import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { browseCommand } from './commands/browse.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import {
  billingCommand,
  loginCommand,
  logoutCommand,
  pullCommand,
  pushCommand,
  syncStatusCommand,
  upgradeCommand,
  whoamiCommand,
} from './commands/cloud.js';
import {
  secretAuditCommand,
  secretDeleteCommand,
  secretGetCommand,
  secretListCommand,
  secretSetCommand,
} from './commands/secret.js';
import { startCommand } from './commands/start.js';
import { statsCommand } from './commands/stats.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('contextwise')
    .description(
      'ContextWise: Dynamic MCP Tool Routing, Schema Compression & Execution Gateway'
    )
    .version('0.1.0');

  program
    .command('start')
    .description('Start the ContextWise MCP proxy gateway')
    .option('-c, --config <path>', 'Path to contextwise.json config file')
    .option(
      '-l, --log-level <level>',
      'Logging level (debug, info, warn, error, silent)',
      'info'
    )
    .option(
      '--passthrough',
      'Run in raw passthrough mode without dynamic tool routing'
    )
    .action(startCommand);

  program
    .command('init')
    .description('Initialize contextwise.json by scanning existing MCP configurations')
    .option('-f, --force', 'Overwrite existing configuration file')
    .action(initCommand);

  program
    .command('browse [category]')
    .description('Browse MCP servers across Official Registry, Smithery, and Curated Presets')
    .option('-q, --query <query>', 'Filter by search keyword')
    .option('-s, --source <source>', 'Filter by registry source (all, official, smithery, curated)', 'all')
    .option('--offline', 'Only show local curated presets without querying remote registries')
    .option('-i, --interactive', 'Launch interactive keyboard-navigable terminal UI')
    .action((category, opts) =>
      browseCommand({
        category,
        query: opts.query,
        source: opts.source,
        offline: opts.offline,
        interactive: opts.interactive,
      })
    );

  program
    .command('add <name> [extraArg]')
    .description(
      'Add and configure an upstream MCP server in contextwise.json (e.g. contextwise add postgres postgresql://...)'
    )
    .option('-s, --smithery [package]', 'Install and run via Smithery CLI (@smithery/cli)')
    .option('-c, --command <cmd>', 'Executable command for local stdio server')
    .option('-a, --args <args...>', 'Command-line arguments')
    .option('-e, --env <env...>', 'Environment variables in KEY=VALUE format')
    .option('-u, --url <url>', 'Remote SSE endpoint URL')
    .option('--no-test', 'Skip testing connection before saving')
    .action(addCommand);

  program
    .command('list')
    .description('Inspect configured upstreams and list all aggregated tools')
    .option('-c, --config <path>', 'Path to contextwise.json config file')
    .action(listCommand);

  const secret = program
    .command('secret')
    .description('Manage encrypted secrets, credentials, and run security audits');

  secret
    .command('set <key> [value]')
    .description('Store an encrypted secret in the vault (prompts securely if value omitted)')
    .option('-s, --scope <scope>', 'Secret scope (personal, workspace, team)', 'personal')
    .action((key, value, opts) => secretSetCommand(key, value, { scope: opts.scope }));

  secret
    .command('get <key>')
    .description('Retrieve secret metadata and preview value')
    .option('--reveal', 'Print full unmasked secret value in plaintext')
    .action((key, opts) => secretGetCommand(key, { reveal: opts.reveal }));

  secret
    .command('list')
    .description('List all secrets stored in the ContextWise vault')
    .action(secretListCommand);

  secret
    .command('delete <key>')
    .alias('rm')
    .description('Delete a secret from the vault')
    .action(secretDeleteCommand);

  secret
    .command('audit')
    .description('Scan configuration for exposed plaintext API keys and credentials')
    .action(secretAuditCommand);

  // Cloud Sync commands
  program
    .command('login [apiKey]')
    .description('Log in to ContextWise Cloud for end-to-end encrypted synchronization')
    .action(loginCommand);

  program
    .command('logout')
    .description('Log out of ContextWise Cloud on this device')
    .action(logoutCommand);

  program
    .command('whoami')
    .description('Display currently authenticated ContextWise Cloud account and workspaces')
    .action(whoamiCommand);

  program
    .command('push [workspaceId]')
    .description('Push local workspace configuration and encrypted secrets to ContextWise Cloud')
    .action(pushCommand);

  program
    .command('pull [workspaceId]')
    .description('Pull latest workspace configuration and secrets from ContextWise Cloud')
    .action(pullCommand);

  program
    .command('sync')
    .description('Display status of ContextWise Cloud synchronization')
    .action(syncStatusCommand);

  program
    .command('upgrade')
    .description('Upgrade your subscription to ContextWise Pro or Team via Stripe')
    .option('--team', 'Upgrade to Team subscription')
    .option('--annual', 'Select annual billing cycle for discounted pricing')
    .action((opts) => upgradeCommand({ team: opts.team, annual: opts.annual }));

  program
    .command('billing')
    .description('Manage your Stripe subscription, invoices, and payment methods in Customer Portal')
    .action(billingCommand);

  program
    .command('stats')
    .description('Display metrics on token savings, cost ROI, and cache efficiency')
    .option('--reset', 'Reset all recorded lifetime metrics')
    .option('--json', 'Output stats in raw JSON format')
    .action((opts) => statsCommand({ reset: opts.reset, json: opts.json }));

  return program;
}

export async function runCli(): Promise<void> {
  const program = createCli();
  await program.parseAsync(process.argv);
}

// If executed directly
if (process.argv[1]) {
  try {
    const executed = resolve(process.argv[1]);
    const current = fileURLToPath(import.meta.url);
    if (executed === current) {
      runCli();
    }
  } catch {}
}
