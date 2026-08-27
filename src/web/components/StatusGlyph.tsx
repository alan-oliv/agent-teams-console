import type { AgentStatus } from '../../shared/domain';
import { AGENT_STATUS } from '../../shared/status';

export interface StatusGlyphProps {
  status: AgentStatus;
  size?: number;
}

export function StatusGlyph({ status, size = 11 }: StatusGlyphProps) {
  const style = AGENT_STATUS[status];
  return (
    <span
      data-testid="status-glyph"
      role="img"
      aria-label={style.label}
      style={{ color: style.color, fontSize: size }}
    >
      {style.glyph}
    </span>
  );
}
