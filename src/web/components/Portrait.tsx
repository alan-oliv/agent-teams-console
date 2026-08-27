import { portraitFor, portraitSvg } from '../../shared/portrait';

export type PortraitSlot = 'wall' | 'rail-row' | 'default';

const SLOT_MARGIN: Record<PortraitSlot, number> = { wall: 3, 'rail-row': 1, default: 0 };

export interface PortraitProps {
  agent: { name: string; agentType: string; isLead: boolean };
  slot?: PortraitSlot;
}

export function Portrait({ agent, slot = 'default' }: PortraitProps) {
  const { portrait, skinIndex } = portraitFor(agent);
  return (
    <div
      data-testid="portrait"
      data-portrait={portrait}
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        position: 'relative',
        flex: 'none',
        marginTop: SLOT_MARGIN[slot],
      }}
      dangerouslySetInnerHTML={{ __html: portraitSvg(portrait, skinIndex) }}
    />
  );
}
