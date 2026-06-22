import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from './firebase'

export type RsvpDuplicateGroup = {
  key: string
  reason: 'name' | 'phone' | 'name_phone' | 'mixed'
  canonicalSubmissionId: string
  submissionIds: string[]
  canonicalName: string
  canonicalPhone: string
  totalGuestsPreview: number
  matchedBy: Array<'name' | 'phone'>
  entries: Array<{
    id: string
    name: string
    phone: string
    adults: number
    children: number
    totalGuests: number
    attending?: boolean
  }>
}

export type RsvpConsolidationSnapshot = {
  generatedAt?: unknown
  hasDuplicates: boolean
  duplicateGroupCount: number
  duplicateSubmissionCount: number
  groups: RsvpDuplicateGroup[]
}

export type ConsolidationCallableResponse = {
  runId: string
  newSubmissionId: string
  archivedSubmissions: number
  message: string
}

export type ScanDuplicatesResponse = {
  duplicateGroupCount: number
  duplicateSubmissionCount: number
  hasDuplicates: boolean
  message: string
}

export type ManualConsolidationPayload = {
  groupKey: string
  archiveSubmissionIds: string[]
  name: string
  phone: string
  adults: number
  children: number
  attending: boolean
}

const functions = firebaseApp ? getFunctions(firebaseApp, 'us-central1') : null

export async function scanRsvpDuplicatesNow() {
  if (!functions) throw new Error('Firebase não configurado')
  const callable = httpsCallable<void, ScanDuplicatesResponse>(functions, 'scanRsvpDuplicatesNow')
  return (await callable()).data
}

export async function consolidateRsvpDuplicates(payload: ManualConsolidationPayload) {
  if (!functions) throw new Error('Firebase não configurado')
  const callable = httpsCallable<ManualConsolidationPayload, ConsolidationCallableResponse>(functions, 'consolidateRsvpDuplicates')
  return (await callable(payload)).data
}

