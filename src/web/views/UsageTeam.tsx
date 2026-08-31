import type { TeamState } from '../../shared/domain';

// Scaffold only — the real team-mode body is a separate task. Kept in its own
// file so that task can fill it in without ever touching the router.
export function UsageTeam({ state, now }: { state: TeamState; now: number }) {
  return (
    <div data-testid="usage" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 16px', color: 'var(--color-neutral-600)', fontSize: '11px' }}>
        usage — coming soon
      </div>
    </div>
  );
}
