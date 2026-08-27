export interface TeamConfigMember {
  agentId: string; name: string; agentType?: string; color?: string; model?: string;
  prompt?: string; planModeRequired?: boolean; cwd?: string; joinedAt: number;
  tmuxPaneId: string; backendType?: string; subscriptions: string[];
}
export interface TeamConfig {
  name: string; createdAt: number; leadAgentId: string; leadSessionId: string;
  members: TeamConfigMember[];
}
export interface Sidecar {
  agentType: string; description: string; name: string; spawnDepth: number;
  model: string; taskKind: string; teamName: string; color?: string;
  planModeRequired?: boolean; permissionMode?: string;
}
export interface AgentIdentity {
  name: string; agentId: string; isLead: boolean; agentType: string;
  rawModel?: string; role: string; color?: string; joinedAt: number;
  transcriptPath?: string;
}

const ROLE_MAX = 80;

// The sidecar's agentType is the teammate name again (spec §2.2), so it is only
// usable as a subagent type when it differs from the name.
function typeFromSidecar(meta: Sidecar | undefined): string {
  if (!meta) return '';
  return meta.agentType && meta.agentType !== meta.name ? meta.agentType : '';
}

function roleOf(meta: Sidecar | undefined, prompt: string | undefined): string {
  const described = meta?.description?.trim();
  if (described) return described;
  const flat = (prompt ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > ROLE_MAX ? `${flat.slice(0, ROLE_MAX)}…` : flat;
}

export function buildRoster(
  config: TeamConfig | null,
  sidecars: Array<{ meta: Sidecar; transcriptPath: string }>,
): AgentIdentity[] {
  const byName = new Map(sidecars.map((s) => [s.meta.name, s]));
  const roster: AgentIdentity[] = [];
  const claimed = new Set<string>();

  for (const member of config?.members ?? []) {
    const sidecar = byName.get(member.name);
    roster.push({
      name: member.name,
      agentId: member.agentId,
      isLead: member.agentId === config?.leadAgentId,
      agentType: member.agentType ?? typeFromSidecar(sidecar?.meta),
      rawModel: member.model ?? sidecar?.meta.model,
      role: roleOf(sidecar?.meta, member.prompt),
      color: member.color ?? sidecar?.meta.color,
      joinedAt: member.joinedAt,
      transcriptPath: sidecar?.transcriptPath,
    });
    claimed.add(member.name);
  }

  for (const sidecar of sidecars) {
    if (claimed.has(sidecar.meta.name)) continue;
    roster.push({
      name: sidecar.meta.name,
      agentId: `${sidecar.meta.name}@${sidecar.meta.teamName}`,
      isLead: false,
      agentType: typeFromSidecar(sidecar.meta),
      rawModel: sidecar.meta.model,
      role: roleOf(sidecar.meta, undefined),
      color: sidecar.meta.color,
      joinedAt: 0,
      transcriptPath: sidecar.transcriptPath,
    });
  }

  return roster;
}
