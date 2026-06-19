export type AssistantThread = {
  id: string
  title: string
  lastMessagePreview: string
  status: 'active' | 'archived'
  createdAt: string | null
  updatedAt: string | null
}

export type ProposedTask = {
  clientId: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  dueDate: string
  rationale: string
  duplicateCandidateTaskId: string | null
  selected?: boolean
}

export type AssistantBlock =
  | { type: 'insight'; title: string; severity: 'info' | 'attention' | 'urgent'; body: string; evidence: string[] }
  | { type: 'task_proposal'; proposalId: string; tasks: ProposedTask[]; expiresAt: string }

export type AssistantMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: 'completed' | 'failed'
  createdAt: string | null
  sources: Array<{ collection: string; label: string; snapshotAt: string }>
  blocks: AssistantBlock[]
}

export type AssistantChatResult = {
  thread: AssistantThread
  userMessage: AssistantMessage
  assistantMessage: AssistantMessage
  suggestedPrompts: string[]
}
