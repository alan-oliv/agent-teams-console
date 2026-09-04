import { describe, expect, it } from 'vitest';
import { parseHidden } from './useHiddenSessions';

describe('parseHidden', () => {
  it('reads back the names it stored', () => {
    expect([...parseHidden('["session-a","session-b"]')]).toEqual(['session-a', 'session-b']);
  });

  it('hides nothing when there is no stored value', () => {
    expect(parseHidden(null).size).toBe(0);
  });

  it('hides nothing rather than throwing on a blob that is not JSON', () => {
    expect(parseHidden('{{{').size).toBe(0);
  });

  // Failing toward "show too much" is deliberate: a picker that silently
  // swallowed a live session is far worse than one that forgot a dismissal.
  it('hides nothing when the stored value is not an array', () => {
    expect(parseHidden('{"session-a":true}').size).toBe(0);
  });

  it('drops non-string and empty entries rather than hiding a blank name', () => {
    expect([...parseHidden('["session-a",7,null,"",{"a":1},"session-b"]')]).toEqual([
      'session-a',
      'session-b',
    ]);
  });
});
