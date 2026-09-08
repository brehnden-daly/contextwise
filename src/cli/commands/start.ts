import { ConfigLoader } from '../../config/loader.js';
import { ContextWiseProxy } from '../../core/proxy.js';
import { logger } from '../../utils/logger.js';

export interface StartCommandOptions {
  config?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  passthrough?: boolean;
}

export async function startCommand(options: StartCommandOptions): Promise<void> {
  try {
    const config = ConfigLoader.load({
      configPath: options.config,
    });

    if (options.logLevel) {
      config.proxy.logLevel = options.logLevel;
    }

    if (options.passthrough) {
      config.routing.strategy = 'passthrough';
    }

    const proxy = new ContextWiseProxy();
    let isShuttingDown = false;

    const cleanup = async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      // Unref'd fallback timer to guarantee exit if upstream stop hangs
      setTimeout(() => process.exit(0), 3000).unref();

      try {
        await proxy.stop();
      } catch (err) {
        logger.error(`Error stopping ContextWise proxy: ${err}`);
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    await proxy.start(config);

    // Keep process alive for stdio transport
    process.stdin.resume();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`ContextWise proxy failed to start: ${msg}`);
    process.exit(1);
  }
}
