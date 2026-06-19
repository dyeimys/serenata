import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firestore'

export type UserProfile = {
  id: string
  name: string
  role: string
  phone: string
}

export type UserProfileInput = Omit<UserProfile, 'id'>

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  if (!db) throw new Error('Firestore não configurado')

  const snapshot = await getDoc(doc(db, 'users', userId))
  if (!snapshot.exists()) return null

  const data = snapshot.data()
  if (
    typeof data.name !== 'string' || !data.name.trim() ||
    typeof data.role !== 'string' || !data.role.trim() ||
    typeof data.phone !== 'string' || !data.phone.trim()
  ) {
    return null
  }

  return {
    id: snapshot.id,
    name: data.name.trim(),
    role: data.role.trim(),
    phone: data.phone.trim(),
  }
}

export async function saveUserProfile(userId: string, profile: UserProfileInput): Promise<UserProfile> {
  if (!db) throw new Error('Firestore não configurado')

  const reference = doc(db, 'users', userId)
  const snapshot = await getDoc(reference)
  const normalizedProfile = {
    name: profile.name.trim(),
    role: profile.role.trim(),
    phone: profile.phone.trim(),
  }

  await setDoc(reference, {
    ...normalizedProfile,
    updatedAt: serverTimestamp(),
    ...(!snapshot.exists() ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true })

  return { id: userId, ...normalizedProfile }
}
