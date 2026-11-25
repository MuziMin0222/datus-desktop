export interface ChatAgent {
  id: string
  label: string
  description: string
  command?: string
}

export const CHAT_AGENTS: ChatAgent[] = [
  { id: 'chat', label: 'Chat', description: 'Automatically choose the right capability for each request.' },
  {
    id: 'gen_sql',
    label: 'Gen SQL',
    command: '/sql',
    description: 'Generate, optimize, or revise SQL.'
  },
  {
    id: 'ask_metrics',
    label: 'Ask Metrics',
    command: '/metrics',
    description: 'Answer questions from governed metrics and dimensions.'
  },
  {
    id: 'semantic_modeling',
    label: 'Semantic Modeling',
    command: '/semantic',
    description: 'Create or edit semantic datasets and metrics.'
  },
  {
    id: 'gen_visual_report',
    label: 'Visual Report',
    command: '/report',
    description: 'Build a visual report artifact.'
  },
  {
    id: 'gen_visual_dashboard',
    label: 'Visual Dashboard',
    command: '/dashboard',
    description: 'Build a visual dashboard artifact.'
  },
  {
    id: 'gen_table',
    label: 'Gen Table',
    command: '/table',
    description: 'Design and generate a database table.'
  },
  {
    id: 'gen_job',
    label: 'Gen Job',
    command: '/job',
    description: 'Create a scheduled data job.'
  }
]

export const SLASH_COMMANDS = CHAT_AGENTS.filter((agent) => agent.command)

export interface SlashCommandResult {
  agentId: string | null
  message: string
  command?: string
  error?: string
}

export function parseSlashCommand(text: string): SlashCommandResult {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return { agentId: null, message: trimmed }

  const match = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(trimmed)
  const command = `/${match?.[1] ?? ''}`
  const agent = SLASH_COMMANDS.find((item) => item.command === command || `/${item.id}` === command)
  if (!agent) {
    return {
      agentId: null,
      message: trimmed,
      error: `Unknown command ${command}. Type / to choose an available agent.`
    }
  }

  const message = (match?.[2] ?? '').trim()
  if (!message) return { agentId: null, message: trimmed, error: `Enter a request after ${command}.` }
  return { agentId: agent.id, command, message }
}

export function agentFromSessionId(sessionId: string): string {
  const marker = '_session_'
  return sessionId.includes(marker) ? sessionId.slice(0, sessionId.lastIndexOf(marker)) : 'chat'
}

export function chatAgent(id: string): ChatAgent {
  return CHAT_AGENTS.find((agent) => agent.id === id) ?? { id, label: id, description: '' }
}
