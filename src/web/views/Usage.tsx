import type { TeamState, WorkflowRun } from '../../shared/domain';
import type { SpendSample } from './usage-team';
import { UsageTeam } from './UsageTeam';
import { WorkflowUsage } from './WorkflowUsage';

// The one thing both switchers mount at the `usage` pill. It only dispatches —
// the team-mode and workflow-mode bodies are owned by separate tasks, and this
// is the seam that lets them be built (and later edited) without touching one
// another.
export type UsageProps =
  | {
      mode: 'team';
      state: TeamState;
      now: number;
      focused: string | null;
      onFocus: (name: string) => void;
      spendSamples: readonly SpendSample[];
    }
  | { mode: 'workflow'; run: WorkflowRun; now: number };

export function Usage(props: UsageProps) {
  return props.mode === 'team'
    ? (
      <UsageTeam
        state={props.state}
        now={props.now}
        focused={props.focused}
        onFocus={props.onFocus}
        spendSamples={props.spendSamples}
      />
    )
    : <WorkflowUsage run={props.run} now={props.now} />;
}
