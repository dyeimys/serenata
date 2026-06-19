import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from './firebase'
import type { AssistantChatResult, AssistantMessage, AssistantThread, ProposedTask } from '../types/assistant'

const functions = firebaseApp ? getFunctions(firebaseApp, 'us-central1') : null

function callable<TInput, TOutput>(name: string) {
  if (!functions) throw new Error('Firebase nao esta configurado.')
  return httpsCallable<TInput, TOutput>(functions, name)
}

export async function listAssistantThreads() {
  const result = await callable<Record<string, never>, { threads: AssistantThread[] }>('listAssistantThreads')({})
  return result.data.threads
}

export async function getAssistantThread(threadId: string) {
  const result = await callable<{ threadId: string }, { thread: AssistantThread; messages: AssistantMessage[] }>('getAssistantThread')({ threadId })
  return result.data
}

export async function sendAssistantMessage(message: string, threadId?: string) {
  const result = await callable<{ message: string; threadId?: string }, AssistantChatResult>('assistantChat')({ message, threadId })
  return result.data
}

export async function confirmTaskProposal(input: {
  threadId: string
  proposalId: string
  idempotencyKey: string
  tasks: Array<ProposedTask & { selected: boolean }>
}) {
  const result = await callable<typeof input, { status: 'confirmed'; createdTaskIds: string[]; alreadyConfirmed: boolean }>('confirmTaskProposal')(input)
  return result.data
}

export async function archiveAssistantThread(threadId: string) {
  await callable<{ threadId: string }, { status: 'archived' }>('archiveAssistantThread')({ threadId })
}
