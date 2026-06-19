import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore'
import { auth } from './firebase'

type AuditAction = 'create' | 'update' | 'delete'

type AuditIdentity = {
  userId: string
  email: string
}

const ignoredChangeFields = new Set([
  'createdAt',
  'updatedAt',
  'createdByUserId',
  'createdByEmail',
  'updatedByUserId',
  'updatedByEmail',
])

function getAuditIdentity(): AuditIdentity {
  const user = auth?.currentUser

  if (!user?.email) {
    throw new Error('Usuário autenticado com e-mail não encontrado para registrar a auditoria.')
  }

  return { userId: user.uid, email: user.email }
}

function auditFields(identity: AuditIdentity, action: AuditAction) {
  if (action === 'create') {
    return {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUserId: identity.userId,
      createdByEmail: identity.email,
      updatedByUserId: identity.userId,
      updatedByEmail: identity.email,
    }
  }

  return {
    updatedAt: serverTimestamp(),
    updatedByUserId: identity.userId,
    updatedByEmail: identity.email,
  }
}

function valuesAreEqual(previousValue: unknown, nextValue: unknown) {
  return JSON.stringify(previousValue) === JSON.stringify(nextValue)
}

function changedFields(action: AuditAction, before: DocumentData, after: DocumentData) {
  const comparedData = action === 'delete' ? before : after

  return Object.fromEntries(
    Object.entries(comparedData)
      .filter(([field, value]) => !ignoredChangeFields.has(field) && (action === 'delete' || !valuesAreEqual(before[field], value)))
      .map(([field, value]) => [
        field,
        {
          before: action === 'create' ? null : before[field] ?? null,
          after: action === 'delete' ? null : value ?? null,
        },
      ]),
  )
}

function addAuditLog(
  batch: WriteBatch,
  db: Firestore,
  collectionName: string,
  documentId: string,
  action: AuditAction,
  before: DocumentData,
  after: DocumentData,
  identity: AuditIdentity,
) {
  batch.set(doc(collection(db, 'auditLogs')), {
    action,
    collection: collectionName,
    documentId,
    userId: identity.userId,
    userEmail: identity.email,
    changes: changedFields(action, before, after),
    createdAt: serverTimestamp(),
  })
}

export async function createDocumentWithAudit(db: Firestore, collectionName: string, data: DocumentData) {
  const identity = getAuditIdentity()
  const documentReference = doc(collection(db, collectionName))
  const persistedData = { ...data, ...auditFields(identity, 'create') }
  const batch = writeBatch(db)
  batch.set(documentReference, persistedData)
  addAuditLog(batch, db, collectionName, documentReference.id, 'create', {}, data, identity)
  await batch.commit()
  return documentReference
}

export async function updateDocumentWithAudit(db: Firestore, collectionName: string, documentId: string, data: DocumentData) {
  const identity = getAuditIdentity()
  const documentReference = doc(db, collectionName, documentId)
  const snapshot = await getDoc(documentReference)

  if (!snapshot.exists()) throw new Error(`Documento ${collectionName}/${documentId} não encontrado.`)

  const persistedData = { ...data, ...auditFields(identity, 'update') }
  const batch = writeBatch(db)
  batch.update(documentReference, persistedData)
  addAuditLog(batch, db, collectionName, documentId, 'update', snapshot.data(), data, identity)
  await batch.commit()
}

export async function setDocumentWithAudit(db: Firestore, collectionName: string, documentId: string, data: DocumentData) {
  const identity = getAuditIdentity()
  const documentReference = doc(db, collectionName, documentId)
  const snapshot = await getDoc(documentReference)
  const action: AuditAction = snapshot.exists() ? 'update' : 'create'
  const persistedData = { ...data, ...auditFields(identity, action) }
  const batch = writeBatch(db)
  batch.set(documentReference, persistedData, { merge: true })
  addAuditLog(batch, db, collectionName, documentId, action, snapshot.data() ?? {}, data, identity)
  await batch.commit()
}

export async function deleteDocumentWithAudit(db: Firestore, collectionName: string, documentId: string) {
  const identity = getAuditIdentity()
  const documentReference = doc(db, collectionName, documentId)
  const snapshot = await getDoc(documentReference)

  if (!snapshot.exists()) throw new Error(`Documento ${collectionName}/${documentId} não encontrado.`)

  const batch = writeBatch(db)
  batch.delete(documentReference)
  addAuditLog(batch, db, collectionName, documentId, 'delete', snapshot.data(), {}, identity)
  await batch.commit()
}

export async function convertDocumentWithAudit(
  db: Firestore,
  sourceCollection: string,
  sourceDocumentId: string,
  targetCollection: string,
  targetData: DocumentData,
) {
  const identity = getAuditIdentity()
  const sourceReference = doc(db, sourceCollection, sourceDocumentId)
  const sourceSnapshot = await getDoc(sourceReference)

  if (!sourceSnapshot.exists()) throw new Error(`Documento ${sourceCollection}/${sourceDocumentId} não encontrado.`)

  const targetReference = doc(collection(db, targetCollection))
  const batch = writeBatch(db)
  batch.set(targetReference, { ...targetData, ...auditFields(identity, 'create') })
  batch.delete(sourceReference)
  addAuditLog(batch, db, targetCollection, targetReference.id, 'create', {}, targetData, identity)
  addAuditLog(batch, db, sourceCollection, sourceDocumentId, 'delete', sourceSnapshot.data(), {}, identity)
  await batch.commit()
  return targetReference
}
