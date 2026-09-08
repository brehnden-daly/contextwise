import { describe, it, expect, beforeEach } from 'vitest';
import { RunawayLoopBreaker } from '../../src/guardrails/loop_breaker.js';

describe('RunawayLoopBreaker', () => {
  let loopBreaker: RunawayLoopBreaker;

  beforeEach(() => {
    loopBreaker = new RunawayLoopBreaker({
      maxCallsPerMinute: 10,
      consecutiveFailureThreshold: 3,
    });
  });

  it('should allow normal calls within velocity limits', () => {
    const error = loopBreaker.checkPreFlight('server1', 'tool1', { a: 1 });
    expect(error).toBeNull();
  });

  it('should trip circuit breaker after 3 consecutive failures with identical args', () => {
    const args = { query: 'SELECT * FROM non_existent_table' };

    // 1st failure
    expect(loopBreaker.checkPreFlight('postgres', 'query', args)).toBeNull();
    loopBreaker.recordCall('postgres', 'query', args, true);

    // 2nd failure
    expect(loopBreaker.checkPreFlight('postgres', 'query', args)).toBeNull();
    loopBreaker.recordCall('postgres', 'query', args, true);

    // 3rd failure
    expect(loopBreaker.checkPreFlight('postgres', 'query', args)).toBeNull();
    loopBreaker.recordCall('postgres', 'query', args, true);

    // 4th attempt: circuit breaker must be tripped!
    const error = loopBreaker.checkPreFlight('postgres', 'query', args);
    expect(error).not.toBeNull();
    expect(error).toContain('Circuit breaker tripped');
    expect(error).toContain('failed 3 consecutive times');
  });

  it('should allow call if arguments are changed after failures', () => {
    const badArgs = { query: 'BAD' };
    const goodArgs = { query: 'SELECT 1' };

    loopBreaker.recordCall('postgres', 'query', badArgs, true);
    loopBreaker.recordCall('postgres', 'query', badArgs, true);
    loopBreaker.recordCall('postgres', 'query', badArgs, true);

    // Bad args are blocked
    expect(loopBreaker.checkPreFlight('postgres', 'query', badArgs)).not.toBeNull();

    // Changed args are permitted
    expect(loopBreaker.checkPreFlight('postgres', 'query', goodArgs)).toBeNull();
  });

  it('should reset failure streak on success', () => {
    const args = { query: 'SELECT 1' };

    loopBreaker.recordCall('postgres', 'query', args, true);
    loopBreaker.recordCall('postgres', 'query', args, true);
    // Success on 3rd call
    loopBreaker.recordCall('postgres', 'query', args, false);

    // Streak should be reset, call should still be allowed
    expect(loopBreaker.checkPreFlight('postgres', 'query', args)).toBeNull();
  });

  it('should enforce velocity rate limits', () => {
    for (let i = 0; i < 10; i++) {
      expect(loopBreaker.checkPreFlight('srv', `tool_${i}`, {})).toBeNull();
      loopBreaker.recordCall('srv', `tool_${i}`, {}, false);
    }

    // 11th call exceeds maxCallsPerMinute (10)
    const rateLimitError = loopBreaker.checkPreFlight('srv', 'tool_11', {});
    expect(rateLimitError).not.toBeNull();
    expect(rateLimitError).toContain('Rate limit exceeded');
  });
});
