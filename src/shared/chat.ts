export type SSEDataType = 'createMessage' | 'appendMessage' | 'updateMessage'

export interface IMessageContent {
  type: string
  payload: Record<string, unknown>
}

export interface SSEMessagePayload {
  message_id: string
  role: 'user' | 'assistant' | 'tool' | 'system' | string
  content: IMessageContent[]
  depth?: number
  parent_action_id?: string | null
  timestamp?: string
}

export interface SSEMessageData {
  type: SSEDataType
  payload: SSEMessagePayload
}

export interface SSESessionData {
  session_id: string
  llm_session_id?: string
  run_id?: string
  execution_context?: Record<string, string>
}

export interface SSEUsageDelta {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  session_total_tokens?: number
  context_length?: number
}

export interface SSEUsageData {
  model?: string
  usage?: SSEUsageDelta
  session_total_tokens?: number
  context_length?: number
}

export interface SSEEndData {
  session_id?: string
  total_tokens?: number
  context_length?: number
  duration?: number
}

export interface SSEErrorData {
  error: string
  error_type?: string
  session_id?: string
}

export interface SSEChatEvent {
  id: number
  event: string
  data: unknown
}

export interface StreamChatInput {
  message: string
  session_id?: string
  source?: string
  datasource?: string
  permission_mode?: string
  subagent_id?: string
  model?: string
  catalog?: string
  database?: string
  db_schema?: string
  max_turns?: number
  stream_response?: boolean
}

export interface ToolCallPayload {
  callToolId: string
  toolName: string
  toolParams?: Record<string, unknown>
  proxied?: boolean
  preview?: string
}

export interface ToolResultPayload {
  callToolId: string
  toolName?: string
  duration?: number
  shortDesc?: string
  result?: unknown
  error?: string
}

export interface InteractionRequest {
  title: string
  content?: string
  options?: Record<string, string>
  defaultChoice?: string
  contentType?: string
  allowFreeText?: boolean
  multiSelect?: boolean
}

export interface InteractionPayload {
  interactionKey: string
  actionType?: string
  requests: InteractionRequest[]
}

export interface ArtifactPayload {
  slug: string
  kind: 'report' | 'dashboard' | string
  mode?: string
  name?: string
  description?: string
  created_at?: string
  preview_summary?: string
}

export interface SubagentCompletePayload {
  subagentType: string
  toolCount?: number
  duration?: number
  error?: string
}

export interface ChatSessionItem {
  session_id: string
  user_query?: string
  created_at: string
  last_updated: string
  total_turns: number
  token_count: number
  is_active?: boolean
}

export interface ChatSessionList {
  sessions: ChatSessionItem[]
  total_count: number
}

export interface AgentListItem {
  id?: string
  name?: string
  type?: string
  subagent_id?: string
  description?: string
}

export interface ModelsResponse {
  current_model?: string
  models?: Record<string, unknown>
  providers?: Record<string, unknown>
}

export interface MessageBlock {
  kind: string
  payload: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  role: string
  depth: number
  parentActionId: string | null
  blocks: MessageBlock[]
}
