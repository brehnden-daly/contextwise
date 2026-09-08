import { describe, it, expect } from 'vitest';
import { ToolArgumentValidator } from '../../src/guardrails/validator.js';

describe('ToolArgumentValidator', () => {
  const validator = new ToolArgumentValidator();

  const sampleSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      maxLines: { type: 'number', description: 'Max lines to read' },
      encoding: { type: 'string', enum: ['utf-8', 'ascii'] },
    },
    required: ['path'],
  };

  it('should validate valid arguments successfully', () => {
    const res = validator.validate('read_file', sampleSchema, {
      path: '/home/user/test.txt',
      maxLines: 100,
      encoding: 'utf-8',
    });

    expect(res.valid).toBe(true);
    expect(res.errors).toBeUndefined();
  });

  it('should fail when required property is missing', () => {
    const res = validator.validate('read_file', sampleSchema, {
      maxLines: 50,
    });

    expect(res.valid).toBe(false);
    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]).toContain('required');
  });

  it('should fail when enum restriction is violated', () => {
    const res = validator.validate('read_file', sampleSchema, {
      path: 'test.txt',
      encoding: 'invalid-encoding',
    });

    expect(res.valid).toBe(false);
    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]).toContain('must be equal to one of the allowed values');
  });

  it('should pass gracefully when schema is empty or missing', () => {
    const res1 = validator.validate('no_schema', undefined, { any: 'thing' });
    expect(res1.valid).toBe(true);

    const res2 = validator.validate('empty_schema', {}, { any: 'thing' });
    expect(res2.valid).toBe(true);
  });
});
