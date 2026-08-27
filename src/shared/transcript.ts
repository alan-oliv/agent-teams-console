import type { Usage } from './usage';

export interface TranscriptRecord {           // one parsed JSONL line, loosely typed
  type?: string; uuid?: string; timestamp?: string; isSidechain?: boolean;
  isApiErrorMessage?: boolean; agentId?: string; subtype?: string;
  compactMetadata?: { postTokens?: number };
  message?: { id?: string; model?: string; role?: string; usage?: Usage; content?: unknown };
  toolUseResult?: unknown;
}
