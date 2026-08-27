// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AGENT_STATUS } from '../../shared/status';
import { StatusGlyph } from './StatusGlyph';

afterEach(cleanup);

// jsdom (like every browser) normalises a literal hex colour assigned to
// `style.color` into `rgb(...)` on read-back, but leaves a `var(...)` value
// untouched — so comparing against a raw AGENT_STATUS colour string directly
// is flaky depending on which form that status happens to use. Round-trip
// the expectation through the same DOM serialisation the assertion reads
// through, so both sides are normalised the same way.
function domColor(css: string): string {
  const probe = document.createElement('span');
  probe.style.color = css;
  return probe.style.color;
}

it('renders the design glyph for every agent status', () => {
  const cases: Array<[Parameters<typeof StatusGlyph>[0]['status'], string]> = [
    ['working', '●'],
    ['idle', '○'],
    ['plan_pending', '▲'],
    ['failed', '✗'],
    ['blocked', '⊘'],
  ];
  for (const [status, glyph] of cases) {
    const view = render(<StatusGlyph status={status} />);
    const el = screen.getByTestId('status-glyph');
    expect(el.textContent).toBe(glyph);
    expect(el.style.color).toBe(domColor(AGENT_STATUS[status].color));
    view.unmount();
  }
});

it('labels the glyph and takes an explicit size', () => {
  render(<StatusGlyph status="working" size={10} />);
  const el = screen.getByTestId('status-glyph');
  expect(el.getAttribute('aria-label')).toBe(AGENT_STATUS.working.label);
  expect(el.style.fontSize).toBe('10px');
});
