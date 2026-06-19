import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Archive, Check, ChevronLeft, History, ListTodo, LoaderCircle, MessageCircle, Plus, Send, Sparkles, X } from 'lucide-react'
import { archiveAssistantThread, confirmTaskProposal, getAssistantThread, listAssistantThreads, sendAssistantMessage } from '../../lib/assistant'
import type { AssistantBlock, AssistantMessage, AssistantThread, ProposedTask } from '../../types/assistant'

const starterPrompts = [
  'O que precisa da minha atenção esta semana?',
  'Analise minhas tarefas e diga quais estão em risco.',
  'Quantas pessoas confirmaram presença?',
  'Crie um plano de tarefas para os próximos 30 dias.',
]

function errorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : ''
  if (message.includes('resource-exhausted')) return 'Você atingiu o limite diário de mensagens.'
  if (message.includes('unauthenticated')) return 'Sua sessão expirou. Entre novamente para continuar.'
  if (message.includes('failed-precondition')) return 'Complete os dados necessários antes de continuar.'
  return 'Não foi possível falar com o especialista agora. Tente novamente.'
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [threads, setThreads] = useState<AssistantThread[]>([])
  const [threadId, setThreadId] = useState<string>()
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState(starterPrompts)
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const mobile = window.matchMedia('(max-width: 850px)').matches
    const previousOverflow = document.body.style.overflow
    if (mobile) document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => composerRef.current?.focus(), 50)

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        window.setTimeout(() => launcherRef.current?.focus(), 0)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [href]'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  function openAssistant() {
    setOpen(true)
    setLoadingThreads(true)
    listAssistantThreads()
      .then(setThreads)
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setLoadingThreads(false))
  }

  function close() {
    if (!sending) {
      setOpen(false)
      window.setTimeout(() => launcherRef.current?.focus(), 0)
    }
  }

  function startNewThread() {
    setThreadId(undefined)
    setMessages([])
    setSuggestions(starterPrompts)
    setHistoryOpen(false)
    setError('')
    window.setTimeout(() => composerRef.current?.focus(), 0)
  }

  async function openThread(thread: AssistantThread) {
    setLoadingThread(true)
    setError('')
    try {
      const result = await getAssistantThread(thread.id)
      setThreadId(thread.id)
      setMessages(result.messages)
      setSuggestions(starterPrompts)
      setHistoryOpen(false)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoadingThread(false)
    }
  }

  async function archiveCurrentThread() {
    if (!threadId || sending) return
    try {
      await archiveAssistantThread(threadId)
      setThreads((current) => current.filter((thread) => thread.id !== threadId))
      startNewThread()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function send(message = draft) {
    const text = message.trim()
    if (!text || sending) return
    const optimistic: AssistantMessage = {
      id: `local-${Date.now()}`, role: 'user', text, status: 'completed',
      createdAt: new Date().toISOString(), sources: [], blocks: [],
    }
    setMessages((current) => [...current, optimistic])
    setDraft('')
    setError('')
    setSending(true)
    try {
      const result = await sendAssistantMessage(text, threadId)
      setThreadId(result.thread.id)
      setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), result.userMessage, result.assistantMessage])
      setSuggestions(result.suggestedPrompts.length ? result.suggestedPrompts : starterPrompts)
      setThreads((current) => [result.thread, ...current.filter((thread) => thread.id !== result.thread.id)])
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id))
      setDraft(text)
      setError(errorMessage(caught))
    } finally {
      setSending(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void send()
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return <>
    <button ref={launcherRef} className="assistant-launcher" onClick={openAssistant} aria-label="Abrir assistente de casamento" title="Assistente de casamento">
      <MessageCircle size={23} /><Sparkles className="assistant-launcher-sparkle" size={13} />
    </button>

    {open && <div className="assistant-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section ref={dialogRef} className="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-title">
        <header className="assistant-header">
          <button onClick={() => setHistoryOpen((current) => !current)} aria-label="Ver conversas"><History size={19} /></button>
          <span className="assistant-mark"><Sparkles size={18} /></span>
          <div><strong id="assistant-title">Especialista Serenata</strong><small>Organização do casamento</small></div>
          {threadId && <button onClick={archiveCurrentThread} aria-label="Arquivar conversa" title="Arquivar conversa"><Archive size={18} /></button>}
          <button onClick={close} aria-label="Fechar assistente"><X size={21} /></button>
        </header>

        <aside className={`assistant-history ${historyOpen ? 'assistant-history--open' : ''}`} aria-label="Suas conversas">
          <div><button onClick={() => setHistoryOpen(false)} aria-label="Voltar ao chat"><ChevronLeft size={18} /></button><strong>Suas conversas</strong></div>
          <button className="assistant-new-thread" onClick={startNewThread}><Plus size={16} />Nova conversa</button>
          {loadingThreads ? <span className="assistant-history-state"><LoaderCircle className="assistant-spin" size={17} />Carregando...</span> : <div className="assistant-thread-list">
            {threads.filter((thread) => thread.status !== 'archived').map((thread) => <button className={thread.id === threadId ? 'active' : ''} onClick={() => void openThread(thread)} key={thread.id}><strong>{thread.title}</strong><span>{thread.lastMessagePreview}</span></button>)}
            {!threads.some((thread) => thread.status !== 'archived') && <span className="assistant-history-state">Nenhuma conversa anterior.</span>}
          </div>}
        </aside>

        <div className="assistant-messages" aria-live="polite" aria-busy={sending || loadingThread}>
          {loadingThread ? <div className="assistant-loading"><LoaderCircle className="assistant-spin" size={22} />Abrindo conversa...</div> : messages.length === 0 ? <AssistantWelcome onPrompt={(prompt) => void send(prompt)} /> : messages.map((message) => <Message key={message.id} message={message} threadId={threadId} />)}
          {sending && <div className="assistant-typing"><span /><span /><span /><small>Consultando o planejamento...</small></div>}
          <div ref={messageEndRef} />
        </div>

        {error && <div className="assistant-error" role="alert"><AlertTriangle size={15} /><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar aviso"><X size={14} /></button></div>}

        {messages.length > 0 && !sending && <div className="assistant-suggestions">{suggestions.slice(0, 3).map((prompt) => <button key={prompt} onClick={() => void send(prompt)}>{prompt}</button>)}</div>}

        <form className="assistant-composer" onSubmit={submit}>
          <textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={composerKeyDown} maxLength={4000} rows={1} placeholder="Pergunte sobre seu casamento..." aria-label="Mensagem para o assistente" disabled={sending} />
          <button type="submit" disabled={sending || !draft.trim()} aria-label="Enviar mensagem">{sending ? <LoaderCircle className="assistant-spin" size={18} /> : <Send size={18} />}</button>
          <small>A IA pode cometer erros. Revise informações importantes.</small>
        </form>
      </section>
    </div>}
  </>
}

function AssistantWelcome({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  return <div className="assistant-welcome">
    <span><Sparkles size={25} /></span>
    <p>Especialista do casamento</p>
    <h2>Como posso ajudar hoje?</h2>
    <p>Posso analisar convidados, tarefas, agenda e presentes, além de preparar próximos passos para você revisar.</p>
    <div>{starterPrompts.map((prompt) => <button onClick={() => onPrompt(prompt)} key={prompt}>{prompt}</button>)}</div>
  </div>
}

function Message({ message, threadId }: { message: AssistantMessage; threadId?: string }) {
  return <article className={`assistant-message assistant-message--${message.role} ${message.status === 'failed' ? 'assistant-message--failed' : ''}`}>
    {message.role === 'assistant' && <span className="assistant-message-avatar"><Sparkles size={14} /></span>}
    <div className="assistant-message-content"><p>{message.text}</p>
      {message.blocks.map((block, index) => block.type === 'insight'
        ? <Insight block={block} key={`${message.id}-insight-${index}`} />
        : threadId ? <TaskProposal block={block} threadId={threadId} key={block.proposalId} /> : null)}
      {message.role === 'assistant' && message.sources.length > 0 && <small className="assistant-source">Dados consultados no Serenata</small>}
    </div>
  </article>
}

function Insight({ block }: { block: Extract<AssistantBlock, { type: 'insight' }> }) {
  return <section className={`assistant-insight assistant-insight--${block.severity}`}>
    <strong>{block.title}</strong><p>{block.body}</p>
    {block.evidence.length > 0 && <ul>{block.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
  </section>
}

function TaskProposal({ block, threadId }: { block: Extract<AssistantBlock, { type: 'task_proposal' }>; threadId: string }) {
  const [tasks, setTasks] = useState(() => block.tasks.map((task) => ({ ...task, selected: !task.duplicateCandidateTaskId })))
  const [confirming, setConfirming] = useState(false)
  const [created, setCreated] = useState<string[]>([])
  const [error, setError] = useState('')
  const idempotencyKey = useRef(newIdempotencyKey())

  function updateTask(index: number, changes: Partial<ProposedTask>) {
    setTasks((current) => current.map((task, taskIndex) => taskIndex === index ? { ...task, ...changes } : task))
  }

  async function confirm() {
    setConfirming(true)
    setError('')
    try {
      const result = await confirmTaskProposal({
        threadId, proposalId: block.proposalId, idempotencyKey: idempotencyKey.current,
        tasks: tasks.map((task) => ({ ...task, selected: Boolean(task.selected) })),
      })
      setCreated(result.createdTaskIds)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setConfirming(false)
    }
  }

  if (created.length) return <section className="assistant-proposal assistant-proposal--done"><Check size={20} /><div><strong>{created.length} {created.length === 1 ? 'tarefa criada' : 'tarefas criadas'}</strong><p>Elas já estão disponíveis no quadro de tarefas.</p><a href="/tarefas">Abrir tarefas</a></div></section>

  return <section className="assistant-proposal">
    <header><ListTodo size={18} /><div><strong>Tarefas sugeridas</strong><small>Revise antes de criar</small></div></header>
    <div className="assistant-proposal-list">{tasks.map((task, index) => <div className={task.duplicateCandidateTaskId ? 'duplicate' : ''} key={task.clientId}>
      <label className="assistant-task-select"><input type="checkbox" checked={Boolean(task.selected)} onChange={(event) => updateTask(index, { selected: event.target.checked })} /><span /></label>
      <div><input value={task.title} onChange={(event) => updateTask(index, { title: event.target.value })} aria-label={`Título da tarefa ${index + 1}`} maxLength={120} />
        <textarea value={task.description} onChange={(event) => updateTask(index, { description: event.target.value })} aria-label={`Descrição da tarefa ${index + 1}`} rows={2} maxLength={1500} />
        <div><select value={task.priority} onChange={(event) => updateTask(index, { priority: event.target.value as ProposedTask['priority'] })} aria-label={`Prioridade da tarefa ${index + 1}`}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select><input type="date" value={task.dueDate} onChange={(event) => updateTask(index, { dueDate: event.target.value })} aria-label={`Prazo da tarefa ${index + 1}`} /></div>
        {task.duplicateCandidateTaskId && <small><AlertTriangle size={12} />Pode ser parecida com uma tarefa existente.</small>}
      </div>
    </div>)}</div>
    {error && <p className="assistant-proposal-error">{error}</p>}
    <button className="assistant-confirm-tasks" onClick={() => void confirm()} disabled={confirming || !tasks.some((task) => task.selected)}>{confirming ? <LoaderCircle className="assistant-spin" size={16} /> : <Check size={16} />}Criar tarefas selecionadas</button>
  </section>
}
