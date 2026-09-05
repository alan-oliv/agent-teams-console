// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowAgent, WorkflowRun } from '../../shared/domain';
import { WorkflowScript } from './WorkflowScript';

afterEach(cleanup);

const agent = (agentId: string, state: WorkflowAgent['state'], label: string): WorkflowAgent => ({
  agentId, state, label,
});

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  runId: 'wf_x',
  status: 'completed',
  live: false,
  phases: [],
  logs: [],
  agents: [
    agent('a1', 'cache', 'impl:one'),
    agent('a2', 'cache', 'impl:two'),
    agent('a3', 'done', 'impl:three'),
  ],
  ...over,
});

describe('WorkflowScript', () => {
  it('counts the replayed prefix and the re-run calls from the data', () => {
    render(<WorkflowScript run={run()} />);
    expect(screen.getByTestId('wf-script-chip-cache').textContent).toContain('2');
    expect(screen.getByTestId('wf-script-chip-fresh').textContent).toContain('1');
  });

  it('heads the pane with the script path and a control that copies it', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<WorkflowScript run={run({ scriptPath: '/s/workflows/scripts/x-wf_x.js' })} />);
    expect(screen.getByTestId('wf-script-head').textContent).toContain('/s/workflows/scripts/x-wf_x.js');

    fireEvent.click(screen.getByTestId('wf-script-copy-path'));
    expect(writeText).toHaveBeenCalledWith('/s/workflows/scripts/x-wf_x.js');
  });

  // An empty slot and a copy button with nothing to copy both read as a path
  // the console failed to show, rather than one the run never recorded.
  it('drops the path and its copy control when the run recorded no path', () => {
    render(<WorkflowScript run={run()} />);
    expect(screen.getByTestId('wf-script-head').textContent).toContain('SCRIPT');
    expect(screen.queryByTestId('wf-script-copy-path')).toBeNull();
  });

  it('names the run the resume replayed from', () => {
    render(<WorkflowScript run={run({ runId: 'wf_3c49ecab-c51' })} />);
    expect(screen.getByTestId('wf-script-from').textContent).toContain('wf_3c49ecab-c51');
  });

  it('rules off the replayed prefix from the calls that ran live', () => {
    render(<WorkflowScript run={run()} />);
    const rows = screen
      .getByTestId('wf-script-calls')
      .querySelectorAll('[data-testid="wf-script-call"], [data-testid="wf-script-boundary"]');
    const marks = [...rows].map((r) => r.getAttribute('data-testid'));
    expect(marks).toEqual([
      'wf-script-call',
      'wf-script-call',
      'wf-script-boundary',
      'wf-script-call',
    ]);
  });

  it('draws no boundary when there is nothing on one side of it', () => {
    render(<WorkflowScript run={run({ agents: [agent('a1', 'done', 'x')] })} />);
    expect(screen.queryByTestId('wf-script-boundary')).toBeNull();
  });

  it('tints a cached call differently from one that ran', () => {
    render(<WorkflowScript run={run()} />);
    const calls = screen.getAllByTestId('wf-script-call');
    expect(calls[0].dataset.tint).toBe('cache');
    expect(calls[2].dataset.tint).toBe('fresh');
  });

  it('says a run that resumed nothing ran every call', () => {
    render(<WorkflowScript run={run({ agents: [agent('a1', 'done', 'x')] })} />);
    expect(screen.getByTestId('wf-script-legend').textContent).toContain('nothing was replayed');
  });

  // A resumed run's journal omits every agent served from cache, so live there
  // is no such thing as a zero cache count — only a count nobody can take yet.
  // Asserting "this run started clean" mid-flight is a claim, not a reading.
  it('refuses to call a live run clean, having no way to see a cache hit', () => {
    render(<WorkflowScript run={run({ live: true, agents: [agent('a1', 'run', 'x')] })} />);
    const legend = screen.getByTestId('wf-script-legend').textContent ?? '';

    expect(legend).not.toContain('nothing was replayed');
    expect(legend).not.toContain('0 replayed from cache');
    expect(legend).toMatch(/cache/i);
    expect(legend).toMatch(/snapshot|not.*yet|cannot/i);
  });

  it('still counts the calls a live journal did see', () => {
    render(<WorkflowScript run={run({
      live: true,
      agents: [agent('a1', 'done', 'x'), agent('a2', 'run', 'y')],
    })} />);
    expect(screen.getByTestId('wf-script-legend').textContent).toContain('2');
  });

  it('shows the source when the snapshot carried it', () => {
    render(<WorkflowScript run={run({ script: "export const meta = { name: 'x' }" })} />);
    expect(screen.getByTestId('wf-script-source').textContent).toContain('export const meta');
  });

  // The runtime writes the script to disk at run START, so the old message —
  // that the source is not carried because of its size — was the reason a
  // FINISHED run's frame drops it, not a reason it cannot be shown. Now that
  // the pane fetches, the only honest message is the fetch's own result: no
  // source found. It may not say the source arrives later, or is too big.
  it('explains the absent source rather than drawing an empty pane', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));

    render(<WorkflowScript run={run()} />);
    const absent = (await screen.findByTestId('wf-script-absent')).textContent ?? '';
    expect(screen.queryByTestId('wf-script-source')).toBeNull();
    expect(absent).toMatch(/no source on disk/i);
    expect(absent).not.toMatch(/lands with the snapshot|not carried on the wire|two thirds/i);
    vi.unstubAllGlobals();
  });

  it('gives a live run its own reason the source is not on screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));

    render(<WorkflowScript run={run({ live: true, agents: [agent('a1', 'run', 'x')] })} />);
    const absent = (await screen.findByTestId('wf-script-absent')).textContent ?? '';
    expect(absent).toMatch(/no source on disk/i);
    expect(absent).toMatch(/run start/i);
    expect(absent).not.toMatch(/snapshot/i);
    vi.unstubAllGlobals();
  });

  // Between mount and the fetch answering, the pane knows neither the source
  // nor that there is none. Drawing "no source on disk" in that window would be
  // a claim it cannot yet make.
  it('claims nothing about the source while the fetch is still out', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    render(<WorkflowScript run={run()} />);
    expect(screen.queryByTestId('wf-script-absent')).toBeNull();
    expect(screen.queryByTestId('wf-script-source')).toBeNull();
    vi.unstubAllGlobals();
  });

  // The source is on disk from the moment a run starts; the frame just does not
  // carry it. Fetching it is what closes the "I can't see the script" gap.
  it('fetches the source the frame dropped and draws it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        runId: 'wf_x',
        source: 'as-executed',
        path: '/s/workflows/scripts/deep-research-wf_x.js',
        script: "export const meta = { name: 'deep-research' }",
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WorkflowScript run={run()} />);
    expect(fetchMock).toHaveBeenCalledWith('/api/workflow/wf_x/script');

    const source = await screen.findByTestId('wf-script-source');
    expect(source.textContent).toContain('export const meta');
    expect(screen.queryByTestId('wf-script-absent')).toBeNull();
    vi.unstubAllGlobals();
  });

  // Three copies of a script can differ: the one on the wire, the one as
  // executed, and the file in the repo the run pointed at, which may have been
  // edited since. Which one is on screen is not a detail.
  it('labels which copy of the source it got', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ runId: 'wf_x', source: 'snapshot', path: '/s/workflows/wf_x.json', script: 'x' }),
    }));

    render(<WorkflowScript run={run()} />);
    expect((await screen.findByTestId('wf-script-origin')).textContent).toMatch(/snapshot/i);
    vi.unstubAllGlobals();
  });

  it('keeps the absent-source message when the run left no source to fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));

    render(<WorkflowScript run={run()} />);
    expect((await screen.findByTestId('wf-script-absent')).textContent).toMatch(/no source on disk/i);
    vi.unstubAllGlobals();
  });

  it('does not ask the server for a source the frame already carried', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<WorkflowScript run={run({ script: 'export const meta = {}' })} />);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('states the determinism rule a resume depends on', () => {
    render(<WorkflowScript run={run()} />);
    const note = screen.getByTestId('wf-script-note').textContent ?? '';
    expect(note).toContain('Date.now()');
    expect(note).toMatch(/longest unchanged prefix/i);
  });
});
