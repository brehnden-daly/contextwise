import readline from 'node:readline';
import chalk from 'chalk';
import { UnifiedRegistryClient } from '../../registry/remote_registry.js';
import { ServerManager } from '../../registry/manager.js';
import { KnownServerRegistry } from '../../registry/known_servers.js';
import { SmitheryClient } from '../../registry/smithery_client.js';
import type { RegistryServerItem, RegistrySource } from '../../registry/types.js';

export interface NavigatorOptions {
  query?: string;
  category?: string;
  source?: RegistrySource | 'all';
}

export async function launchNavigator(options: NavigatorOptions = {}): Promise<void> {
  // Check if TTY is available
  if (!process.stdin.isTTY) {
    console.log(chalk.yellow('Interactive navigator requires an interactive TTY terminal.'));
    return;
  }

  let searchQuery = options.query || options.category || '';
  let selectedIndex = 0;
  let allServers: RegistryServerItem[] = [];
  let isFetching = true;

  // Initial fetch
  allServers = await UnifiedRegistryClient.search({
    query: searchQuery || undefined,
    category: options.category,
    source: options.source || 'all',
    limit: 40,
  });
  isFetching = false;

  // Setup readline for keypress
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  // Hide cursor during navigation
  process.stdout.write('\u001B[?25l');

  const cleanup = () => {
    process.stdout.write('\u001B[?25h'); // Show cursor
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    console.clear();
  };

  const getSourceBadge = (src: RegistrySource) => {
    switch (src) {
      case 'curated':
        return chalk.bgGreen.black(' CURATED ');
      case 'official':
        return chalk.bgCyan.black(' OFFICIAL ');
      case 'smithery':
        return chalk.bgMagenta.black(' SMITHERY ');
    }
  };

  const render = () => {
    // Filter servers based on searchQuery
    const q = searchQuery.toLowerCase().trim();
    const filtered = allServers.filter(
      (s) =>
        !q ||
        s.displayName.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.tags && s.tags.some((t) => t.toLowerCase().includes(q)))
    );

    if (selectedIndex >= filtered.length) {
      selectedIndex = Math.max(0, filtered.length - 1);
    }

    const termHeight = process.stdout.rows || 25;
    const termWidth = process.stdout.columns || 80;
    const pageSize = Math.max(5, Math.min(10, termHeight - 14));

    // Calculate window slice
    const startIdx = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(pageSize / 2),
        Math.max(0, filtered.length - pageSize)
      )
    );
    const visibleServers = filtered.slice(startIdx, startIdx + pageSize);

    // Build output buffer
    console.clear();

    console.log(
      chalk.bold.cyan('🌐 ContextWise Interactive MCP Navigator') +
        chalk.gray(' | ') +
        chalk.white('Search, browse, and hot-load MCP servers')
    );
    console.log(
      chalk.gray('Controls: ') +
        chalk.yellow('↑/↓') +
        chalk.gray(' Navigate  ') +
        chalk.yellow('[a] / [Enter]') +
        chalk.gray(' Add Server  ') +
        chalk.yellow('[Esc] / [q]') +
        chalk.gray(' Exit  ') +
        chalk.yellow('Type') +
        chalk.gray(' to filter\n')
    );

    console.log(
      chalk.bold('Filter: ') +
        chalk.cyan(searchQuery ? searchQuery : chalk.gray('(Type to filter...)')) +
        chalk.gray(` [${filtered.length} matching / ${allServers.length} total]`)
    );
    console.log(chalk.gray('─'.repeat(Math.min(termWidth, 76))));

    if (isFetching) {
      console.log(chalk.yellow('\n  Loading servers from registries...\n'));
    } else if (filtered.length === 0) {
      console.log(chalk.yellow(`\n  No servers matching "${searchQuery}".`));
      console.log(chalk.gray('  Press Backspace to broaden search or Esc to exit.\n'));
    } else {
      for (let i = 0; i < visibleServers.length; i++) {
        const item = visibleServers[i];
        const actualIndex = startIdx + i;
        const isSelected = actualIndex === selectedIndex;

        const cursor = isSelected ? chalk.bold.green('▸ ') : '  ';
        const badge = getSourceBadge(item.source);
        const nameStr = isSelected
          ? chalk.bold.underline.white(item.displayName)
          : chalk.white(item.displayName);
        const idStr = chalk.gray(`(${item.id})`);

        console.log(`${cursor}${badge} ${nameStr} ${idStr}`);
      }
    }

    console.log(chalk.gray('─'.repeat(Math.min(termWidth, 76))));

    // Selected item detail box
    const selectedItem = filtered[selectedIndex];
    if (selectedItem) {
      console.log(
        chalk.bold('Selected: ') +
          chalk.green(selectedItem.displayName) +
          chalk.gray(` [${selectedItem.sourceLabel}]`)
      );
      console.log(chalk.white(`Description: ${selectedItem.description}`));

      if (selectedItem.requiredParams && selectedItem.requiredParams.length > 0) {
        const params = selectedItem.requiredParams
          .map((p) => `${p.name} (${p.type}: ${p.description})`)
          .join(', ');
        console.log(chalk.yellow(`Required Params: ${params}`));
      }

      const docsUrl =
        selectedItem.homepage ||
        (selectedItem.source === 'smithery'
          ? `https://smithery.ai/servers/${selectedItem.id}`
          : selectedItem.source === 'curated'
            ? `https://github.com/modelcontextprotocol/servers/tree/main/src/${selectedItem.id}`
            : `https://registry.modelcontextprotocol.io`);

      console.log(chalk.cyan('Docs: ') + chalk.underline.white(docsUrl));

      console.log(
        chalk.cyan(`Quick Action: `) +
          chalk.white(`Press `) +
          chalk.bold.yellow(`[a]`) +
          chalk.white(` or `) +
          chalk.bold.yellow(`[Enter]`) +
          chalk.white(` to install `) +
          chalk.bold(selectedItem.id)
      );
    } else {
      console.log(chalk.gray('Select a server above to view configuration and details.'));
    }
  };

  render();

  // Handle interactive input
  return new Promise<void>((resolve) => {
    process.stdin.on('keypress', async (str, key) => {
      if (!key) {
        if (str && str.length === 1 && str >= ' ') {
          searchQuery += str;
          selectedIndex = 0;
          render();
        }
        return;
      }

      // Exit controls: Esc, Ctrl+C, or 'q' (when search query is empty)
      if (
        key.name === 'escape' ||
        (key.ctrl && key.name === 'c') ||
        (key.name === 'q' && searchQuery === '')
      ) {
        cleanup();
        console.log(chalk.gray('Exited ContextWise Navigator.\n'));
        resolve();
        return;
      }

      // Arrow navigation
      if (key.name === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === 'down') {
        const q = searchQuery.toLowerCase().trim();
        const filteredCount = allServers.filter(
          (s) =>
            !q ||
            s.displayName.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
        ).length;
        selectedIndex = Math.min(Math.max(0, filteredCount - 1), selectedIndex + 1);
        render();
        return;
      }

      // Backspace in search
      if (key.name === 'backspace') {
        if (searchQuery.length > 0) {
          searchQuery = searchQuery.slice(0, -1);
          selectedIndex = 0;
          render();
        }
        return;
      }

      // Add selected server: Enter or 'a'
      if (key.name === 'return' || key.name === 'a') {
        const q = searchQuery.toLowerCase().trim();
        const filtered = allServers.filter(
          (s) =>
            !q ||
            s.displayName.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
        );
        const target = filtered[selectedIndex];
        if (target) {
          cleanup();
          console.log(chalk.bold.green(`\n✓ Selected MCP Server: "${target.displayName}" (${target.id})\n`));

          try {
            let config = target.suggestedConfig;
            if (!config) {
              if (target.source === 'smithery') {
                config = SmitheryClient.buildServerConfig(target.id);
              } else {
                const preset = KnownServerRegistry.find(target.id);
                if (preset) {
                  config = KnownServerRegistry.buildConfig(preset);
                } else {
                  config = {
                    command: 'npx',
                    args: ['-y', target.id],
                    env: {},
                    autoRestart: true,
                  };
                }
              }
            }

            const savedPath = ServerManager.saveUpstream(target.id, config);
            console.log(
              chalk.green(
                `✓ Successfully added "${target.id}" into ${chalk.bold(savedPath)}!`
              )
            );
            console.log(
              chalk.cyan(
                `The server is now configured and will be loaded automatically on next session or when ContextWise starts.\n`
              )
            );
          } catch (err) {
            console.log(chalk.red(`Failed to add server: ${err}\n`));
          }

          resolve();
          return;
        }
      }

      // Alphanumeric search input
      if (str && str.length === 1 && !key.ctrl && !key.meta && str >= ' ') {
        searchQuery += str;
        selectedIndex = 0;
        render();
      }
    });
  });
}
