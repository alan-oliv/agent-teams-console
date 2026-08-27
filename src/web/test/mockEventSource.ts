import { vi } from 'vitest';

type Listener = (ev: MessageEvent | Event) => void;

export class MockEventSource {
  static instances: MockEventSource[] = [];

  static last(): MockEventSource {
    const es = MockEventSource.instances.at(-1);
    if (!es) throw new Error('no EventSource was constructed');
    return es;
  }

  readonly listeners = new Map<string, Set<Listener>>();
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }

  emitError(): void {
    const ev = new Event('error');
    for (const fn of [...(this.listeners.get('error') ?? [])]) fn(ev);
  }
}

export function installMockEventSource(): void {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
}
