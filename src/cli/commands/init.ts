import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { ConfigLoader } from '../../config/loader.js';
import { ContextWiseConfig, ContextWiseConfigSchema } from '../../config/schema.js';

export interface InitCommandOptions {
  force?: boolean;
  cwd?: string;
}

export async function initCommand(options: InitCommandOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const targetPath = resolve(cwd, 'contextwise.json');

  console.log(chalk.bold.cyan('\n🚀 ContextWise Setup Wizard\n'));

  if (existsSync(targetPath) && !options.force) {
    console.log(
      chalk.yellow(`Configuration file already exists at ${targetPath}.`)
    );
    console.log('Use --force to overwrite.\n');
    return;
  }

  // Try auto-importing from existing clients
  const imported = ConfigLoader.autoImportClientConfigs(cwd);
  let initialConfig: ContextWiseConfig;

  if (imported && Object.keys(imported.upstreams).length > 0) {
    console.log(
      chalk.green(
        `✓ Found existing MCP servers from AI client configuration:`
      )
    );
    for (const name of Object.keys(imported.upstreams)) {
      console.log(`  - ${chalk.bold(name)}`);
    }
    initialConfig = imported;
  } else {
    console.log(chalk.blue('ℹ No existing MCP clients detected. Generating template configuration.'));
    initialConfig = ContextWiseConfigSchema.parse({
      version: '1.0.0',
      proxy: {
        transport: 'stdio',
        port: 3456,
        logLevel: 'info',
      },
      routing: {
        strategy: 'hybrid',
        topK: 5,
        similarityThreshold: 0.45,
        pinnedTools: [],
      },
      guardrails: {
        enableCache: true,
        cacheTtlSeconds: 120,
        maxCallsPerMinute: 60,
        loopBreakerThreshold: 3,
      },
      upstreams: {},
    });
  }

  writeFileSync(targetPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
  console.log(chalk.green(`\n✓ Successfully created ${targetPath}`));
  console.log(
    chalk.gray(
      '\nNext step: Connect your AI client (Cursor, Claude Desktop, Windsurf) by adding ContextWise to its MCP configuration:\n'
    )
  );

  console.log(chalk.white('{\n  "mcpServers": {\n    "contextwise": {\n      "command": "npx",\n      "args": ["-y", "contextwise", "start"]\n    }\n  }\n}\n'));
}
