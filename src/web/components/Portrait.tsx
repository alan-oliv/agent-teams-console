import { themeFor } from '../../shared/cast';
import {
  parseLook,
  portraitFor,
  portraitSvg,
  TERMINAL_SPRITE,
  TERMINAL_SPRITE_SVG,
  type FilmPaint,
} from '../../shared/portrait';
import { useCast } from '../state/useCast';
import { activePalette, useAppearance } from '../state/useSettings';
import { THEMES } from '../themes';

export type PortraitSlot = 'wall' | 'rail-row' | 'default';

const SLOT_MARGIN: Record<PortraitSlot, number> = { wall: 3, 'rail-row': 1, default: 0 };

export interface PortraitProps {
  agent: { name: string; agentType: string; isLead: boolean };
  slot?: PortraitSlot;
  /**
   * Rendered edge, in px. The sprite is a 12x12 viewBox, so scaling the whole
   * thing keeps the pixel grid square at any size; shrinking the pixels without
   * their offset step is what leaves sub-pixel gaps and stripes the face.
   */
  size?: number;
}

export function Portrait({ agent, slot = 'default', size = 24 }: PortraitProps) {
  const appearance = useAppearance();
  const cast = useCast();
  const { portrait, skinIndex } = portraitFor(agent);
  // Nothing at all, not a blank box: the rows close up around the missing face.
  if (!appearance.avatars) return null;

  // The look follows the slot the CAST assigned, not the portrait the sprite
  // hashed: an agent that took a spare is one whose role could not be read, and
  // it keeps the default portrait rather than wearing a character's clothes.
  const role = cast.slotOf(agent.name);
  const theme = themeFor(appearance.movieTheme);
  const look = role ? parseLook(theme.looks?.[role]) : null;
  // Lifted against whatever ground is actually painted — the film's while its
  // palette drives, the system theme's when the switch is off. Portrait tints
  // survive that switch; only the ground they are read against changes.
  const film: FilmPaint | undefined =
    look && role
      ? {
          look,
          ground: activePalette(appearance)?.bg ?? (THEMES[appearance.theme] ?? THEMES.nocturne).bg,
          feats: theme.feats?.[role],
        }
      : undefined;

  return (
    <div
      data-testid="portrait"
      data-portrait={portrait}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        position: 'relative',
        flex: 'none',
        marginTop: SLOT_MARGIN[slot],
      }}
      dangerouslySetInnerHTML={{ __html: portraitSvg(portrait, skinIndex, film) }}
    />
  );
}

const TERMINAL_ASPECT = TERMINAL_SPRITE.length / TERMINAL_SPRITE[0].length; // 17/24

/**
 * The "left session" screen's sprite — same 2px pixel language, palette and
 * `avatars` toggle as the role portraits, but not one: nobody is dismissing an
 * agent, so it lives outside `portraitFor`'s agent-shaped API.
 */
export function TerminalSprite({ size = 144 }: { size?: number }) {
  const { avatars } = useAppearance();
  if (!avatars) return null;
  const height = size * TERMINAL_ASPECT;
  const scale = size / 144;
  return (
    <div
      data-testid="terminal-sprite"
      aria-hidden="true"
      style={{ width: size, height, position: 'relative', flex: 'none' }}
    >
      <div
        data-testid="terminal-sprite-glow"
        style={{
          position: 'absolute',
          left: -16 * scale,
          top: -10 * scale,
          width: 176 * scale,
          height: 122 * scale,
          borderRadius: '50%',
          background: 'radial-gradient(closest-side, var(--color-accent-900), transparent 72%)',
          opacity: 0.85,
        }}
      />
      <div
        style={{ position: 'absolute', top: 0, left: 0, width: size, height }}
        dangerouslySetInnerHTML={{ __html: TERMINAL_SPRITE_SVG }}
      />
    </div>
  );
}
