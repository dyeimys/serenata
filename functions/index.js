const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { HttpsError, onCall } = require('firebase-functions/v2/https')

initializeApp()

const region = 'us-central1'

function normalizedRole(role) {
  return String(role ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function canManageUsers(role) {
  return ['noivo', 'noiva', 'assessor', 'assessora', 'assessor(a)'].includes(normalizedRole(role))
}

async function getRequester(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.')

  const profile = await getFirestore().doc(`users/${request.auth.uid}`).get()
  return { auth: request.auth, canManage: profile.exists && canManageUsers(profile.get('role')) }
}

async function requireUserManager(request) {
  const requester = await getRequester(request)
  if (!requester.canManage) throw new HttpsError('permission-denied', 'Seu papel não permite gerenciar usuários.')
  return requester.auth
}

exports.listAuthenticationUsers = onCall({ region, timeoutSeconds: 60 }, async (request) => {
  const requester = await getRequester(request)
  const authUsers = []
  let pageToken

  do {
    const page = await getAuth().listUsers(1000, pageToken)
    authUsers.push(...page.users)
    pageToken = page.pageToken
  } while (pageToken)

  const profileSnapshots = await getFirestore().collection('users').get()
  const profiles = new Map(profileSnapshots.docs.map((snapshot) => [snapshot.id, snapshot.data()]))

  return {
    currentUserId: requester.auth.uid,
    canManage: requester.canManage,
    users: authUsers.map((user) => {
      const profile = profiles.get(user.uid)
      return {
        id: user.uid,
        email: user.email ?? '',
        disabled: user.disabled,
        emailVerified: user.emailVerified,
        createdAt: user.metadata.creationTime ?? null,
        lastSignInAt: user.metadata.lastSignInTime ?? null,
        name: typeof profile?.name === 'string' ? profile.name : null,
        phone: typeof profile?.phone === 'string' ? profile.phone : null,
        role: typeof profile?.role === 'string' ? profile.role : null,
        hasProfile: Boolean(profile),
      }
    }),
  }
})

exports.updateAuthenticationUserRole = onCall({ region }, async (request) => {
  const requester = await requireUserManager(request)
  const userId = typeof request.data?.userId === 'string' ? request.data.userId.trim() : ''
  const role = typeof request.data?.role === 'string' ? request.data.role.trim() : ''

  if (!userId || !role || role.length > 60) {
    throw new HttpsError('invalid-argument', 'Usuário e papel são obrigatórios.')
  }
  if (userId === requester.uid) {
    throw new HttpsError('failed-precondition', 'Você não pode alterar o próprio papel.')
  }

  const profileReference = getFirestore().doc(`users/${userId}`)
  const profile = await profileReference.get()
  if (!profile.exists) {
    throw new HttpsError('failed-precondition', 'Este usuário ainda não possui perfil.')
  }

  await profileReference.update({
    role,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUserId: requester.uid,
    updatedByEmail: requester.token.email ?? '',
  })

  return { userId, role }
})

const assistant = require('./assistant')

exports.listAssistantThreads = assistant.listAssistantThreads
exports.getAssistantThread = assistant.getAssistantThread
exports.assistantChat = assistant.assistantChat
exports.confirmTaskProposal = assistant.confirmTaskProposal
exports.archiveAssistantThread = assistant.archiveAssistantThread
