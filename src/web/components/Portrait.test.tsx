// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { buildCast, type Cast } from '../../shared/cast';
import { CastContext } from '../state/useCast';
import { SettingsContext, DEFAULT_SETTINGS } from '../state/useSettings';
import { Portrait, TerminalSprite } from './Portrait';

// This suite renders several times per test (and across tests); without
// explicit cleanup the un-unmounted nodes from one `it` leak into the next
// and getByTestId starts matching more than one element.
afterEach(cleanup);

const LEAD = { name: 'team-lead', agentType: 'team-lead', isLead: true };
const ALPHA = { name: 'probe-alpha', agentType: 'general-purpose', isLead: false };

// jsdom's CSSOM always serialises the `flex` shorthand back out in its
// longhand form, so `flex: 'none'` round-trips as `'0 0 auto'` even though
// that's exactly what was set. Compare against the same round-trip instead
// of the literal keyword.
function domFlex(css: string): string {
  const probe = document.createElement('div');
  probe.style.flex = css;
  return probe.style.flex;
}

it('hosts the inline SVG in a 24x24 relative box', () => {
  render(<Portrait agent={LEAD} />);
  const host = screen.getByTestId('portrait');
  expect(host.style.width).toBe('24px');
  expect(host.style.height).toBe('24px');
  expect(host.style.position).toBe('relative');
  expect(host.style.flex).toBe(domFlex('none'));
  expect(host.querySelector('svg')).not.toBeNull();
});

it('gives the lead the crown portrait', () => {
  render(<Portrait agent={LEAD} />);
  expect(screen.getByTestId('portrait').getAttribute('data-portrait')).toBe('lead');
});

it('applies the per-slot margin-top', () => {
  const { unmount } = render(<Portrait agent={ALPHA} slot="wall" />);
  expect(screen.getByTestId('portrait').style.marginTop).toBe('3px');
  unmount();

  const rail = render(<Portrait agent={ALPHA} slot="rail-row" />);
  expect(screen.getByTestId('portrait').style.marginTop).toBe('1px');
  rail.unmount();

  render(<Portrait agent={ALPHA} />);
  expect(screen.getByTestId('portrait').style.marginTop).toBe('0px');
});

it('draws the same agent identically every time', () => {
  const first = render(<Portrait agent={ALPHA} />);
  const html = screen.getByTestId('portrait').innerHTML;
  first.unmount();
  render(<Portrait agent={ALPHA} />);
  expect(screen.getByTestId('portrait').innerHTML).toBe(html);
});

it('sizes the terminal sprite box to the grid\'s 24:17 aspect, default 144x102', () => {
  render(<TerminalSprite />);
  const host = screen.getByTestId('terminal-sprite');
  expect(host.style.width).toBe('144px');
  expect(host.style.height).toBe('102px');
  expect(host.style.position).toBe('relative');
  expect(host.querySelector('svg')).not.toBeNull();
});

it('scales the terminal sprite and its glow together via the size prop', () => {
  render(<TerminalSprite size={72} />);
  const host = screen.getByTestId('terminal-sprite');
  expect(host.style.width).toBe('72px');
  expect(host.style.height).toBe('51px');
  const glow = screen.getByTestId('terminal-sprite-glow');
  expect(glow.style.width).toBe('88px'); // 176 * (72/144)
});

it('draws nothing for the terminal sprite when avatars are off, like the role portraits', () => {
  render(
    <SettingsContext.Provider value={{ ...DEFAULT_SETTINGS, avatars: false }}>
      <TerminalSprite />
    </SettingsContext.Provider>,
  );
  expect(screen.queryByTestId('terminal-sprite')).toBeNull();
});

// The look follows the cast's role slot, and the whole thing goes through the
// contexts the views already provide, so none of the seven call sites change.
const filmed = (settings: Partial<typeof DEFAULT_SETTINGS>, cast: Cast, agent = LEAD) =>
  render(
    <SettingsContext.Provider value={{ ...DEFAULT_SETTINGS, ...settings }}>
      <CastContext.Provider value={cast}>
        <Portrait agent={agent} />
      </CastContext.Provider>
    </SettingsContext.Provider>,
  );

const svgOf = () => screen.getByTestId('portrait').innerHTML;

it('wears the film look when the cast gave the agent a role slot', () => {
  const cast = buildCast([LEAD], 'inception');
  expect(cast.slotOf('team-lead')).toBe('lead');
  filmed({ movieTheme: 'inception' }, cast);
  const filmSvg = svgOf();
  cleanup();

  render(<Portrait agent={LEAD} />);
  expect(filmSvg).not.toBe(svgOf());
});

it('keeps the default portrait for an agent that took a spare', () => {
  // lookFollowsRoleSlot: an agent whose role could not be read wears nothing.
  const cast = buildCast([LEAD, ALPHA], 'inception');
  expect(cast.slotOf('probe-alpha')).toBeNull();
  filmed({ movieTheme: 'inception' }, cast, ALPHA);
  const withFilm = svgOf();
  cleanup();

  render(<Portrait agent={ALPHA} />);
  expect(withFilm).toBe(svgOf());
});

it('tints portraits even with the film palette switched off', () => {
  // The switch reaches the GROUND, not the cast: names and portrait colours
  // survive it, which is what "names and portrait colours only" means.
  const cast = buildCast([LEAD], 'inception');
  filmed({ movieTheme: 'inception', filmPalette: false }, cast);
  const off = svgOf();
  cleanup();

  render(<Portrait agent={LEAD} />);
  expect(off).not.toBe(svgOf());
});

it('still honours the avatars toggle while a film is casting', () => {
  const cast = buildCast([LEAD], 'inception');
  filmed({ movieTheme: 'inception', avatars: false }, cast);
  expect(screen.queryByTestId('portrait')).toBeNull();
});
