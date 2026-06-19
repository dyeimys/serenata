import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from './firebase'

export type ManagedUser = {
  id: string
  email: string
  disabled: boolean
  emailVerified: boolean
  createdAt: string | null
  lastSignInAt: string | null
  name: string | null
  phone: string | null
  role: string | null
  hasProfile: boolean
}

type UserListResponse = {
  currentUserId: string
  canManage: boolean
  users: ManagedUser[]
}

const functions = firebaseApp ? getFunctions(firebaseApp, 'southamerica-east1') : null

export async function listAuthenticationUsers(): Promise<UserListResponse> {
  if (!functions) throw new Error('Firebase não configurado')
  const callable = httpsCallable<void, UserListResponse>(functions, 'listAuthenticationUsers')
  return (await callable()).data
}

export async function updateAuthenticationUserRole(userId: string, role: string) {
  if (!functions) throw new Error('Firebase não configurado')
  const callable = httpsCallable<{ userId: string, role: string }, { userId: string, role: string }>(functions, 'updateAuthenticationUserRole')
  return (await callable({ userId, role })).data
}
