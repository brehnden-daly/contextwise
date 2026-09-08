import chalk from 'chalk';
import { ConfigLoader } from '../../config/loader.js';
import { UpstreamMultiplexer } from '../../core/multiplexer.js';

export interface ListCommandOptions {
  config?: string;
}

export async function listCommand(options: ListCommandOptions): Promise<void> {
  const config = ConfigLoader.load({ configPath: options.config });
  const upstreamCount = Object.keys(config.upstreams).length;

  console.log(chalk.bold.cyan('\n🔍 ContextWise Catalog Overview\n'));
  console.log(`Configured Upstreams: ${chalk.bold(upstreamCount)}`);

  if (upstreamCount === 0) {
    console.log(
      chalk.yellow('No upstream MCP servers defined. Run "contextwise init" to add servers.\n')
    );
    return;
  }

  const multiplexer = new UpstreamMultiplexer();
  try {
    await multiplexer.connectAll(config.upstreams);
    const statuses = multiplexer.getStatus();
    const tools = multiplexer.getAllTools();

    console.log(chalk.bold('\n--- Upstream Servers ---'));
    for (const s of statuses) {
      const statusColor = s.status === 'connected' ? chalk.green : chalk.red;
      console.log(
        `• ${chalk.bold(s.name)} [${s.transportType}] - ${statusColor(s.status.toUpperCase())} (${s.toolsCount} tools)`
      );
      if (s.error) {
        console.log(`  ${chalk.red('Error:')} ${s.error}`);
      }
    }

    console.log(chalk.bold(`\n--- Aggregated Tools (${tools.length} total) ---`));
    for (const tool of tools) {
      const hint = tool.readOnlyHint ? chalk.gray(' [read-only]') : '';
      console.log(`• ${chalk.green(tool.namespacedName)}${hint}`);
      if (tool.description) {
        console.log(`  ${chalk.gray(tool.description.slice(0, 100))}`);
      }
    }
    console.log('');
  } finally {
    await multiplexer.closeAll();
  }
}
