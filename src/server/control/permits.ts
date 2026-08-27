// Task 15 appends createPermits to this file. Task 14 only needs the port
// type: hooks.ts holds a PermissionRequest against it and awaits the decision.
export interface HeldPermit {
  id: string;
  agent: string;
  toolName: string;
  input: unknown;
  expiresAt: number;
}

export interface Permits {
  hold(
    agent: string,
    toolName: string,
    input: unknown,
    timeoutMs: number,
  ): { id: string; promise: Promise<{ decision: 'allow' | 'deny'; reason?: string }> };
  resolve(id: string, decision: 'allow' | 'deny', reason?: string): boolean;
  list(): HeldPermit[];
}
