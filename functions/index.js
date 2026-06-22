const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')

initializeApp()

const region = 'us-central1'
const callableCors = [/^http:\/\/localhost(:\d+)?$/, 'https://heldereanapaula-cee2f.web.app', 'https://heldereanapaula-cee2f.firebaseapp.com']

function normalizedRole(role) {
  return String(role ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function canManageUsers(role) {
  return ['noivo', 'noiva', 'assessor', 'assessora', 'assessor(a)'].includes(normalizedRole(role))
}

function canManageRsvpConsolidation(role) {
  return ['noivo', 'noiva', 'assessor', 'assessora', 'assessor(a)', 'cerimonialista', 'planner', 'groom', 'bride'].includes(normalizedRole(role))
}

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function normalizeName(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function isConfirmed(item) {
  return item.attending !== false && item.totalGuests > 0
}

function scoreSubmission(item) {
  const confirmedScore = isConfirmed(item) ? 100000 : 0
  const guestsScore = Number(item.totalGuests) || 0
  const createdScore = item.createdAt?.toMillis?.() ?? 0
  return confirmedScore + guestsScore + createdScore
}

function buildDuplicateGroups(submissions) {
  const active = submissions.filter((item) => item.excludedFromMetrics !== true)
  const byName = new Map()
  const byPhone = new Map()
  const parent = new Map()

  function ensureParent(id) {
    if (!parent.has(id)) parent.set(id, id)
  }

  function find(id) {
    const currentParent = parent.get(id)
    if (currentParent === id) return id
    const root = find(currentParent)
    parent.set(id, root)
    return root
  }

  function union(a, b) {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }

  active.forEach((item) => {
    ensureParent(item.id)
    const phone = normalizePhone(item.phone)
    const name = normalizeName(item.name)
    if (name.length >= 6) {
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name).push(item)
    }
    if (phone.length >= 8) {
      if (!byPhone.has(phone)) byPhone.set(phone, [])
      byPhone.get(phone).push(item)
    }
  })

  const buckets = [
    ...[...byName.entries()].map(([value, items]) => ({ reason: 'name', value, items })),
    ...[...byPhone.entries()].map(([value, items]) => ({ reason: 'phone', value, items })),
  ]

  buckets.forEach(({ items }) => {
    if (items.length < 2) return
    const [first, ...rest] = items
    rest.forEach((item) => union(first.id, item.id))
  })

  const components = new Map()
  active.forEach((item) => {
    const root = find(item.id)
    if (!components.has(root)) components.set(root, [])
    components.get(root).push(item)
  })

  const groups = []

  components.forEach((items) => {
    if (items.length < 2) return
    const ordered = [...items].sort((a, b) => scoreSubmission(b) - scoreSubmission(a))
    const canonical = ordered[0]
    const repeatedNames = new Set()
    const repeatedPhones = new Set()

    byName.forEach((bucketItems, value) => {
      const matches = bucketItems.filter((entry) => ordered.some((item) => item.id === entry.id))
      if (matches.length >= 2) repeatedNames.add(value)
    })

    byPhone.forEach((bucketItems, value) => {
      const matches = bucketItems.filter((entry) => ordered.some((item) => item.id === entry.id))
      if (matches.length >= 2) repeatedPhones.add(value)
    })

    const matchedBy = []
    if (repeatedNames.size) matchedBy.push('name')
    if (repeatedPhones.size) matchedBy.push('phone')
    if (!matchedBy.length) return

    let reason = 'mixed'
    if (matchedBy.length === 2) reason = 'name_phone'
    else if (matchedBy[0] === 'name') reason = 'name'
    else if (matchedBy[0] === 'phone') reason = 'phone'

    const primaryName = repeatedNames.values().next().value ?? normalizeName(canonical.name)
    const primaryPhone = repeatedPhones.values().next().value ?? normalizePhone(canonical.phone)
    groups.push({
      key: `${reason}:${primaryName || 'sem_nome'}:${primaryPhone || 'sem_telefone'}`,
      reason,
      canonicalSubmissionId: canonical.id,
      submissionIds: ordered.map((item) => item.id),
      canonicalName: canonical.name,
      canonicalPhone: canonical.phone,
      totalGuestsPreview: ordered.reduce((sum, item) => sum + (Number(item.totalGuests) || 0), 0),
      matchedBy,
      entries: ordered.map((item) => ({
        id: item.id,
        name: item.name,
        phone: item.phone,
        adults: Number(item.adults) || 0,
        children: Number(item.children) || 0,
        totalGuests: Number(item.totalGuests) || 0,
        attending: typeof item.attending === 'boolean' ? item.attending : undefined,
      })),
    })
  })

  return groups
}

async function writeRsvpConsolidationSnapshot(db, trigger, actor) {
  const snapshot = await db.collection('rsvpSubmissions').get()
  const submissions = snapshot.docs.map((document) => {
    const data = document.data()
    return {
      id: document.id,
      name: typeof data.name === 'string' ? data.name : '',
      phone: typeof data.phone === 'string' ? data.phone : '',
      attending: typeof data.attending === 'boolean' ? data.attending : undefined,
      adults: Number(data.adults) || 0,
      children: Number(data.children) || 0,
      totalGuests: Number(data.totalGuests) || 0,
      createdAt: data.createdAt ?? null,
      excludedFromMetrics: data.excludedFromMetrics === true,
    }
  })

  const groups = buildDuplicateGroups(submissions)
  const duplicateSubmissionCount = groups.reduce((total, group) => total + group.submissionIds.length, 0)
  const now = FieldValue.serverTimestamp()

  // Sanitizar groups para remover valores undefined que causam erro no Firestore
  const sanitizedGroups = groups.map((group) => ({
    key: group.key,
    reason: group.reason,
    canonicalSubmissionId: group.canonicalSubmissionId,
    submissionIds: group.submissionIds,
    canonicalName: group.canonicalName,
    canonicalPhone: group.canonicalPhone,
    totalGuestsPreview: group.totalGuestsPreview,
    matchedBy: group.matchedBy,
    entries: group.entries.map((entry) => {
      const sanitized = {
        id: entry.id,
        name: entry.name,
        phone: entry.phone,
        adults: entry.adults,
        children: entry.children,
        totalGuests: entry.totalGuests,
      }
      // Apenas adicionar attending se for um booleano válido
      if (typeof entry.attending === 'boolean') {
        sanitized.attending = entry.attending
      }
      return sanitized
    }),
  }))

  try {
    await db.doc('rsvpConsolidation/current').set({
      generatedAt: now,
      trigger,
      actor,
      hasDuplicates: sanitizedGroups.length > 0,
      duplicateGroupCount: sanitizedGroups.length,
      duplicateSubmissionCount,
      groups: sanitizedGroups,
      message: sanitizedGroups.length
        ? `Foram encontrados ${sanitizedGroups.length} grupos suspeitos para revisão manual.`
        : 'Nenhum grupo suspeito foi encontrado na varredura atual.',
    }, { merge: true })

    await db.collection('rsvpConsolidationHistory').add({
      createdAt: now,
      kind: 'scan',
      trigger,
      actor,
      hasDuplicates: sanitizedGroups.length > 0,
      duplicateGroupCount: sanitizedGroups.length,
      duplicateSubmissionCount,
      groups: sanitizedGroups,
    })
  } catch (error) {
    console.error('Erro ao escrever consolidação RSVP:', error)
    throw error
  }

  return { groups: sanitizedGroups, duplicateSubmissionCount }
}

exports.scanRsvpDuplicatesNow = onCall({ region, timeoutSeconds: 60, cors: callableCors }, async (request) => {
  const requester = await getRequester(request)
  if (!requester.canConsolidateRsvp) {
    throw new HttpsError('permission-denied', 'Seu papel não permite atualizar a análise de duplicidades.')
  }

  try {
    const db = getFirestore()
    const { groups, duplicateSubmissionCount } = await writeRsvpConsolidationSnapshot(db, 'manual-refresh', requester.auth.uid)
    return {
      hasDuplicates: groups.length > 0,
      duplicateGroupCount: groups.length,
      duplicateSubmissionCount,
      message: groups.length
        ? `Análise atualizada com ${groups.length} grupo(s) suspeito(s).`
        : 'Análise atualizada sem grupos suspeitos.',
    }
  } catch (error) {
    console.error('Erro ao escanear duplicatas RSVP:', error)
    throw new HttpsError('internal', 'Erro ao atualizar análise de duplicidades. Verifique se há dados válidos nas submissões.')
  }
})

async function getRequester(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.')

  try {
    const profile = await getFirestore().doc(`users/${request.auth.uid}`).get()
    const role = profile.exists ? profile.get('role') : ''
    return {
      auth: request.auth,
      role,
      canManage: profile.exists && canManageUsers(role),
      canConsolidateRsvp: profile.exists && canManageRsvpConsolidation(role),
    }
  } catch (error) {
    console.error('Erro ao obter dados do requester:', error)
    throw new HttpsError('internal', 'Erro ao verificar permissões. Tente novamente.')
  }
}

async function requireUserManager(request) {
  const requester = await getRequester(request)
  if (!requester.canManage) throw new HttpsError('permission-denied', 'Seu papel não permite gerenciar usuários.')
  return requester.auth
}

exports.listAuthenticationUsers = onCall({ region, timeoutSeconds: 60, cors: callableCors }, async (request) => {
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

exports.updateAuthenticationUserRole = onCall({ region, cors: callableCors }, async (request) => {
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

exports.scanRsvpDuplicates = onSchedule({ region, schedule: 'every 30 minutes', timeZone: 'America/Sao_Paulo' }, async () => {
  const db = getFirestore()
  await writeRsvpConsolidationSnapshot(db, 'scheduler', 'system')
})

exports.consolidateRsvpDuplicates = onCall({ region, timeoutSeconds: 120, cors: callableCors }, async (request) => {
  const requester = await getRequester(request)
  if (!requester.canConsolidateRsvp) {
    throw new HttpsError('permission-denied', 'Seu papel não permite consolidar confirmações de presença.')
  }

  const groupKey = typeof request.data?.groupKey === 'string' ? request.data.groupKey.trim() : ''
  const name = typeof request.data?.name === 'string' ? request.data.name.trim() : ''
  const phone = typeof request.data?.phone === 'string' ? request.data.phone.trim() : ''
  const adults = Math.max(0, Number(request.data?.adults) || 0)
  const children = Math.max(0, Number(request.data?.children) || 0)
  const totalGuests = adults + children
  const attending = typeof request.data?.attending === 'boolean'
    ? request.data.attending
    : totalGuests > 0
  const requestedArchiveIds = Array.isArray(request.data?.archiveSubmissionIds)
    ? [...new Set(request.data.archiveSubmissionIds.map((value) => String(value).trim()).filter(Boolean))]
    : []

  if (!groupKey || !name) {
    throw new HttpsError('invalid-argument', 'Grupo e nome do registro consolidado são obrigatórios.')
  }

  const db = getFirestore()
  const runId = db.collection('rsvpConsolidationHistory').doc().id
  const { groups } = await writeRsvpConsolidationSnapshot(db, 'manual', requester.auth.uid)
  const group = groups.find((item) => item.key === groupKey)

  if (!group) {
    await db.collection('rsvpConsolidationHistory').doc(runId).set({
      createdAt: FieldValue.serverTimestamp(),
      kind: 'consolidation',
      actorUserId: requester.auth.uid,
      actorEmail: requester.auth.token.email ?? '',
      groupKey,
      archivedSubmissions: 0,
      message: 'Grupo de duplicidade não encontrado. Atualize a tela e tente novamente.',
    })
    throw new HttpsError('failed-precondition', 'Grupo de duplicidade não encontrado. Atualize a tela e tente novamente.')
  }

  const archiveIds = group.submissionIds.filter((id) => requestedArchiveIds.includes(id))
  if (archiveIds.length < 2) {
    throw new HttpsError('invalid-argument', 'Selecione ao menos dois envios para arquivar como duplicados.')
  }

   const batch = db.batch()
   const canonicalReference = db.collection('rsvpSubmissions').doc()

   try {
     batch.set(canonicalReference, {
       name,
       phone,
       adults,
       children,
       totalGuests,
       attending,
       createdAt: FieldValue.serverTimestamp(),
       updatedAt: FieldValue.serverTimestamp(),
       consolidationStatus: 'manual_canonical',
       excludedFromMetrics: false,
       duplicateGroupKey: group.key,
       consolidatedFromSubmissionIds: archiveIds,
       createdByUserId: requester.auth.uid,
       createdByEmail: requester.auth.token.email ?? '',
     }, { merge: true })

     archiveIds.forEach((submissionId) => {
       const reference = db.doc(`rsvpSubmissions/${submissionId}`)
       batch.set(reference, {
         consolidationStatus: 'archived_duplicate',
         duplicateOfSubmissionId: canonicalReference.id,
         duplicateGroupKey: group.key,
         excludedFromMetrics: true,
         archivedAt: FieldValue.serverTimestamp(),
         updatedAt: FieldValue.serverTimestamp(),
         updatedByUserId: requester.auth.uid,
         updatedByEmail: requester.auth.token.email ?? '',
       }, { merge: true })
     })

     await batch.commit()
   } catch (error) {
     console.error('Erro ao consolidar submissões:', error)
     throw new HttpsError('internal', 'Erro ao criar registro consolidado. Tente novamente.')
   }

   try {
     await writeRsvpConsolidationSnapshot(db, 'post-consolidation', requester.auth.uid)
   } catch (error) {
     console.error('Erro ao atualizar consolidação pós-processamento:', error)
     // Não lançar erro aqui, pois os dados principais já foram salvos
   }

   try {
     await db.collection('rsvpConsolidationHistory').doc(runId).set({
       createdAt: FieldValue.serverTimestamp(),
       kind: 'consolidation_manual_form',
       actorUserId: requester.auth.uid,
       actorEmail: requester.auth.token.email ?? '',
       groupKey: group.key,
       newSubmissionId: canonicalReference.id,
       archivedSubmissions: archiveIds.length,
       archivedSubmissionIds: archiveIds,
       message: `Registro consolidado criado e ${archiveIds.length} envio(s) foram arquivados.`,
     })
   } catch (error) {
     console.error('Erro ao registrar no histórico:', error)
     // Não lançar erro aqui, pois os dados principais já foram salvos
   }

  return {
    runId,
    newSubmissionId: canonicalReference.id,
    archivedSubmissions: archiveIds.length,
    message: `Registro consolidado criado e ${archiveIds.length} envio(s) foram arquivados.`,
  }
})

const assistant = require('./assistant')

exports.listAssistantThreads = assistant.listAssistantThreads
exports.getAssistantThread = assistant.getAssistantThread
exports.assistantChat = assistant.assistantChat
exports.confirmTaskProposal = assistant.confirmTaskProposal
exports.archiveAssistantThread = assistant.archiveAssistantThread
