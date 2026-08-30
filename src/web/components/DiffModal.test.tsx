// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Diff } from '../../shared/domain';
import { buildCast } from '../../shared/cast';
import { CastContext } from '../state/useCast';
import { DiffModal } from './DiffModal';

afterEach(cleanup);

const DIFF: Diff = {
  path: 'src/web/state/useTeamState.ts',
  added: 14,
  removed: 2,
  agent: 'lead',
  ts: Date.parse('2026-08-27T14:22:08.000Z'),
  commit: '9be5ee0',
  hunks: [
    {
      header: '@@ -146,10 +146,24 @@ export function useTeamState(',
      lines: [{ sign: ' ', oldLineNo: 146, newLineNo: 146, text: '  const [selected] = useState();' }],
    },
  ],
};

// Two changed rows survived a 300-line cap on a patch of 350.
const TRUNCATED: Diff = {
  ...DIFF,
  added: 210,
  removed: 140,
  truncated: true,
  hunks: [
    {
      header: '@@ -1,10 +1,24 @@',
      lines: [
        { sign: ' ', oldLineNo: 1, newLineNo: 1, text: 'const a = 1;' },
        { sign: '-', oldLineNo: 2, newLineNo: null, text: 'const b = 2;' },
        { sign: '+', oldLineNo: null, newLineNo: 2, text: 'const b = 3;' },
      ],
    },
  ],
};

// `flexibleChild` is the one item allowed to shrink below its content —
// diff-path, which ellipsises instead. Every other non-spacer child must
// refuse to shrink at all.
function assertUnshrinkable(testId: string, flexibleChild?: string) {
  const row = screen.getByTestId(testId);
  expect(row.style.flexWrap).toBe('');
  const spacers = [...row.children].filter((c) => (c as HTMLElement).style.flex === '1 1 0%');
  expect(spacers).toHaveLength(1);
  for (const child of row.children) {
    const el = child as HTMLElement;
    if (el === spacers[0]) continue;
    if (flexibleChild && el.dataset.testid === flexibleChild) continue;
    expect([el.textContent, el.style.flex]).toEqual([el.textContent, '0 0 auto']);
  }
}

describe('DiffModal', () => {
  it('renders nothing when no diff is open', () => {
    const { container } = render(<DiffModal diff={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('is a full-console scrim behind a centred card', () => {
    render(<DiffModal diff={DIFF} onClose={() => {}} />);
    const scrim = screen.getByTestId('diff-modal');
    expect(scrim.style.position).toBe('absolute');
    expect(scrim.style.inset).toBe('0');
    expect(scrim.style.zIndex).toBe('60');
    expect(scrim.style.background).toBe('rgba(0, 0, 0, 0.62)');
    expect(scrim.style.padding).toBe('28px');
    expect(scrim.style.display).toBe('flex');
    expect(scrim.style.alignItems).toBe('center');
    expect(scrim.style.justifyContent).toBe('center');
  });

  it('sizes the card and gives it its own elevation', () => {
    render(<DiffModal diff={DIFF} onClose={() => {}} />);
    const card = screen.getByTestId('diff-card');
    expect(card.style.width).toBe('1020px');
    expect(card.style.maxWidth).toBe('100%');
    expect(card.style.maxHeight).toBe('600px');
    expect(card.style.background).toBe('var(--color-bg)');
    expect(card.style.border).toBe('1px solid var(--color-neutral-800)');
    expect(card.style.borderRadius).toBe('var(--radius-md)');
    expect(card.style.boxShadow).toBe('0 30px 80px rgba(0,0,0,.7)');
    expect(card.style.overflow).toBe('hidden');
    expect(card.style.display).toBe('flex');
    expect(card.style.flexDirection).toBe('column');
  });

  describe('header', () => {
    it('derives the path, stat and meta from the payload rather than hard-coding them', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      expect(screen.getByTestId('diff-path').textContent).toBe(DIFF.path);
      expect(screen.getByTestId('diff-stat').textContent).toBe('+14 −2');
      expect(screen.getByTestId('diff-stat').style.color).toBe('var(--json-string)');
      expect(screen.getByTestId('diff-meta').textContent).toBe('lead · 14:22:08 · 9be5ee0');
    });

    // The agent that made the edit is a name, so it is cast; the path, the
    // stat and the sha are the patch itself and never move.
    it('casts the agent in the meta, and nothing else in it', () => {
      const roster = [{ name: 'lead', agentType: 'team-lead', isLead: true }];
      render(
        <CastContext.Provider value={buildCast(roster, 'inception')}>
          <DiffModal diff={DIFF} onClose={() => {}} />
        </CastContext.Provider>,
      );
      expect(screen.getByTestId('diff-meta').textContent).toBe('Cobb · 14:22:08 · 9be5ee0');
    });

    it('leaves the sha out of the meta for an uncommitted edit', () => {
      const uncommitted: Diff = { ...DIFF, commit: undefined };
      render(<DiffModal diff={uncommitted} onClose={() => {}} />);
      expect(screen.getByTestId('diff-meta').textContent).toBe('lead · 14:22:08');
    });

    it('ellipsises a long path rather than pushing the meta off the card', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      const path = screen.getByTestId('diff-path');
      expect(path.style.overflow).toBe('hidden');
      expect(path.style.textOverflow).toBe('ellipsis');
      expect(path.style.whiteSpace).toBe('nowrap');
    });

    it('closes on the ✕', () => {
      const onClose = vi.fn();
      render(<DiffModal diff={DIFF} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('diff-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // Same rule as the status bar (StatusBar.test.tsx): a child that can shrink
  // wraps its text instead, doubling the row's height at a narrow card width.
  // Every child but the spacer must be unshrinkable; jsdom does no layout, so
  // this is the CSS-level guarantee rather than a measured screenshot.
  describe('header, toolbar and footer never wrap', () => {
    it('holds the header to one line', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      assertUnshrinkable('diff-header', 'diff-path');
    });

    it('holds the toolbar to one line', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      assertUnshrinkable('diff-toolbar');
    });

    it('holds the footer to one line', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      assertUnshrinkable('diff-footer');
    });
  });

  describe('toolbar', () => {
    // The prototype tracks `diffSplit` and computes a width from it, but no
    // markup ever reads it — there is no side-by-side layout to build against,
    // and inventing one is a screen the design does not specify. The toggle
    // changed only its own highlight, which the design rates as worse than
    // absent. It comes back with a real spec or not at all.
    it('offers no layout toggle, having only one layout', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      expect(screen.queryByTestId('diff-layout-unified')).toBeNull();
      expect(screen.queryByTestId('diff-layout-split')).toBeNull();
      const toolbar = screen.getByTestId('diff-toolbar');
      expect(toolbar.textContent).not.toContain('unified');
      expect(toolbar.textContent).not.toContain('split');
    });

    it('counts the hunks, pluralising past one', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      expect(screen.getByTestId('diff-hunk-count').textContent).toBe('1 hunk · whitespace shown');
      const two: Diff = { ...DIFF, hunks: [DIFF.hunks[0], DIFF.hunks[0]] };
      render(<DiffModal diff={two} onClose={() => {}} />);
      expect(screen.getAllByTestId('diff-hunk-count')[1].textContent).toBe('2 hunks · whitespace shown');
    });

    it('offers copy patch', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      expect(screen.getByTestId('diff-copy').textContent).toBe('copy patch');
    });

    // The server exposes select, shutdown, agent message/interrupt/stop/respawn,
    // plans, permits and history — nothing that can reach an editor. The button
    // would be decorative, which the design rates as worse than absent; the same
    // call `respawn` and the in-flight badge already make.
    it('does not offer open in editor, which the runtime cannot do', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      expect(screen.queryByTestId('diff-open-editor')).toBeNull();
      expect(screen.getByTestId('diff-toolbar').textContent).not.toContain('open in editor');
    });

    // With the toggle and `open in editor` gone the row was left with nothing
    // on its left at all. The design rebalances it: what the patch IS on the
    // left, the one thing you can DO with it on the right.
    it('reads left to right: what the patch is, then what you can do with it', () => {
      render(<DiffModal diff={TRUNCATED} onClose={() => {}} />);
      const toolbar = screen.getByTestId('diff-toolbar');
      const ids = [...toolbar.children].map((c) => (c as HTMLElement).dataset.testid);
      expect(ids).toEqual([
        'diff-hunk-count',
        'diff-relative-note',
        'diff-truncation',
        undefined, // the spacer
        'diff-copy',
      ]);
    });

    // The numbers come from the Edit tool's own old_string/new_string, which
    // carry no file position, so they start at 1 and count the snippet. Saying
    // so is the difference between a number and a wrong number.
    it('says the line numbers are relative to the snippet', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      expect(screen.getByTestId('diff-relative-note').textContent).toBe(
        'line numbers are snippet-relative',
      );
    });
  });

  // Until now `truncated` reached only the copy path: the patch you pasted
  // announced itself as partial, but nothing on screen did, so the rows just
  // stopped and `+210 −140` above them looked like a miscount.
  describe('truncation', () => {
    it('says nothing at all about truncation on a whole patch', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      expect(screen.queryByTestId('diff-truncation')).toBeNull();
      expect(screen.getByTestId('diff-footer').textContent).not.toContain('will not apply');
    });

    it('counts the shown lines against the whole patch, in the warn colour', () => {
      render(<DiffModal diff={TRUNCATED} onClose={() => {}} />);
      const chip = screen.getByTestId('diff-truncation');
      expect(chip.textContent).toBe('2 of 350 changed lines shown');
      expect(chip.style.color).toBe('var(--warn)');
      expect(chip.style.border).toBe('1px solid var(--warn-edge)');
    });

    // The header stat counts the patch, not the rows, so it can legitimately
    // exceed what is below it — the chip is what explains the gap.
    it('leaves the header stat counting the whole patch', () => {
      render(<DiffModal diff={TRUNCATED} onClose={() => {}} />);
      expect(screen.getByTestId('diff-stat').textContent).toBe('+210 −140');
    });

    it('warns in the footer that the copied patch will not apply', () => {
      render(<DiffModal diff={TRUNCATED} onClose={() => {}} />);
      const note = screen.getByTestId('diff-truncated-note');
      expect(note.textContent).toBe('the copied patch is incomplete — it will not apply');
      expect(note.style.color).toBe('var(--warn)');
    });

    it('still holds the toolbar and footer to one line when truncated', () => {
      render(<DiffModal diff={TRUNCATED} onClose={() => {}} />);
      assertUnshrinkable('diff-toolbar');
      assertUnshrinkable('diff-footer');
    });
  });

  it('scrolls the hunk rows on the terminal ground', () => {
    render(<DiffModal diff={DIFF} onClose={() => {}} />);
    const body = screen.getByTestId('diff-body');
    expect(body.style.flex).toBe('1 1 0%');
    expect(body.style.background).toBe('var(--term)');
  });

  // `.tail` is how this codebase bottom-anchors a pane, and it belongs to
  // streams. A patch reads top-down, so the body scrolls without it — the same
  // call TranscriptFeed already makes for the JSON drawer.
  it('does not bottom-anchor the patch', () => {
    render(<DiffModal diff={DIFF} onClose={() => {}} />);
    const body = screen.getByTestId('diff-body');
    expect(body.className).toBe('tscroll');
    expect(body.className).not.toContain('tail');
  });

  describe('unified body', () => {
    const MIXED: Diff = {
      ...DIFF,
      hunks: [
        {
          header: '@@ -146,10 +146,24 @@ export function useTeamState(',
          lines: [
            { sign: ' ', oldLineNo: 146, newLineNo: 146, text: '  const [selected] = useState();' },
            { sign: '-', oldLineNo: 149, newLineNo: null, text: '  const [widths] = useState({});' },
            { sign: '+', oldLineNo: null, newLineNo: 149, text: '  const [widths] = useState(read);' },
            { sign: ' ', oldLineNo: 150, newLineNo: 150, text: '' },
          ],
        },
        { header: '@@ -200,3 +214,3 @@', lines: [{ sign: '+', oldLineNo: null, newLineNo: 214, text: 'x' }] },
      ],
    };

    it('renders a header row per hunk and a row per line, in payload order', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const body = screen.getByTestId('diff-body');
      expect(within(body).getAllByTestId('diff-hunk-header')).toHaveLength(2);
      expect(within(body).getAllByTestId('diff-row')).toHaveLength(5);
      expect(Array.from(body.children).map((el) => el.getAttribute('data-testid'))).toEqual([
        'diff-hunk-header', 'diff-row', 'diff-row', 'diff-row', 'diff-row', 'diff-hunk-header', 'diff-row',
      ]);
    });

    it('gives a hunk header its own accent row, verbatim', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const header = within(screen.getByTestId('diff-body')).getAllByTestId('diff-hunk-header')[0];
      expect(header.textContent).toBe('@@ -146,10 +146,24 @@ export function useTeamState(');
      expect(header.style.background).toBe('var(--color-accent-900)');
      expect(header.style.color).toBe('var(--color-accent-300)');
      // Indented past both gutters and the sign so it starts on the code column.
      expect(header.style.paddingLeft).toBe('104px');
    });

    it('tints an added row and its gutters, and signs it with the theme green', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const added = within(screen.getByTestId('diff-body')).getAllByTestId('diff-row')[2];
      expect(added.style.background).toBe('rgba(126, 196, 146, 0.13)');
      const [oldNo, newNo, sign, text] = Array.from(added.children) as HTMLElement[];
      expect(oldNo.textContent).toBe('');
      expect(newNo.textContent).toBe('149');
      expect(oldNo.style.background).toBe('rgba(126, 196, 146, 0.1)');
      expect(newNo.style.background).toBe('rgba(126, 196, 146, 0.1)');
      expect(sign.textContent).toBe('+');
      expect(sign.style.color).toBe('var(--json-string)');
      expect(text.style.color).toBe('var(--color-text)');
    });

    it('tints a deleted row and signs it with the theme fail colour', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const deleted = within(screen.getByTestId('diff-body')).getAllByTestId('diff-row')[1];
      expect(deleted.style.background).toBe('rgba(200, 141, 141, 0.13)');
      const [oldNo, newNo, sign, text] = Array.from(deleted.children) as HTMLElement[];
      expect(oldNo.textContent).toBe('149');
      expect(newNo.textContent).toBe('');
      expect(oldNo.style.background).toBe('rgba(200, 141, 141, 0.1)');
      expect(sign.textContent).toBe('-');
      expect(sign.style.color).toBe('var(--fail)');
      expect(text.style.color).toBe('var(--color-text)');
    });

    it('leaves a context row untinted and quiet, carrying both line numbers', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const context = within(screen.getByTestId('diff-body')).getAllByTestId('diff-row')[0];
      expect(context.style.background).toBe('transparent');
      const [oldNo, newNo, sign, text] = Array.from(context.children) as HTMLElement[];
      expect(oldNo.textContent).toBe('146');
      expect(newNo.textContent).toBe('146');
      expect(oldNo.style.background).toBe('transparent');
      expect(sign.textContent).toBe('');
      expect(sign.style.color).toBe('var(--color-neutral-700)');
      expect(text.style.color).toBe('var(--color-neutral-400)');
    });

    // An empty <span> collapses to zero height and the row loses its line,
    // which breaks the alignment of every gutter number below it.
    it('keeps the height of an empty line with a single space', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const blank = within(screen.getByTestId('diff-body')).getAllByTestId('diff-row')[3];
      expect((blank.children[3] as HTMLElement).textContent).toBe(' ');
    });

    it('sizes the gutters, the sign column and the text to the design grid', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const row = within(screen.getByTestId('diff-body')).getAllByTestId('diff-row')[0];
      const [oldNo, newNo, sign, text] = Array.from(row.children) as HTMLElement[];
      for (const gutter of [oldNo, newNo]) {
        expect(gutter.style.width).toBe('44px');
        expect(gutter.style.textAlign).toBe('right');
        expect(gutter.style.paddingRight).toBe('9px');
        expect(gutter.style.fontSize).toBe('10px');
        // -700 measured 1.53–2.35:1 against its own gutter tint: a real defect.
        expect(gutter.style.color).toBe('var(--color-neutral-500)');
        expect(gutter.style.flex).toBe('0 0 auto'); // `flex: none`, as jsdom serialises it
      }
      expect(sign.style.width).toBe('16px');
      expect(sign.style.textAlign).toBe('center');
      expect(row.style.fontSize).toBe('11.5px');
      expect(row.style.lineHeight).toBe('1.72');
      expect(row.style.whiteSpace).toBe('pre');
      expect(text.style.paddingRight).toBe('16px');
      expect(text.style.overflow).toBe('hidden');
      expect(text.style.textOverflow).toBe('ellipsis');
    });

    it('renders an empty body for a patch whose hunks were all dropped', () => {
      render(<DiffModal diff={{ ...DIFF, hunks: [] }} onClose={() => {}} />);
      expect(screen.getByTestId('diff-body').children).toHaveLength(0);
    });
  });

  describe('keyboard', () => {
    const MIXED: Diff = {
      ...DIFF,
      hunks: [
        {
          header: '@@ -146,10 +146,24 @@ export function useTeamState(',
          lines: [
            { sign: ' ', oldLineNo: 146, newLineNo: 146, text: '  const [selected] = useState();' },
            { sign: '-', oldLineNo: 149, newLineNo: null, text: '  const [widths] = useState({});' },
            { sign: '+', oldLineNo: null, newLineNo: 149, text: '  const [widths] = useState(read);' },
            { sign: ' ', oldLineNo: 150, newLineNo: 150, text: '' },
          ],
        },
        { header: '@@ -200,3 +214,3 @@', lines: [{ sign: '+', oldLineNo: null, newLineNo: 214, text: 'x' }] },
      ],
    };

    function spyRows() {
      const rows = screen.getAllByTestId('diff-row');
      for (const row of rows) row.scrollIntoView = vi.fn();
      return rows;
    }

    it('closes on esc', () => {
      const onClose = vi.fn();
      render(<DiffModal diff={DIFF} onClose={onClose} />);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('binds nothing while no patch is open', () => {
      const onClose = vi.fn();
      render(<DiffModal diff={null} onClose={onClose} />);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('hands the keyboard back when it unmounts', () => {
      const onClose = vi.fn();
      const { unmount } = render(<DiffModal diff={DIFF} onClose={onClose} />);
      unmount();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('j jumps to the first changed line, skipping context', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const rows = spyRows();
      fireEvent.keyDown(window, { key: 'j' });
      expect(rows[1].scrollIntoView).toHaveBeenCalled();
      expect(rows[0].scrollIntoView).not.toHaveBeenCalled();
    });

    // A +/- block is one change, not one per line: stepping line by line would
    // take four presses to cross a four-line replacement.
    it('treats a run of +/- lines as a single change', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const rows = spyRows();
      fireEvent.keyDown(window, { key: 'j' });
      fireEvent.keyDown(window, { key: 'j' });
      expect(rows[4].scrollIntoView).toHaveBeenCalled();
      expect(rows[2].scrollIntoView).not.toHaveBeenCalled();
    });

    it('stops at the last change rather than wrapping', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const rows = spyRows();
      for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: 'j' });
      expect(rows[4].scrollIntoView).toHaveBeenCalled();
      expect(rows[1].scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('k walks back to the previous change', () => {
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      const rows = spyRows();
      fireEvent.keyDown(window, { key: 'j' });
      fireEvent.keyDown(window, { key: 'j' });
      fireEvent.keyDown(window, { key: 'k' });
      expect(rows[1].scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it('does nothing on j for a patch with no changed lines', () => {
      const contextOnly: Diff = {
        ...DIFF,
        hunks: [{ header: '@@ -1,1 +1,1 @@', lines: [{ sign: ' ', oldLineNo: 1, newLineNo: 1, text: 'a' }] }],
      };
      render(<DiffModal diff={contextOnly} onClose={() => {}} />);
      const rows = spyRows();
      fireEvent.keyDown(window, { key: 'j' });
      expect(rows[0].scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe('copy patch', () => {
    const MIXED: Diff = {
      ...DIFF,
      hunks: [
        {
          header: '@@ -146,10 +146,24 @@ export function useTeamState(',
          lines: [
            { sign: ' ', oldLineNo: 146, newLineNo: 146, text: '  const [selected] = useState();' },
            { sign: '-', oldLineNo: 149, newLineNo: null, text: '  const [widths] = useState({});' },
            { sign: '+', oldLineNo: null, newLineNo: 149, text: '  const [widths] = useState(read);' },
            { sign: ' ', oldLineNo: 150, newLineNo: 150, text: '' },
          ],
        },
        { header: '@@ -200,3 +214,3 @@', lines: [{ sign: '+', oldLineNo: null, newLineNo: 214, text: 'x' }] },
      ],
    };

    it('writes a patch that git apply would take', () => {
      const writeText = vi.fn(async () => undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      render(<DiffModal diff={MIXED} onClose={() => {}} />);
      fireEvent.click(screen.getByTestId('diff-copy'));
      expect(writeText).toHaveBeenCalledWith(
        [
          '--- a/src/web/state/useTeamState.ts',
          '+++ b/src/web/state/useTeamState.ts',
          '@@ -146,10 +146,24 @@ export function useTeamState(',
          '   const [selected] = useState();',
          '-  const [widths] = useState({});',
          '+  const [widths] = useState(read);',
          ' ',
          '@@ -200,3 +214,3 @@',
          '+x',
          '',
        ].join('\n'),
      );
      vi.unstubAllGlobals();
    });

    // The caps drop lines silently, and a patch missing them does not apply.
    // Better to hand over something that says so than something that fails.
    it('marks a truncated patch as incomplete', () => {
      const writeText = vi.fn(async (_patch: string) => undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      render(<DiffModal diff={{ ...MIXED, truncated: true }} onClose={() => {}} />);
      fireEvent.click(screen.getByTestId('diff-copy'));
      const patch = writeText.mock.calls[0][0];
      expect(patch.split('\n')[0]).toBe('# truncated: 3 of 16 changed lines — incomplete, will not apply');
      vi.unstubAllGlobals();
    });
  });

  // Every remaining legend entry is bound below. ⌘⏎ went with the button.
  it('advertises only the keys it actually binds', () => {
    render(<DiffModal diff={DIFF} onClose={() => {}} />);
    const footer = screen.getByTestId('diff-footer');
    expect(footer.textContent).toBe(
      ['esc close', 'j/k next change', 'the transcript keeps its one line — the patch lives here'].join(''),
    );
    expect(footer.textContent).not.toContain('⌘⏎');
  });
});
