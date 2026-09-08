import { createHash } from 'node:crypto';

/**
 * Deterministically stringifies an object by sorting its keys recursively.
 */
export function canonicalJsonStringify(obj: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (obj === null || obj === undefined) {
    return 'null';
  }

  if (typeof obj === 'bigint') {
    return `"${obj.toString()}"`;
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj) ?? 'null';
  }

  if (seen.has(obj)) {
    return '"[Circular]"';
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalJsonStringify(item, seen)).join(',') + ']';
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key], seen)}`
  );

  return '{' + pairs.join(',') + '}';
}

/**
 * Computes SHA-256 hash of a string.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generates a content-addressable cache key for tool invocations.
 */
export function generateToolCallCacheKey(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> = {}
): string {
  const canonicalArgs = canonicalJsonStringify(args);
  return sha256(`${serverName}:${toolName}:${canonicalArgs}`);
}
