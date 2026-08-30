// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Diff } from '../../shared/domain';
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
      expect(screen.getByTestId('diff-stat').style.color).toBe('rgb(127, 185, 141)');
      expect(screen.getByTestId('diff-meta').textContent).toBe('lead · 14:22:08 · 9be5ee0');
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

  describe('toolbar', () => {
    it('starts on unified, styled as the active segment', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      const unified = screen.getByTestId('diff-layout-unified');
      const split = screen.getByTestId('diff-layout-split');
      expect(unified.style.color).toBe('var(--color-accent-300)');
      expect(unified.style.background).toBe('var(--color-accent-900)');
      expect(split.style.color).toBe('var(--color-neutral-500)');
      expect(split.style.background).toBe('transparent');
      for (const seg of [unified, split]) {
        expect(seg.style.boxShadow).toBe('inset 0 0 0 1px var(--color-neutral-800)');
      }
    });

    it('holds its own active segment on click, without rendering anything different', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      fireEvent.click(screen.getByTestId('diff-layout-split'));
      expect(screen.getByTestId('diff-layout-split').style.color).toBe('var(--color-accent-300)');
      expect(screen.getByTestId('diff-layout-unified').style.color).toBe('var(--color-neutral-500)');
      // Chrome only — the toggle does not touch the (still empty) body.
      expect(screen.getByTestId('diff-body').children).toHaveLength(0);
    });

    it('counts the hunks, pluralising past one', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      expect(screen.getByTestId('diff-hunk-count').textContent).toBe('1 hunk · whitespace shown');
      const two: Diff = { ...DIFF, hunks: [DIFF.hunks[0], DIFF.hunks[0]] };
      render(<DiffModal diff={two} onClose={() => {}} />);
      expect(screen.getAllByTestId('diff-hunk-count')[1].textContent).toBe('2 hunks · whitespace shown');
    });

    it('offers copy patch and open in editor as inert chrome', () => {
      render(<DiffModal diff={DIFF} onClose={() => {}} />);
      const copy = screen.getByTestId('diff-copy');
      const open = screen.getByTestId('diff-open-editor');
      expect(copy.textContent).toBe('copy patch');
      expect(open.textContent).toBe('open in editor');
      expect(open.style.border).toBe('1px solid var(--color-accent-700)');
      expect(open.style.color).toBe('var(--color-accent-300)');
    });
  });

  it('holds an empty scroll container sized to take the hunk rows', () => {
    render(<DiffModal diff={DIFF} onClose={() => {}} />);
    const body = screen.getByTestId('diff-body');
    expect(body.className).toBe('tscroll');
    expect(body.style.flex).toBe('1 1 0%');
    expect(body.style.background).toBe('var(--term)');
    expect(within(body).queryAllByRole('row')).toHaveLength(0);
    expect(body.children).toHaveLength(0);
  });

  it('carries the footer legend', () => {
    render(<DiffModal diff={DIFF} onClose={() => {}} />);
    const footer = screen.getByTestId('diff-footer');
    expect(footer.textContent).toBe(
      [
        'esc close',
        'j/k next change',
        '⌘⏎ open in editor',
        'the transcript keeps its one line — the patch lives here',
      ].join(''),
    );
  });
});
