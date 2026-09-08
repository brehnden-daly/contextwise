import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import { ConfigLoader } from '../../config/loader.js';
import { VaultAuditor } from '../../vault/audit.js';
import { secretVault } from '../../vault/vault.js';

export interface SecretSetOptions {
  scope?: 'personal' | 'workspace' | 'team';
}

export interface SecretGetOptions {
  reveal?: boolean;
}

export async function secretSetCommand(
  key: string,
  value?: string,
  options: SecretSetOptions = {}
): Promise<void> {
  if (!key || typeof key !== 'string') {
    console.error(chalk.red('Error: Secret key must be specified.'));
    process.exit(1);
  }

  let secretValue = value;

  if (!secretValue) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      secretValue = await rl.question(chalk.cyan(`Enter secret value for "${key}": `));
    } finally {
      rl.close();
    }
  }

  secretValue = secretValue?.trim();
  if (!secretValue) {
    console.error(chalk.red('Error: Secret value cannot be empty.'));
    process.exit(1);
  }

  const scope = options.scope || 'personal';
  await secretVault.set(key, secretValue, scope);

  console.log(
    chalk.green(
      `\n✔ Secret "${chalk.bold(key)}" stored successfully in vault [${secretVault.getActiveDriverName()}] (scope: ${scope})\n`
    )
  );
  console.log(
    chalk.gray(
      `Tip: Reference this secret in contextwise.json with: "vault://${key}"\n`
    )
  );
}

export async function secretGetCommand(
  key: string,
  options: SecretGetOptions = {}
): Promise<void> {
  if (!key) {
    console.error(chalk.red('Error: Secret key must be specified.'));
    process.exit(1);
  }

  const value = await secretVault.get(key);
  if (value === null || value === undefined) {
    console.log(chalk.red(`\n✖ Secret "${key}" not found in ContextWise vault.\n`));
    process.exit(1);
  }

  if (options.reveal) {
    console.log(`\n${chalk.bold(key)}: ${chalk.yellow(value)}\n`);
  } else {
    const masked =
      value.length > 8
        ? `${value.slice(0, 4)}••••••••${value.slice(-4)}`
        : '••••••••';
    console.log(
      `\n${chalk.bold(key)}: ${chalk.yellow(masked)} ${chalk.gray(
        `(${value.length} chars, pass --reveal to view plaintext)`
      )}\n`
    );
  }
}

export async function secretListCommand(): Promise<void> {
  const secrets = await secretVault.list();

  console.log(chalk.bold.cyan('\n🔐 ContextWise Secret Vault\n'));
  console.log(`Active Storage Driver: ${chalk.bold(secretVault.getActiveDriverName())}`);
  console.log(`Total Stored Secrets:  ${chalk.bold(secrets.length)}\n`);

  if (secrets.length === 0) {
    console.log(chalk.yellow('No secrets currently stored in vault.'));
    console.log(
      chalk.gray('Store a secret with: contextwise secret set <key> <value>\n')
    );
    return;
  }

  console.log(
    chalk.bold(
      `${'KEY'.padEnd(30)} ${'SCOPE'.padEnd(14)} ${'BACKEND'.padEnd(18)} ${'UPDATED'}`
    )
  );
  console.log(chalk.gray('─'.repeat(75)));

  for (const s of secrets) {
    const dateStr = new Date(s.updatedAt).toISOString().replace('T', ' ').slice(0, 19);
    console.log(
      `${chalk.cyan(s.key.padEnd(30))} ${s.scope.padEnd(14)} ${s.backend.padEnd(18)} ${chalk.gray(dateStr)}`
    );
  }
  console.log('');
}

export async function secretDeleteCommand(key: string): Promise<void> {
  if (!key) {
    console.error(chalk.red('Error: Secret key must be specified.'));
    process.exit(1);
  }

  const deleted = await secretVault.delete(key);
  if (deleted) {
    console.log(chalk.green(`\n✔ Secret "${chalk.bold(key)}" was successfully deleted from vault.\n`));
  } else {
    console.log(chalk.yellow(`\n✖ Secret "${key}" was not found in vault.\n`));
  }
}

export async function secretAuditCommand(): Promise<void> {
  const config = ConfigLoader.load();
  const report = await VaultAuditor.audit(config);

  console.log(chalk.bold.cyan('\n🛡️  ContextWise Secret Security Audit\n'));
  console.log(`Upstream Servers Inspected: ${chalk.bold(report.totalUpstreams)}`);
  console.log(`Vault References in Config: ${chalk.bold(report.vaultReferencedCount)}`);
  console.log(`Active Vault Driver:        ${chalk.bold(report.activeDriver)}`);
  console.log(`Redacted Secrets in Memory: ${chalk.bold(report.registeredSecretCount)}\n`);

  if (report.plaintextWarnings.length === 0) {
    console.log(
      chalk.green(
        '✔ Vault Audit Passed: No exposed plaintext credentials detected in configuration.\n'
      )
    );
    return;
  }

  console.log(
    chalk.red(
      `⚠ Found ${report.plaintextWarnings.length} potential credential risk(s) in configuration:\n`
    )
  );

  for (const warning of report.plaintextWarnings) {
    const badge =
      warning.severity === 'critical'
        ? chalk.bgRed.bold(' CRITICAL ')
        : chalk.bgYellow.black.bold(' WARNING ');

    console.log(`${badge} [${warning.serverName}] ${chalk.bold(warning.envVar)}`);
    console.log(`  ${chalk.gray('Issue:')}       ${warning.reason}`);
    console.log(`  ${chalk.cyan('Action:')}      ${warning.suggestion}\n`);
  }
}
