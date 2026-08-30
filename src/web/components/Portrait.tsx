import { portraitFor, portraitSvg, TERMINAL_SPRITE, TERMINAL_SPRITE_SVG } from '../../shared/portrait';
import { useAppearance } from '../state/useSettings';

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
  const { avatars } = useAppearance();
  const { portrait, skinIndex } = portraitFor(agent);
  // Nothing at all, not a blank box: the rows close up around the missing face.
  if (!avatars) return null;
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
      dangerouslySetInnerHTML={{ __html: portraitSvg(portrait, skinIndex) }}
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
