import { portraitFor, portraitSvg } from '../../shared/portrait';

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
  const { portrait, skinIndex } = portraitFor(agent);
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
