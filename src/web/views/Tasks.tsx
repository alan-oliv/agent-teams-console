import { useState, type CSSProperties } from 'react';
import type { MailMessage, Task } from '../../shared/domain';
import { TASK_STATUS } from '../../shared/status';
import { clockLabel } from '../format';

const COLUMN_HEAD: CSSProperties = {
  display: 'flex',
  gap: '10px',
  padding: '10px 16px 8px',
  color: 'var(--color-neutral-700)',
  fontSize: '10.5px',
  letterSpacing: '.12em',
  borderBottom: '1px solid var(--color-neutral-900)',
};

// Headers over a blank pane read as broken, not as empty — a team that never
// touched the shared list looks exactly like a console that failed to read it.
// Same register as the rest of the chrome: `nothing waiting`, `no live teams`.
const EMPTY: CSSProperties = {
  padding: '14px 16px',
  color: 'var(--color-neutral-700)',
  fontSize: '11px',
};

const FOOTER: CSSProperties = {
  borderTop: '1px solid var(--color-neutral-900)',
  padding: '9px 16px',
  display: 'flex',
  gap: '14px',
  color: 'var(--color-neutral-700)',
  fontSize: '10.5px',
};

export function Tasks({
  tasks, mail, teamName,
}: {
  tasks: Task[];
  mail: MailMessage[];
  teamName: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div data-testid="tasks" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--color-neutral-900)',
        }}
      >
        <div style={COLUMN_HEAD}>
          <span style={{ width: '44px' }}>TASK</span>
          <span style={{ flex: 1 }}>DESCRIPTION</span>
          <span style={{ width: '92px' }}>STATE</span>
          <span style={{ width: '80px' }}>OWNER</span>
          <span style={{ width: '88px' }}>DEPENDS ON</span>
        </div>

        <div
          className="tscroll"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          {tasks.map((task) => {
            const state = TASK_STATUS[task.state];
            return (
              <div
                key={task.id}
                data-testid="task-row"
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'baseline',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--row-hairline)',
                  fontSize: '11.5px',
                  background: hovered === task.id ? 'var(--color-bg)' : 'transparent',
                }}
                onMouseEnter={() => setHovered(task.id)}
                onMouseLeave={() => setHovered((h) => (h === task.id ? null : h))}
              >
                <span style={{ width: '44px', color: 'var(--color-neutral-600)' }}>{task.id}</span>
                <span
                  data-testid="task-description"
                  style={{
                    flex: 1,
                    color: 'var(--color-neutral-300)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {task.subject}
                </span>
                <span
                  data-testid="task-state"
                  style={{
                    width: '92px',
                    display: 'flex',
                    gap: '5px',
                    alignItems: 'baseline',
                    color: state.color,
                  }}
                >
                  <span style={{ fontSize: '10px' }}>{state.glyph}</span>
                  <span>{state.label}</span>
                </span>
                <span data-testid="task-owner" style={{ width: '80px', color: 'var(--color-neutral-500)' }}>
                  {task.owner ?? 'unassigned'}
                </span>
                <span data-testid="task-deps" style={{ width: '88px', color: 'var(--color-neutral-700)' }}>
                  {task.blockedBy.length > 0 ? task.blockedBy.join(' ') : '—'}
                </span>
              </div>
            );
          })}

          {tasks.length === 0 && (
            <div data-testid="tasks-empty" style={EMPTY}>
              no tasks — this team hasn&apos;t used the shared list
            </div>
          )}
        </div>

        <div data-testid="tasks-footer" style={FOOTER}>
          <span>{`~/.claude/tasks/${teamName}/`}</span>
          <span style={{ flex: 1 }} />
          <span>claiming is file-locked · completing a task unblocks its dependents</span>
        </div>
      </div>

      <div
        data-testid="mailbox"
        style={{ width: '404px', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}
      >
        <div
          style={{
            padding: '10px 14px 8px',
            color: 'var(--color-neutral-700)',
            fontSize: '10.5px',
            letterSpacing: '.12em',
            borderBottom: '1px solid var(--color-neutral-900)',
          }}
        >
          MAILBOX TRAFFIC
        </div>

        <div
          className="tscroll tail"
          style={{
            flex: 1,
            minHeight: 0,
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
          }}
        >
          {mail.map((m) => (
            <div
              key={m.msgId}
              data-testid="mail-entry"
              style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
            >
              <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', fontSize: '10.5px' }}>
                <span
                  data-testid="mail-ts"
                  title={m.tsIsDelivery ? 'delivery time — send time unknown' : undefined}
                  style={{ color: 'var(--color-neutral-800)' }}
                >
                  {`${m.tsIsDelivery ? '~' : ''}${clockLabel(m.ts)}`}
                </span>
                <span data-testid="mail-from" style={{ color: 'var(--color-accent-400)' }}>{m.from}</span>
                <span style={{ color: 'var(--color-neutral-700)' }}>→</span>
                <span data-testid="mail-to" style={{ color: 'var(--color-accent-400)' }}>{m.to}</span>
              </div>
              <div
                data-testid="mail-body"
                style={{
                  color: 'var(--color-neutral-500)',
                  fontSize: '11.5px',
                  paddingLeft: '2px',
                  textWrap: 'pretty',
                }}
              >
                {m.protocol ? m.protocol.type : m.text}
              </div>
            </div>
          ))}

          {mail.length === 0 && (
            <div data-testid="mailbox-empty" style={{ ...EMPTY, padding: 0 }}>
              no messages yet
            </div>
          )}
        </div>

        <div
          data-testid="mailbox-footer"
          style={{
            borderTop: '1px solid var(--color-neutral-900)',
            padding: '9px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            color: 'var(--color-neutral-700)',
            fontSize: '10.5px',
          }}
        >
          <span>{`~/.claude/teams/${teamName}/inboxes/`}</span>
          <span>teammates message each other directly — the lead doesn&apos;t relay</span>
        </div>
      </div>
    </div>
  );
}
