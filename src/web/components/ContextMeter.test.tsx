// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ContextMeter } from './ContextMeter';

// Several `it`s in this file render more than once without unmounting every
// result; without explicit cleanup those nodes leak into the next test.
afterEach(cleanup);

it('renders the bar, percent and "53.1k / 1M" for an opus agent', () => {
  render(<ContextMeter contextTokens={53_100} contextLimit={1_000_000} compactAt={967_000} />);
  // 53_100 / 1_000_000 * 16 = 0.8496 cells, which rounds up to 1 filled cell
  // (matches the prototype's bar(): Math.round, not Math.floor).
  expect(screen.getByTestId('context-bar').textContent).toBe('█░░░░░░░░░░░░░░█');
  expect(screen.getByTestId('context-bar').style.fontSize).toBe('11.5px');
  expect(screen.getByTestId('context-bar').style.letterSpacing).toBe('-.5px');
  expect(screen.getByTestId('context-bar').style.color).toBe('var(--color-accent-600)');
  expect(screen.getByText('5%')).toBeTruthy();
  expect(screen.getByText('53.1k / 1M')).toBeTruthy();
});

it('shows the warn glyph at and past 75% of compactAt, sharing the warnMark rule', () => {
  // compactAt=167_000; 75% of it is 125_250 — the single shared threshold (format.ts warnMark).
  const below = render(
    <ContextMeter contextTokens={125_249} contextLimit={200_000} compactAt={167_000} />,
  );
  expect(screen.getByTestId('context-warn').textContent).toBe('');
  below.unmount();

  const at = render(<ContextMeter contextTokens={125_250} contextLimit={200_000} compactAt={167_000} />);
  expect(screen.getByTestId('context-warn').textContent).toBe('!');
  expect(screen.getByTestId('context-warn').style.color).toBe('var(--warn)');
  expect(screen.getByTestId('context-warn').style.width).toBe('7px');
  at.unmount();

  render(<ContextMeter contextTokens={199_000} contextLimit={200_000} compactAt={167_000} />);
  expect(screen.getByTestId('context-warn').textContent).toBe('!');
});

it('takes explicit bar and text sizes for the grid pane', () => {
  render(
    <ContextMeter
      contextTokens={156_000}
      contextLimit={200_000}
      compactAt={167_000}
      barSize={10.5}
      textSize={10}
    />,
  );
  expect(screen.getByTestId('context-bar').textContent).toBe('████████████░█░░');
  expect(screen.getByTestId('context-bar').style.fontSize).toBe('10.5px');
  expect(screen.getByText('78%').style.fontSize).toBe('10px');
});
