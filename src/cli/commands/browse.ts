import chalk from 'chalk';
import { UnifiedRegistryClient } from '../../registry/remote_registry.js';
import type { RegistrySource } from '../../registry/types.js';
import { launchNavigator } from '../ui/navigator.js';

export interface BrowseCommandOptions {
  category?: string;
  query?: string;
  source?: string;
  offline?: boolean;
  interactive?: boolean;
}

export async function browseCommand(options: BrowseCommandOptions): Promise<void> {
  if (options.interactive) {
    await launchNavigator({
      query: options.query,
      category: options.category,
      source: options.source as RegistrySource | 'all',
    });
    return;
  }

  const source = (options.offline ? 'curated' : (options.source as RegistrySource | 'all')) || 'all';

  console.log(chalk.bold.cyan('\n🌐 ContextWise Multi-Registry MCP Browser'));
  console.log(
    chalk.gray(
      `Searching sources: ${source === 'all' ? 'Official MCP Registry + Smithery + Curated Presets' : source}\n`
    )
  );

  const servers = await UnifiedRegistryClient.search({
    query: options.query,
    category: options.category,
    source,
    limit: 20,
  });

  if (servers.length === 0) {
    console.log(chalk.yellow('No matching MCP servers found across registries.'));
    console.log(
      chalk.gray(
        'Try broadening your query, or install any custom server using "contextwise add <name> --command <cmd>"\n'
      )
    );
    return;
  }

  // Format source badge with colors
  const getSourceBadge = (src: RegistrySource) => {
    switch (src) {
      case 'curated':
        return chalk.bgGreen.black(' CURATED / VERIFIED ');
      case 'official':
        return chalk.bgCyan.black(' OFFICIAL MCP REGISTRY ');
      case 'smithery':
        return chalk.bgMagenta.black(' SMITHERY ');
    }
  };

  console.log(chalk.bold(`Found ${servers.length} MCP Servers:\n`));

  for (const s of servers) {
    const verifiedIcon = s.verified ? chalk.green(' ✓') : '';
    console.log(
      `${getSourceBadge(s.source)} ${chalk.bold.white(s.displayName)} (${chalk.gray(s.id)})${verifiedIcon}`
    );
    console.log(`  ${chalk.white(s.description)}`);

    if (s.requiredParams && s.requiredParams.length > 0) {
      const paramStr = s.requiredParams
        .map((p) => `${p.name} (${p.type})`)
        .join(', ');
      console.log(`  ${chalk.yellow('Required parameters:')} ${chalk.gray(paramStr)}`);
    }

    const docsUrl =
      s.homepage ||
      (s.source === 'smithery'
        ? `https://smithery.ai/servers/${s.id}`
        : s.source === 'curated'
          ? `https://github.com/modelcontextprotocol/servers/tree/main/src/${s.id}`
          : `https://registry.modelcontextprotocol.io`);

    console.log(`  ${chalk.cyan('Docs:')} ${chalk.underline.white(docsUrl)}`);

    let installCmd = `contextwise add ${s.id}`;
    if (s.source === 'smithery') {
      installCmd = `contextwise add ${s.id} --smithery`;
    }
    console.log(`  ${chalk.cyan('Install:')} ${chalk.bold(installCmd)}\n`);
  }

  console.log(
    chalk.gray(
      'To install any server: ' +
        chalk.white('contextwise add <id>') +
        ' or hot-load in chat with ' +
        chalk.white('contextwise_add_server\n')
    )
  );
}
