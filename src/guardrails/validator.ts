import { createHash } from 'node:crypto';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { logger } from '../utils/logger.js';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class ToolArgumentValidator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ajv: any;
  private validatorCache: Map<string, ValidateFunction> = new Map();

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AjvClass = (Ajv as any).default || Ajv;
    this.ajv = new AjvClass({
      allErrors: true,
      strict: false,
      coerceTypes: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addFormatsFn = (addFormats as any).default || addFormats;
    addFormatsFn(this.ajv);
  }

  private computeSchemaHash(schema: unknown): string {
    try {
      return createHash('sha256')
        .update(JSON.stringify(schema ?? ''))
        .digest('hex')
        .slice(0, 16);
    } catch {
      return 'static';
    }
  }

  /**
   * Pre-flight validates tool arguments against the tool's inputSchema.
   */
  validate(toolName: string, schema: unknown, args: unknown): ValidationResult {
    if (!schema || typeof schema !== 'object') {
      return { valid: true };
    }

    try {
      const cacheKey = `${toolName}:${this.computeSchemaHash(schema)}`;
      let validateFn = this.validatorCache.get(cacheKey);
      if (!validateFn) {
        const compiled = this.ajv.compile(schema as Record<string, unknown>);
        this.validatorCache.set(cacheKey, compiled);
        validateFn = compiled;
      }

      if (!validateFn) {
        return { valid: true };
      }

      const valid = validateFn(args);
      if (!valid && validateFn.errors) {
        const errorMessages = validateFn.errors.map(
          (err: { instancePath?: string; message?: string }) =>
            `${err.instancePath || 'arguments'} ${err.message || 'is invalid'}`
        );
        logger.debug(`Validation failed for tool ${toolName}:`, errorMessages);
        return {
          valid: false,
          errors: errorMessages,
        };
      }

      return { valid: true };
    } catch (err) {
      // If schema compilation fails, log and allow call to proceed to upstream
      logger.warn(`Schema compilation failed for tool ${toolName}: ${err}`);
      return { valid: true };
    }
  }

  clearCache(): void {
    this.validatorCache.clear();
  }
}

export const argumentValidator = new ToolArgumentValidator();
