import { describe, it, expect } from 'vitest';
import { createPermits, autoDenyReason } from './permits';

describe('createPermits', () => {
  it('auto-denies at 90% of the hook timeout with a stated reason', async () => {
    const permits = createPermits();
    const before = Date.now();
    const held = permits.hold('probe-alpha', 'Bash', { command: 'rm -rf /' }, 100);

    const listed = permits.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: held.id, agent: 'probe-alpha', toolName: 'Bash' });
    expect(listed[0].input).toEqual({ command: 'rm -rf /' });
    expect(listed[0].expiresAt).toBeGreaterThanOrEqual(before + 90);
    expect(listed[0].expiresAt).toBeLessThanOrEqual(before + 120);

    expect(await held.promise).toEqual({
      decision: 'deny',
      reason: 'auto-denied after 90ms with no operator response',
    });
    expect(permits.list()).toEqual([]);
    expect(Date.now() - before).toBeGreaterThanOrEqual(85);
  });

  it('resolves on an operator decision and forgets the hold', async () => {
    const permits = createPermits();
    const held = permits.hold('probe-bravo', 'Write', { file_path: '/tmp/x' }, 600000);
    expect(permits.resolve(held.id, 'allow')).toBe(true);
    expect(await held.promise).toEqual({ decision: 'allow', reason: undefined });
    expect(permits.list()).toEqual([]);
    expect(permits.resolve(held.id, 'deny')).toBe(false);
  });

  it('carries an operator deny reason through', async () => {
    const permits = createPermits();
    const held = permits.hold('probe-charlie', 'Bash', {}, 600000);
    permits.resolve(held.id, 'deny', 'not touching migrations');
    expect(await held.promise).toEqual({ decision: 'deny', reason: 'not touching migrations' });
  });

  it('keeps concurrent holds independent', async () => {
    const permits = createPermits();
    const a = permits.hold('probe-alpha', 'Bash', {}, 600000);
    const b = permits.hold('probe-bravo', 'Edit', {}, 600000);
    expect(permits.list()).toHaveLength(2);
    permits.resolve(b.id, 'deny', 'no');
    expect(await b.promise).toEqual({ decision: 'deny', reason: 'no' });
    expect(permits.list().map((p) => p.id)).toEqual([a.id]);
    permits.resolve(a.id, 'allow');
    await a.promise;
  });

  it('states the exact auto-deny reason', () => {
    expect(autoDenyReason(600000)).toBe('auto-denied after 540000ms with no operator response');
  });
});
