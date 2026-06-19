const { genkit, z } = require('genkit')
const { vertexAI } = require('@genkit-ai/google-genai')
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore')
const { HttpsError, onCall } = require('firebase-functions/v2/https')

const region = 'us-central1'
const maxMessagesPerDay = 50
const maxProposalTasks = 20
const threadPageSize = 30
const modelName = process.env.GENKIT_MODEL || 'gemini-2.5-flash'
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === 'true'

const ai = genkit({
  plugins: [vertexAI({ location: process.env.GENKIT_LOCATION || 'global' })],
})

const taskStatusSchema = z.enum(['todo', 'in_progress', 'done'])
const taskPrioritySchema = z.enum(['low', 'medium', 'high'])
const proposedTaskSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(1500).default(''),
  priority: taskPrioritySchema,
  dueDate: z.string().max(10).default(''),
  rationale: z.string().max(500).default(''),
})
const assistantOutputSchema = z.object({
  answer: z.string().min(1).max(12000),
  insights: z.array(z.object({
    title: z.string().max(120),
    severity: z.enum(['info', 'attention', 'urgent']),
    body: z.string().max(1000),
    evidence: z.array(z.string().max(300)).max(5).default([]),
  })).max(5).default([]),
  proposedTasks: z.array(proposedTaskSchema).max(maxProposalTasks).default([]),
  suggestedPrompts: z.array(z.string().max(160)).max(3).default([]),
})

function normalizeRole(role) {
  return String(role || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function roleLanguage(role) {
  const normalized = normalizeRole(role)
  if (['assessor', 'assessora', 'assessor(a)'].includes(normalized)) {
    return 'Use linguagem objetiva e operacional, destacando execucao, dependencias e prazos.'
  }
  if (['noivo', 'noiva'].includes(normalized)) {
    return 'Use linguagem acolhedora, clara e colaborativa, focada nas decisoes do casal.'
  }
  return `Use linguagem neutra e profissional adequada ao papel "${String(role || 'usuario')}". Nao infira genero ou autoridade.`
}

async function getRequester(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login para usar o assistente.')
  const profile = await getFirestore().doc(`users/${request.auth.uid}`).get()
  if (!profile.exists) throw new HttpsError('failed-precondition', 'Complete seu perfil antes de usar o assistente.')
  return {
    uid: request.auth.uid,
    email: request.auth.token.email || '',
    name: String(profile.get('name') || request.auth.token.name || 'Usuario'),
    role: String(profile.get('role') || 'Usuario'),
  }
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function timestampIso(value) {
  return value && typeof value.toDate === 'function' ? value.toDate().toISOString() : null
}

function validDate(value) {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function safeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function serializeThread(snapshot) {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    title: String(data.title || 'Nova conversa'),
    lastMessagePreview: String(data.lastMessagePreview || ''),
    status: data.status === 'archived' ? 'archived' : 'active',
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
  }
}

function serializeMessage(snapshot) {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    role: data.role === 'assistant' ? 'assistant' : 'user',
    text: String(data.text || ''),
    status: String(data.status || 'completed'),
    createdAt: timestampIso(data.createdAt),
    sources: Array.isArray(data.sources) ? data.sources : [],
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
  }
}

async function requireOwnedThread(threadId, requester) {
  if (!threadId) throw new HttpsError('invalid-argument', 'Conversa nao informada.')
  const reference = getFirestore().doc(`chatThreads/${threadId}`)
  const snapshot = await reference.get()
  if (!snapshot.exists || snapshot.get('createdByUserId') !== requester.uid) {
    throw new HttpsError('not-found', 'Conversa nao encontrada.')
  }
  return { reference, snapshot }
}

async function consumeDailyQuota(uid) {
  const key = `${uid}_${todayInSaoPaulo()}`
  const reference = getFirestore().doc(`assistantUsage/${key}`)
  await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const count = Number(snapshot.get('messageCount') || 0)
    if (count >= maxMessagesPerDay) {
      throw new HttpsError('resource-exhausted', 'Voce atingiu o limite diario de 50 mensagens.')
    }
    transaction.set(reference, {
      userId: uid,
      date: todayInSaoPaulo(),
      messageCount: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
}

const getWeddingContext = ai.defineTool({
  name: 'getWeddingContext',
  description: 'Consulta o perfil, data, horario e local do casamento. Use para qualquer orientacao de cronograma.',
  inputSchema: z.object({}),
  outputSchema: z.any(),
}, async () => {
  const snapshot = await getFirestore().doc('settings/weddingProfile').get()
  const profile = snapshot.exists ? snapshot.data() : null
  return {
    today: todayInSaoPaulo(),
    timezone: 'America/Sao_Paulo',
    wedding: profile ? {
      coupleNames: profile.coupleNames || [],
      weddingDate: profile.weddingDate || '',
      ceremonyTime: profile.ceremonyTime || '',
      city: profile.city || '',
      state: profile.state || '',
      venue: profile.venue || '',
      venueDetails: profile.venueDetails || '',
      expectedGuestCount: profile.expectedGuestCount ?? null,
      budgetAmount: profile.budgetAmount ?? null,
      style: profile.style || '',
      ceremonyType: profile.ceremonyType || '',
      priorities: profile.priorities || [],
      constraints: profile.constraints || [],
    } : null,
  }
})

const getPlanningSummary = ai.defineTool({
  name: 'getPlanningSummary',
  description: 'Calcula o resumo geral de tarefas, convidados, presentes e agenda com dados atuais do Firestore.',
  inputSchema: z.object({}),
  outputSchema: z.any(),
}, async () => {
  const db = getFirestore()
  const [tasksSnapshot, guestsSnapshot, giftsSnapshot, agendaSnapshot] = await Promise.all([
    db.collection('tasks').get(), db.collection('rsvpSubmissions').get(),
    db.collection('giftRegistryItems').get(), db.collection('agendaEvents').get(),
  ])
  const today = todayInSaoPaulo()
  const tasks = tasksSnapshot.docs.map((doc) => doc.data())
  const confirmed = guestsSnapshot.docs.map((doc) => doc.data())
    .filter((item) => item.attending !== false && Number(item.totalGuests) > 0)
  const gifts = giftsSnapshot.docs.map((doc) => doc.data())
  const activeGifts = gifts.filter((item) => !item.disabled)
  const categories = {}
  activeGifts.forEach((item) => { categories[item.giftType || 'outros'] = (categories[item.giftType || 'outros'] || 0) + 1 })
  return {
    calculatedAt: new Date().toISOString(),
    tasks: {
      total: tasks.length,
      todo: tasks.filter((item) => item.status === 'todo').length,
      inProgress: tasks.filter((item) => item.status === 'in_progress').length,
      done: tasks.filter((item) => item.status === 'done').length,
      overdue: tasks.filter((item) => item.status !== 'done' && item.dueDate && item.dueDate < today).length,
    },
    guests: {
      submissions: guestsSnapshot.size,
      confirmedPeople: confirmed.reduce((sum, item) => sum + Number(item.totalGuests || 0), 0),
      adults: confirmed.reduce((sum, item) => sum + Number(item.adults || 0), 0),
      children: confirmed.reduce((sum, item) => sum + Number(item.children || 0), 0),
      declinedSubmissions: guestsSnapshot.docs.filter((doc) => doc.get('attending') === false).length,
    },
    gifts: {
      active: activeGifts.length,
      available: activeGifts.filter((item) => !item.received).length,
      received: activeGifts.filter((item) => item.received).length,
      byType: categories,
    },
    agenda: {
      upcoming: agendaSnapshot.docs.filter((doc) => String(doc.get('date') || '') >= today).length,
    },
  }
})

const searchTasks = ai.defineTool({
  name: 'searchTasks',
  description: 'Busca tarefas reais para analisar atrasos, prioridades, duplicidade e proximos passos.',
  inputSchema: z.object({
    query: z.string().optional(),
    statuses: z.array(taskStatusSchema).optional(),
    priorities: z.array(taskPrioritySchema).optional(),
    includeOverdue: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  outputSchema: z.any(),
}, async (input) => {
  const snapshot = await getFirestore().collection('tasks').limit(200).get()
  const term = String(input.query || '').toLocaleLowerCase('pt-BR')
  const today = todayInSaoPaulo()
  const filtered = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((task) => {
    if (input.statuses?.length && !input.statuses.includes(task.status)) return false
    if (input.priorities?.length && !input.priorities.includes(task.priority)) return false
    if (input.includeOverdue && !(task.status !== 'done' && task.dueDate && task.dueDate < today)) return false
    if (term && !`${task.title || ''} ${task.description || ''}`.toLocaleLowerCase('pt-BR').includes(term)) return false
    return true
  }).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
  const limit = input.limit || 30
  return {
    tasks: filtered.slice(0, limit).map((task) => ({
      id: task.id, title: task.title || '', description: task.description || '',
      status: task.status || 'todo', priority: task.priority || 'medium', dueDate: task.dueDate || '',
    })),
    truncated: filtered.length > limit,
  }
})

const getGuestSummary = ai.defineTool({
  name: 'getGuestSummary',
  description: 'Consulta agregados da lista de convidados. Nao retorna telefones.',
  inputSchema: z.object({ includeRecentResponses: z.boolean().optional() }),
  outputSchema: z.any(),
}, async (input) => {
  const snapshot = await getFirestore().collection('rsvpSubmissions').orderBy('createdAt', 'desc').limit(200).get()
  const values = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  const confirmed = values.filter((item) => item.attending !== false && Number(item.totalGuests) > 0)
  return {
    submissions: values.length,
    confirmedPeople: confirmed.reduce((sum, item) => sum + Number(item.totalGuests || 0), 0),
    adults: confirmed.reduce((sum, item) => sum + Number(item.adults || 0), 0),
    children: confirmed.reduce((sum, item) => sum + Number(item.children || 0), 0),
    declinedSubmissions: values.filter((item) => item.attending === false).length,
    recentResponses: input.includeRecentResponses ? values.slice(0, 10).map((item) => ({
      id: item.id, name: item.name || '', attending: item.attending !== false,
      totalGuests: Number(item.totalGuests || 0), createdAt: timestampIso(item.createdAt),
    })) : undefined,
  }
})

const getGiftSummary = ai.defineTool({
  name: 'getGiftSummary',
  description: 'Consulta equilibrio, disponibilidade e categorias da lista de presentes.',
  inputSchema: z.object({}),
  outputSchema: z.any(),
}, async () => {
  const snapshot = await getFirestore().collection('giftRegistryItems').get()
  const values = snapshot.docs.map((doc) => doc.data())
  const active = values.filter((item) => !item.disabled)
  const byType = {}
  active.forEach((item) => { byType[item.giftType || 'outros'] = (byType[item.giftType || 'outros'] || 0) + 1 })
  return {
    active: active.length,
    available: active.filter((item) => !item.received).length,
    received: active.filter((item) => item.received).length,
    disabled: values.filter((item) => item.disabled).length,
    byType,
    itemsWithoutProductLink: active.filter((item) => !item.productLink).length,
    itemsWithoutImage: active.filter((item) => !item.image).length,
  }
})

const getUpcomingAgenda = ai.defineTool({
  name: 'getUpcomingAgenda',
  description: 'Consulta compromissos futuros da agenda mesmo que a tela de agenda esteja desativada.',
  inputSchema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
  outputSchema: z.any(),
}, async (input) => {
  const snapshot = await getFirestore().collection('agendaEvents').where('date', '>=', todayInSaoPaulo())
    .orderBy('date').limit(input.limit || 15).get()
  return { events: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) }
})

const systemPrompt = `Voce e o Especialista Serenata, um assistente de organizacao de casamentos.
Ajude o casal e a assessoria com cronograma, convidados, RSVP, tarefas, agenda, fornecedores, cerimonia, recepcao, presentes, comunicacao, logistica e orcamento do casamento.
Permaneca nesse dominio. Para outro tema, explique brevemente a limitacao e redirecione ao casamento.
Use as tools sempre que a pergunta depender dos dados atuais. Nunca invente dados ausentes.
Diferencie fatos observados, inferencias e recomendacoes. Nao exponha telefone ou dado pessoal desnecessario.
Pode propor tarefas, mas uma proposta ainda depende de revisao e confirmacao do usuario. Nunca diga que uma tarefa foi criada.
Responda em portugues do Brasil, de forma pratica. Use datas absolutas. Priorize ate cinco proximos passos, salvo pedido de plano completo.
Quando propuser tarefas, evite duplicatas consultando searchTasks e preencha proposedTasks. Quando nao houver proposta, retorne proposedTasks vazio.`

async function generateAssistantReply(requester, message, history) {
  const historyText = history.map((item) => `${item.role === 'assistant' ? 'Assistente' : 'Usuario'}: ${item.text}`).join('\n')
  const response = await ai.generate({
    model: vertexAI.model(modelName),
    system: `${systemPrompt}\n\nPAPEL E LINGUAGEM\nUsuario: ${requester.name}\nPapel: ${requester.role}\n${roleLanguage(requester.role)}`,
    prompt: `${historyText ? `HISTORICO RECENTE\n${historyText}\n\n` : ''}MENSAGEM ATUAL\n${message}`,
    tools: [getWeddingContext, getPlanningSummary, searchTasks, getGuestSummary, getGiftSummary, getUpcomingAgenda],
    output: { schema: assistantOutputSchema },
    config: { temperature: 0.3, maxOutputTokens: 2500 },
  })
  if (!response.output) throw new Error('O modelo nao retornou uma resposta estruturada.')
  return response.output
}

function normalizeProposedTasks(tasks) {
  const today = todayInSaoPaulo()
  return tasks.slice(0, maxProposalTasks).map((task, index) => {
    const dueDate = safeText(task.dueDate, 10)
    return {
      clientId: `task-${index + 1}`,
      title: safeText(task.title, 120),
      description: safeText(task.description, 1500),
      priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority : 'medium',
      dueDate: validDate(dueDate) && dueDate >= today ? dueDate : '',
      rationale: safeText(task.rationale, 500),
      duplicateCandidateTaskId: null,
    }
  }).filter((task) => task.title.length >= 3)
}

async function markDuplicateCandidates(tasks) {
  if (!tasks.length) return tasks
  const snapshot = await getFirestore().collection('tasks').where('status', 'in', ['todo', 'in_progress']).limit(100).get()
  const existing = snapshot.docs.map((doc) => ({ id: doc.id, normalized: safeText(doc.get('title'), 120).toLocaleLowerCase('pt-BR') }))
  return tasks.map((task) => {
    const normalized = task.title.toLocaleLowerCase('pt-BR')
    const duplicate = existing.find((item) => item.normalized === normalized || (normalized.length > 12 && (item.normalized.includes(normalized) || normalized.includes(item.normalized))))
    return { ...task, duplicateCandidateTaskId: duplicate?.id || null }
  })
}

exports.listAssistantThreads = onCall({ region, enforceAppCheck }, async (request) => {
  const requester = await getRequester(request)
  const snapshot = await getFirestore().collection('chatThreads')
    .where('createdByUserId', '==', requester.uid).limit(threadPageSize).get()
  const threads = snapshot.docs.map(serializeThread).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return { threads }
})

exports.getAssistantThread = onCall({ region, enforceAppCheck }, async (request) => {
  const requester = await getRequester(request)
  const threadId = safeText(request.data?.threadId, 128)
  const { reference, snapshot } = await requireOwnedThread(threadId, requester)
  const messages = await reference.collection('messages').orderBy('createdAt', 'asc').limit(100).get()
  return { thread: serializeThread(snapshot), messages: messages.docs.map(serializeMessage) }
})

exports.assistantChat = onCall({ region, enforceAppCheck, timeoutSeconds: 120, memory: '1GiB' }, async (request) => {
  const requester = await getRequester(request)
  const message = safeText(request.data?.message, 4000)
  if (!message) throw new HttpsError('invalid-argument', 'Digite uma mensagem para o assistente.')
  await consumeDailyQuota(requester.uid)

  const db = getFirestore()
  let threadReference
  let threadSnapshot
  const requestedThreadId = safeText(request.data?.threadId, 128)
  if (requestedThreadId) {
    const owned = await requireOwnedThread(requestedThreadId, requester)
    threadReference = owned.reference
    threadSnapshot = owned.snapshot
  } else {
    threadReference = db.collection('chatThreads').doc()
    await threadReference.set({
      title: message.slice(0, 60), createdByUserId: requester.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      lastMessagePreview: message.slice(0, 140), status: 'active',
    })
    threadSnapshot = await threadReference.get()
  }

  const previous = await threadReference.collection('messages').orderBy('createdAt', 'desc').limit(12).get()
  const history = previous.docs.reverse().map((doc) => ({ role: doc.get('role'), text: safeText(doc.get('text'), 4000) }))
  const userMessageReference = threadReference.collection('messages').doc()
  await userMessageReference.set({
    role: 'user', text: message, status: 'completed', createdByUserId: requester.uid,
    createdAt: FieldValue.serverTimestamp(), sources: [], blocks: [],
  })

  try {
    const output = await generateAssistantReply(requester, message, history)
    const tasks = await markDuplicateCandidates(normalizeProposedTasks(output.proposedTasks || []))
    const blocks = (output.insights || []).map((insight) => ({ type: 'insight', ...insight }))
    let proposal = null
    if (tasks.length) {
      const proposalReference = threadReference.collection('proposals').doc()
      const expiresAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
      await proposalReference.set({
        status: 'pending', tasks, createdByUserId: requester.uid,
        createdAt: FieldValue.serverTimestamp(), expiresAt,
        confirmedByUserId: null, confirmedAt: null, createdTaskIds: [],
      })
      proposal = { id: proposalReference.id, tasks, expiresAt: expiresAt.toDate().toISOString() }
      blocks.push({ type: 'task_proposal', proposalId: proposal.id, tasks, expiresAt: proposal.expiresAt })
    }
    const sources = [{ collection: 'assistant', label: 'Especialista Serenata', snapshotAt: new Date().toISOString() }]
    const assistantMessageReference = threadReference.collection('messages').doc()
    await assistantMessageReference.set({
      role: 'assistant', text: output.answer, status: 'completed', createdByUserId: null,
      createdAt: FieldValue.serverTimestamp(), model: modelName, sources, blocks,
      suggestedPrompts: output.suggestedPrompts || [],
    })
    await threadReference.update({ updatedAt: FieldValue.serverTimestamp(), lastMessagePreview: output.answer.slice(0, 140) })
    return {
      thread: serializeThread(await threadReference.get()),
      userMessage: serializeMessage(await userMessageReference.get()),
      assistantMessage: serializeMessage(await assistantMessageReference.get()),
      proposal,
      suggestedPrompts: output.suggestedPrompts || [],
    }
  } catch (error) {
    console.error('Erro no assistente:', error)
    const failedReference = threadReference.collection('messages').doc()
    await failedReference.set({
      role: 'assistant', text: 'Nao consegui concluir essa resposta agora. Tente novamente em instantes.',
      status: 'failed', createdByUserId: null, createdAt: FieldValue.serverTimestamp(), sources: [], blocks: [],
    })
    throw new HttpsError('internal', 'Nao foi possivel consultar o especialista agora.')
  }
})

exports.confirmTaskProposal = onCall({ region, enforceAppCheck }, async (request) => {
  const requester = await getRequester(request)
  const threadId = safeText(request.data?.threadId, 128)
  const proposalId = safeText(request.data?.proposalId, 128)
  const idempotencyKey = safeText(request.data?.idempotencyKey, 128)
  const submittedTasks = Array.isArray(request.data?.tasks) ? request.data.tasks.slice(0, maxProposalTasks) : []
  if (!proposalId || !idempotencyKey || !submittedTasks.length) {
    throw new HttpsError('invalid-argument', 'Proposta, tarefas e chave de confirmacao sao obrigatorias.')
  }
  const { reference: threadReference } = await requireOwnedThread(threadId, requester)
  const proposalReference = threadReference.collection('proposals').doc(proposalId)
  const selectedTasks = submittedTasks.filter((task) => task.selected !== false).map((task) => {
    const dueDate = safeText(task.dueDate, 10)
    const normalized = {
      clientId: safeText(task.clientId, 80), title: safeText(task.title, 120),
      description: safeText(task.description, 1500),
      priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority : 'medium',
      dueDate,
    }
    if (normalized.title.length < 3 || !validDate(dueDate)) {
      throw new HttpsError('invalid-argument', 'Uma das tarefas possui titulo ou data invalida.')
    }
    return normalized
  })
  if (!selectedTasks.length) throw new HttpsError('invalid-argument', 'Selecione ao menos uma tarefa.')

  const taskReferences = selectedTasks.map(() => getFirestore().collection('tasks').doc())
  const auditReferences = selectedTasks.map(() => getFirestore().collection('auditLogs').doc())
  const result = await getFirestore().runTransaction(async (transaction) => {
    const proposalSnapshot = await transaction.get(proposalReference)
    if (!proposalSnapshot.exists || proposalSnapshot.get('createdByUserId') !== requester.uid) {
      throw new HttpsError('not-found', 'Proposta nao encontrada.')
    }
    if (proposalSnapshot.get('status') === 'confirmed') {
      return { taskIds: proposalSnapshot.get('createdTaskIds') || [], alreadyConfirmed: true }
    }
    if (proposalSnapshot.get('status') !== 'pending' || proposalSnapshot.get('expiresAt')?.toMillis() < Date.now()) {
      throw new HttpsError('failed-precondition', 'Esta proposta expirou ou nao esta mais disponivel.')
    }
    const originalIds = new Set((proposalSnapshot.get('tasks') || []).map((task) => task.clientId))
    if (selectedTasks.some((task) => !originalIds.has(task.clientId))) {
      throw new HttpsError('invalid-argument', 'A proposta contem uma tarefa desconhecida.')
    }
    selectedTasks.forEach((task, index) => {
      const persisted = {
        title: task.title, description: task.description, status: 'todo', priority: task.priority,
        dueDate: task.dueDate, order: Date.now() + index,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        createdByUserId: requester.uid, createdByEmail: requester.email,
        updatedByUserId: requester.uid, updatedByEmail: requester.email,
        origin: 'assistant', assistantThreadId: threadId, assistantProposalId: proposalId,
      }
      transaction.set(taskReferences[index], persisted)
      transaction.set(auditReferences[index], {
        action: 'create', collection: 'tasks', documentId: taskReferences[index].id,
        userId: requester.uid, userEmail: requester.email, origin: 'assistant',
        assistantThreadId: threadId, assistantProposalId: proposalId,
        changes: Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'clientId').map(([key, value]) => [key, { before: null, after: value }])),
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    transaction.update(proposalReference, {
      status: 'confirmed', confirmedByUserId: requester.uid, confirmedAt: FieldValue.serverTimestamp(),
      idempotencyKey, createdTaskIds: taskReferences.map((reference) => reference.id),
    })
    return { taskIds: taskReferences.map((reference) => reference.id), alreadyConfirmed: false }
  })
  return { status: 'confirmed', createdTaskIds: result.taskIds, alreadyConfirmed: result.alreadyConfirmed }
})

exports.archiveAssistantThread = onCall({ region, enforceAppCheck }, async (request) => {
  const requester = await getRequester(request)
  const { reference } = await requireOwnedThread(safeText(request.data?.threadId, 128), requester)
  await reference.update({ status: 'archived', updatedAt: FieldValue.serverTimestamp() })
  return { status: 'archived' }
})
