import { exec } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import { cloudClient } from '../../cloud/client.js';
import { syncManager } from '../../cloud/sync_manager.js';

function openBrowser(url: string): void {
  const startCmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  exec(`${startCmd} "${url}"`, (err) => {
    if (err) {
      console.log(chalk.gray(`Could not open browser automatically. Please visit:\n${url}`));
    }
  });
}

export async function loginCommand(apiKey?: string): Promise<void> {
  const key = apiKey?.trim();

  if (key) {
    try {
      const token = await cloudClient.loginWithKey(key);
      console.log(chalk.green(`\n✔ Logged in successfully as ${chalk.bold(token.email)}\n`));
      console.log(chalk.gray(`User ID: ${token.userId}`));
      console.log(chalk.gray(`Session valid until: ${new Date(token.expiresAt).toLocaleDateString()}\n`));
      return;
    } catch (err) {
      console.error(chalk.red(`\n✖ Login failed: ${err instanceof Error ? err.message : err}\n`));
      process.exit(1);
    }
  }

  // Interactive Browser Authorization Flow (RFC 8628)
  try {
    console.log(chalk.cyan('\nInitiating ContextWise Cloud authorization...'));
    const flow = await cloudClient.startDeviceFlow();

    console.log(chalk.bold('\nTo authorize this device, follow these steps:'));
    console.log(`1. Open this URL in your browser:`);
    console.log(`   ${chalk.bold.underline.blue(flow.verification_uri)}`);
    console.log(`2. Verify the confirmation code:`);
    console.log(`   ${chalk.bold.yellow(flow.user_code)}\n`);
    console.log(chalk.gray('Waiting for browser approval... (press Ctrl+C to cancel)'));

    const token = await cloudClient.pollDeviceToken(flow.device_code, flow.interval);
    console.log(chalk.green(`\n✔ Logged in successfully as ${chalk.bold(token.email)}\n`));
    console.log(chalk.gray(`User ID: ${token.userId}`));
    console.log(chalk.gray(`Session valid until: ${new Date(token.expiresAt).toLocaleDateString()}\n`));
  } catch (err) {
    console.error(chalk.red(`\n✖ Login failed: ${err instanceof Error ? err.message : err}\n`));
    process.exit(1);
  }
}

export async function logoutCommand(): Promise<void> {
  cloudClient.clearToken();
  console.log(chalk.green('\n✔ Logged out of ContextWise Cloud.\n'));
}

export async function whoamiCommand(): Promise<void> {
  try {
    const info = await cloudClient.whoami();
    console.log(chalk.bold.cyan('\n👤 ContextWise Cloud Identity\n'));
    console.log(`User Email:   ${chalk.bold(info.email)}`);
    console.log(`User ID:      ${chalk.gray(info.userId)}`);

    const planDisplay =
      info.plan === 'pro'
        ? chalk.bold.green('PRO')
        : info.plan === 'team'
        ? chalk.bold.blue('TEAM')
        : info.plan === 'enterprise'
        ? chalk.bold.magenta('ENTERPRISE')
        : chalk.bold.gray('COMMUNITY (Free)');

    const statusDisplay =
      info.subscriptionStatus === 'active'
        ? chalk.green('Active')
        : chalk.yellow(info.subscriptionStatus || 'Inactive');

    console.log(`Plan:         ${planDisplay} (${statusDisplay})`);
    if (info.currentPeriodEnd) {
      console.log(
        `Next Renewal: ${chalk.gray(
          new Date(info.currentPeriodEnd).toISOString().replace('T', ' ').slice(0, 10)
        )}`
      );
    }
    console.log('');

    if (info.workspaces && info.workspaces.length > 0) {
      console.log(chalk.bold('Workspaces:'));
      for (const w of info.workspaces) {
        console.log(`• ${chalk.green(w.name)} (${w.id}) - Role: ${w.role}`);
      }
      console.log('');
    }
  } catch (err) {
    console.error(chalk.red(`\n✖ Failed to retrieve identity: ${err instanceof Error ? err.message : err}\n`));
    process.exit(1);
  }
}

export async function upgradeCommand(options: {
  team?: boolean;
  annual?: boolean;
}): Promise<void> {
  if (!cloudClient.isAuthenticated()) {
    console.log(chalk.yellow('\nYou must be logged in to upgrade your subscription.'));
    console.log(
      chalk.cyan(
        'Run "contextwise login" first, or visit https://contextwise.dev/#pricing in your browser.\n'
      )
    );
    return;
  }

  const plan = options.team ? 'team' : 'pro';
  const interval = options.annual ? 'year' : 'month';

  console.log(
    chalk.cyan(
      `\nInitiating Stripe Checkout for ContextWise ${chalk.bold(plan.toUpperCase())} (${interval}ly)...`
    )
  );

  try {
    const session = await cloudClient.createCheckoutSession(plan, interval);
    console.log(chalk.green('\n✔ Checkout session created.'));
    console.log(`Opening your browser to complete payment via Stripe:\n`);
    console.log(`  ${chalk.bold.underline.blue(session.checkoutUrl)}\n`);
    openBrowser(session.checkoutUrl);
    console.log(chalk.gray('Once payment is confirmed, your subscription will be instantly unlocked.'));
    console.log(chalk.gray('Run "contextwise whoami" to confirm your subscription status.\n'));
  } catch (err) {
    console.error(
      chalk.red(`\n✖ Unable to initiate checkout: ${err instanceof Error ? err.message : err}\n`)
    );
  }
}

export async function billingCommand(): Promise<void> {
  if (!cloudClient.isAuthenticated()) {
    console.log(chalk.yellow('\nYou must be logged in to access the billing portal.'));
    console.log(chalk.cyan('Run "contextwise login" first.\n'));
    return;
  }

  console.log(chalk.cyan('\nOpening Stripe Customer Billing Portal...'));

  try {
    const session = await cloudClient.createPortalSession();
    console.log(`Opening your browser to manage payment methods, invoices, and subscriptions:\n`);
    console.log(`  ${chalk.bold.underline.blue(session.portalUrl)}\n`);
    openBrowser(session.portalUrl);
  } catch (err) {
    console.error(
      chalk.red(`\n✖ Unable to open billing portal: ${err instanceof Error ? err.message : err}\n`)
    );
  }
}

export async function pushCommand(workspaceId?: string): Promise<void> {
  if (!cloudClient.isAuthenticated()) {
    console.log(chalk.yellow('\nNot logged in to ContextWise Cloud.'));
    console.log(chalk.cyan('Run "contextwise login" first.\n'));
    return;
  }

  console.log(chalk.cyan('\n☁  Pushing local workspace to ContextWise Cloud...'));
  try {
    const res = await syncManager.push(workspaceId);
    if (res.status === 'committed') {
      console.log(chalk.green(`✔ Successfully pushed revision #${chalk.bold(res.revision)} to Cloud.\n`));
    } else {
      console.log(chalk.yellow(`⚠ Push conflict: Server has revision #${res.serverRevision}. Pull changes first.\n`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('requires an upgraded subscription') ||
      msg.includes('Cloud Sync requires')
    ) {
      console.log(
        chalk.yellow('\n⚠ Multi-device Cloud Sync requires a ContextWise Pro or Team subscription.')
      );
      console.log(
        chalk.cyan(
          'Run "contextwise upgrade" to subscribe via Stripe, or visit https://contextwise.dev/#pricing\n'
        )
      );
    } else {
      console.error(chalk.red(`\n✖ Cloud push failed: ${msg}\n`));
    }
  }
}

export async function pullCommand(workspaceId?: string): Promise<void> {
  if (!cloudClient.isAuthenticated()) {
    console.log(chalk.yellow('\nNot logged in to ContextWise Cloud.'));
    console.log(chalk.cyan('Run "contextwise login" first.\n'));
    return;
  }

  console.log(chalk.cyan('\n☁  Pulling latest workspace snapshot from ContextWise Cloud...'));
  try {
    const res = await syncManager.pull(workspaceId);
    if (res) {
      console.log(chalk.green(`✔ Applied cloud revision #${chalk.bold(res.revision)} to local workspace.\n`));
    } else {
      console.log(chalk.gray('✔ Local workspace is already up to date.\n'));
    }
  } catch (err) {
    console.error(chalk.red(`\n✖ Cloud pull failed: ${err instanceof Error ? err.message : err}\n`));
  }
}

export async function syncStatusCommand(): Promise<void> {
  const status = syncManager.getStatus();

  console.log(chalk.bold.cyan('\n🔄 ContextWise Cloud Sync Status\n'));
  console.log(`Logged In:      ${status.isLoggedIn ? chalk.green('YES') : chalk.gray('NO')}`);
  if (status.userEmail) {
    console.log(`Account:        ${chalk.bold(status.userEmail)}`);
  }
  console.log(`Device ID:      ${chalk.gray(status.deviceId)}`);
  console.log(`Workspace ID:   ${status.workspaceId}`);
  console.log(`Local Revision: ${chalk.bold(status.revision)}`);
  console.log(
    `Last Synced:    ${
      status.lastSyncedAt > 0
        ? new Date(status.lastSyncedAt).toISOString().replace('T', ' ').slice(0, 19)
        : chalk.gray('Never')
    }\n`
  );
}
