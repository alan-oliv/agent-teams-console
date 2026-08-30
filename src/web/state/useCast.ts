import { createContext, useContext } from 'react';
import { buildCast, type Cast } from '../../shared/cast';

/**
 * The one cast every view renders through, built once from the wall's roster
 * order. Once, and from that order, because `buildCast` hands out the theme's
 * spare characters in the order it is given the roster: a view building its own
 * from a differently sorted list would put a different character on the same
 * agent, and a theme is only learnable while a role keeps its name.
 *
 * The default is the identity mapping, which is also what workflow mode gets —
 * a run forms no team, so it has no roster to cast.
 */
export const CastContext = createContext<Cast>(buildCast([], null));

export function useCast(): Cast {
  return useContext(CastContext);
}
