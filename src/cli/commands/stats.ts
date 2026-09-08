import chalk from 'chalk';
import { metricsCollector, LLM_PRICING } from '../../metrics/collector.js';

export interface StatsCommandOptions {
  reset?: boolean;
  json?: boolean;
}

function col(text: string, width: number, colorFn?: (s: string) => string): string {
  const truncated = text.length > width ? text.slice(0, width) : text;
  const padded = truncated.padEnd(width);
  return colorFn ? colorFn(padded) : padded;
}

function makeSeparator(cLeft: string, cMid: string, cRight: string, widths: number[]): string {
  const parts = widths.map((w) => '─'.repeat(w + 2));
  return `  ${cLeft}${parts.join(cMid)}${cRight}`;
}

function makeHeader(title: string, widths: number[]): string {
  const totalWidth = widths.reduce((acc, w) => acc + w + 2, 0) + widths.length - 1;
  const banner = `  ┌── ${title} `;
  const remaining = Math.max(0, totalWidth + 3 - banner.length);
  return `${banner}${'─'.repeat(remaining)}┐`;
}

export async function statsCommand(options: StatsCommandOptions = {}): Promise<void> {
  if (options.reset) {
    metricsCollector.reset();
    console.log(
      chalk.green.bold('\n✔ All ContextWise lifetime metrics and token analytics have been reset to zero.\n')
    );
    return;
  }

  // Reload fresh persistent values from disk
  metricsCollector.reload();
  const summary = metricsCollector.getSummary();

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const doubleDivider = chalk.bold.cyan('═'.repeat(74));

  console.log(`\n${doubleDivider}`);
  console.log(
    chalk.bold.cyan('         💰 ContextWise Performance, Token & Cost Analytics')
  );
  console.log(`${doubleDivider}\n`);

  // Prominent Dollar Savings Banner
  const baselineSavings = summary.dollarSavings.claudeSonnet.toFixed(2);
  const totalTokens = summary.estimatedTotalTokensSaved.toLocaleString();

  if (summary.estimatedTotalTokensSaved > 0) {
    console.log(
      chalk.bgGreen.black.bold(`  SAVINGS  `) +
        chalk.green.bold(
          ` ContextWise has saved you ~$${baselineSavings} in LLM API costs!`
        )
    );
    console.log(
      chalk.dim(`            ${totalTokens} total tokens avoided across all sessions\n`)
    );
  } else {
    console.log(
      chalk.bgBlue.black.bold(`  STANDBY  `) +
        chalk.cyan.bold(
          ` Ready to route! Connect Claude Code, Cursor, or Antigravity to track savings.`
        )
    );
    console.log(
      chalk.dim(`            0 tokens saved so far (start a session to begin tracking)\n`)
    );
  }

  // Section 1: Estimated Dollar Savings by Model
  const modelCols = [30, 18, 16];
  console.log(chalk.bold.yellow(makeHeader('💡 ESTIMATED SAVINGS BY MODEL', modelCols)));
  console.log(
    `  │ ${col('Model Family', 30, chalk.bold)} │ ${col('Benchmark Rate', 18, chalk.bold)} │ ${col('Dollar Saved', 16, chalk.bold)} │`
  );
  console.log(makeSeparator('├', '┼', '┤', modelCols));
  console.log(
    `  │ ${col('Claude 3.5 / 3.7 Sonnet (def)', 30, chalk.cyan)} │ ${col(`$${LLM_PRICING.CLAUDE_SONNET.toFixed(2)} / 1M`, 18)} │ ${col(`$${summary.dollarSavings.claudeSonnet.toFixed(2)}`, 16, chalk.green.bold)} │`
  );
  console.log(
    `  │ ${col('OpenAI GPT-4o', 30)} │ ${col(`$${LLM_PRICING.GPT_4O.toFixed(2)} / 1M`, 18)} │ ${col(`$${summary.dollarSavings.gpt4o.toFixed(2)}`, 16, chalk.green)} │`
  );
  console.log(
    `  │ ${col('Claude 3 Opus', 30)} │ ${col(`$${LLM_PRICING.CLAUDE_OPUS.toFixed(2)} / 1M`, 18)} │ ${col(`$${summary.dollarSavings.claudeOpus.toFixed(2)}`, 16, chalk.green)} │`
  );
  console.log(
    `  │ ${col('Haiku / GPT-4o mini', 30)} │ ${col(`$${LLM_PRICING.HAIKU_OR_MINI.toFixed(2)} / 1M`, 18)} │ ${col(`$${summary.dollarSavings.haikuOrMini.toFixed(2)}`, 16, chalk.green)} │`
  );
  console.log(makeSeparator('└', '┴', '┘', modelCols) + '\n');

  // Section 2: Token Reduction Breakdown
  const tokenCols = [24, 18, 24];
  console.log(chalk.bold.yellow(makeHeader('📊 TOKEN REDUCTION BREAKDOWN', tokenCols)));
  console.log(
    `  │ ${col('Source', 24, chalk.bold)} │ ${col('Tokens Saved', 18, chalk.bold)} │ ${col('Details', 24, chalk.bold)} │`
  );
  console.log(makeSeparator('├', '┼', '┤', tokenCols));
  console.log(
    `  │ ${col('Schema Pruning', 24)} │ ${col(summary.schemaPruningTokensSaved.toLocaleString(), 18, chalk.green)} │ ${col(`${Math.max(0, summary.totalCatalogToolsCount - summary.exposedToolsCount)} tools hidden/turn`, 24, chalk.dim)} │`
  );
  console.log(
    `  │ ${col('Response Cache', 24)} │ ${col(summary.cacheTokensSaved.toLocaleString(), 18, chalk.green)} │ ${col(`${summary.cachedCalls} read calls cached`, 24, chalk.dim)} │`
  );
  console.log(
    `  │ ${col('Loop Prevention', 24)} │ ${col(summary.loopPreventionTokensSaved.toLocaleString(), 18, chalk.green)} │ ${col(`${summary.loopsPrevented} runaway loops stopped`, 24, chalk.dim)} │`
  );
  console.log(makeSeparator('└', '┴', '┘', tokenCols) + '\n');

  // Section 3: Performance & Reliability
  const trackingSince = summary.firstRecordedAt > 0
    ? new Date(summary.firstRecordedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Session start';

  const perfCols = [26, 43];
  console.log(chalk.bold.yellow(makeHeader('⚡ PROXY PERFORMANCE & RELIABILITY', perfCols)));
  console.log(`  │ ${col('Total Proxied Calls:', 26)} │ ${col(String(summary.totalCalls), 43, chalk.bold)} │`);
  console.log(
    `  │ ${col('Cache Hit Efficiency:', 26)} │ ${col(`${summary.cacheHitRatePct}% (${summary.cachedCalls} cached / ${summary.totalCalls} calls)`, 43, chalk.bold)} │`
  );
  console.log(`  │ ${col('Avg Execution Latency:', 26)} │ ${col(`${summary.averageLatencyMs} ms`, 43, chalk.bold)} │`);
  console.log(
    `  │ ${col('Tripped Loops / Errors:', 26)} │ ${col(
      summary.loopsPrevented > 0 || summary.errorCalls > 0
        ? `${summary.loopsPrevented} loops / ${summary.errorCalls} errors`
        : '0 loops / 0 errors',
      43,
      summary.loopsPrevented > 0 || summary.errorCalls > 0 ? chalk.red : chalk.green
    )} │`
  );
  console.log(`  │ ${col('Metrics Tracking Since:', 26)} │ ${col(trackingSince, 43, chalk.dim)} │`);
  console.log(makeSeparator('└', '┴', '┘', perfCols) + '\n');

  console.log(
    chalk.dim(
      '  Tip: Run "contextwise stats --reset" to clear counters or "--json" for raw exports.\n'
    )
  );
}
