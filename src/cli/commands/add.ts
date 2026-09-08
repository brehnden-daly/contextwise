import chalk from 'chalk';
import type { UpstreamServerConfig } from '../../config/schema.js';
import { UpstreamMultiplexer } from '../../core/multiplexer.js';
import { KnownServerRegistry } from '../../registry/known_servers.js';
import { ServerManager } from '../../registry/manager.js';
import { SmitheryClient } from '../../registry/smithery_client.js';

export interface AddCommandOptions {
  command?: string;
  args?: string[];
  env?: string[];
  url?: string;
  config?: string;
  smithery?: boolean | string;
  test?: boolean;
}

export async function addCommand(
  serverName: string,
  extraArg: string | undefined,
  options: AddCommandOptions
): Promise<void> {
  const rawName = serverName.trim();
  const name = rawName.replace(/^@/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  console.log(chalk.bold.cyan(`\n⚡ ContextWise Server Configuration: "${name}"\n`));

  let serverConfig: UpstreamServerConfig;

  // Parse any passed --env KEY=VAL flags
  const envMap: Record<string, string> = {};
  if (options.env) {
    for (const item of options.env) {
      const idx = item.indexOf('=');
      if (idx > 0) {
        const k = item.slice(0, idx).trim();
        let v = item.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        envMap[k] = v;
      }
    }
  }

  // Case 1: Remote SSE endpoint
  if (options.url) {
    serverConfig = {
      url: options.url,
      headers: {},
      transport: 'auto',
      autoReconnect: true,
    };
  }
  // Case 2: Smithery package requested via --smithery or smithery: prefix
  else if (options.smithery || name.startsWith('smithery:') || name.startsWith('ai.smithery/')) {
    const pkg =
      typeof options.smithery === 'string'
        ? options.smithery
        : name.replace(/^smithery:/, '').replace(/^ai\.smithery\//, '');

    console.log(chalk.magenta(`✓ Configuring Smithery package: ${chalk.bold(pkg)}`));
    serverConfig = SmitheryClient.buildServerConfig(pkg, { env: envMap });
  }
  // Case 3: Matching known local preset
  else {
    const knownPreset = KnownServerRegistry.find(name);

    if (knownPreset) {
      console.log(
        chalk.green(`✓ Recognized preset for ${chalk.bold(knownPreset.displayName)}`)
      );

      const passedArgs = options.args ?? [];
      if (extraArg && !passedArgs.includes(extraArg)) {
        passedArgs.push(extraArg);
      }

      // Check if required params are missing and warn
      for (const param of knownPreset.requiredParams) {
        if (param.type === 'env' && !envMap[param.name] && !process.env[param.name]) {
          console.log(
            chalk.yellow(
              `⚠ Note: ${param.name} not set. Specify with --env ${param.name}=<value>`
            )
          );
        }
      }

      serverConfig = KnownServerRegistry.buildConfig(knownPreset, {
        args: passedArgs,
        env: envMap,
      });
    } else if (options.command) {
      serverConfig = {
        command: options.command,
        args: options.args ?? (extraArg ? [extraArg] : []),
        env: envMap,
        autoRestart: true,
      };
    } else {
      console.log(
        chalk.red(`Error: "${name}" is not a recognized preset.`)
      );
      console.log(
        `Please specify --command <cmd>, use --smithery, or check available presets with ${chalk.cyan('contextwise browse')}.\n`
      );
      process.exit(1);
    }
  }

  // Optional: test connection to server before persisting
  if (options.test !== false) {
    console.log(chalk.gray(`Testing connection to "${name}"...`));
    const multiplexer = new UpstreamMultiplexer();

    try {
      await multiplexer.connectServer(name, serverConfig);
      const status = multiplexer.getStatus().find((s) => s.name === name);

      if (status && status.status === 'connected') {
        const tools = multiplexer.getAllTools();
        console.log(
          chalk.green(
            `✓ Connected successfully! Discovered ${tools.length} tools.`
          )
        );
        for (const t of tools.slice(0, 5)) {
          console.log(`  • ${chalk.gray(t.namespacedName)}`);
        }
        if (tools.length > 5) {
          console.log(`  ... and ${tools.length - 5} more`);
        }
      } else {
        console.log(
          chalk.yellow(
            `⚠ Warning: Server could not connect (${status?.error || 'unknown error'}). Saving configuration anyway.`
          )
        );
      }
    } catch (testErr) {
      console.log(
        chalk.yellow(
          `⚠ Warning: Connection test encountered error: ${testErr}. Saving configuration anyway.`
        )
      );
    } finally {
      await multiplexer.closeAll();
    }
  }

  // Persist to contextwise.json
  const savedPath = ServerManager.saveUpstream(name, serverConfig, options.config);
  console.log(chalk.green(`\n✓ Server "${name}" successfully saved to ${savedPath}!`));
  console.log(
    chalk.gray(
      `ContextWise will now automatically index "${name}" on startup and make its tools available.\n`
    )
  );
}
