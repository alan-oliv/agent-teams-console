import { createContext, useContext } from 'react';
import { elapsedLabel } from '../format';

// The clock advances once a second. Handing it to the memoised per-agent units as a
// prop invalidated every one of them on every tick; a context reaches the leaf that
// actually shows a duration without re-rendering the unit that contains it.
export const NowContext = createContext(0);

export function Elapsed({ startedAt }: { startedAt: number }) {
  return elapsedLabel(startedAt, useContext(NowContext));
}
