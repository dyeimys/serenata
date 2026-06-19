import { type DragEvent, type FormEvent, useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, type Timestamp } from 'firebase/firestore'
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Circle, Clock3, GripVertical, ListTodo, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { createDocumentWithAudit, deleteDocumentWithAudit, updateDocumentWithAudit } from '../lib/audit'
import { db } from '../lib/firestore'

type TaskStatus = 'todo' | 'in_progress' | 'done'
type TaskPriority = 'low' | 'medium' | 'high'

type Task = {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string
  order: number
  createdAt: Timestamp | null
}

type TaskForm = Omit<Task, 'id' | 'order' | 'createdAt'>

const columns: Array<{ status: TaskStatus; title: string; description: string; icon: typeof Circle }> = [
  { status: 'todo', title: 'A fazer', description: 'Tarefas que ainda não começaram', icon: Circle },
  { status: 'in_progress', title: 'Em andamento', description: 'O que está sendo preparado', icon: Clock3 },
  { status: 'done', title: 'Concluídas', description: 'Tudo que já foi resolvido', icon: CheckCircle2 },
]

const emptyForm: TaskForm = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'medium',
  dueDate: '',
}

const priorityLabels: Record<TaskPriority, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' }

function formatDueDate(value: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`))
}

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TaskForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!db) return
    return onSnapshot(
      collection(db, 'tasks'),
      (snapshot) => {
        const nextTasks = snapshot.docs.map((taskDocument) => {
          const data = taskDocument.data()
          const status: TaskStatus = ['todo', 'in_progress', 'done'].includes(data.status) ? data.status : 'todo'
          const priority: TaskPriority = ['low', 'medium', 'high'].includes(data.priority) ? data.priority : 'medium'
          return {
            id: taskDocument.id,
            title: String(data.title ?? 'Tarefa sem título'),
            description: String(data.description ?? ''),
            status,
            priority,
            dueDate: String(data.dueDate ?? ''),
            order: Number(data.order) || 0,
            createdAt: data.createdAt ?? null,
          }
        })
        nextTasks.sort((a, b) => a.order - b.order || (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
        setTasks(nextTasks)
        setLoading(false)
        setError('')
      },
      (caught) => {
        console.error('Erro ao carregar tarefas:', caught)
        setError(caught.code === 'permission-denied' ? 'Sua conta não tem permissão para acessar as tarefas.' : 'Não foi possível carregar o quadro agora.')
        setLoading(false)
      },
    )
  }, [])

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return tasks.filter((task) => !term || `${task.title} ${task.description}`.toLocaleLowerCase('pt-BR').includes(term))
  }, [search, tasks])

  const progress = tasks.length ? Math.round((tasks.filter((task) => task.status === 'done').length / tasks.length) * 100) : 0

  function openNewTask(status: TaskStatus = 'todo') {
    setEditingId(null)
    setForm({ ...emptyForm, status })
    setFormError('')
    setFormOpen(true)
  }

  function openEditTask(task: Task) {
    setEditingId(task.id)
    setForm({ title: task.title, description: task.description, status: task.status, priority: task.priority, dueDate: task.dueDate })
    setFormError('')
    setFormOpen(true)
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!db) return
    setSaving(true)
    setFormError('')
    try {
      const payload = { ...form, title: form.title.trim(), description: form.description.trim() }
      if (editingId) {
        await updateDocumentWithAudit(db, 'tasks', editingId, payload)
      } else {
        const columnTasks = tasks.filter((task) => task.status === form.status)
        await createDocumentWithAudit(db, 'tasks', { ...payload, order: columnTasks.length })
      }
      setFormOpen(false)
    } catch (caught) {
      console.error('Erro ao salvar tarefa:', caught)
      setFormError('Não foi possível salvar a tarefa. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  async function moveTask(task: Task, status: TaskStatus) {
    if (!db || task.status === status) return
    const targetTasks = tasks.filter((item) => item.status === status)
    try {
      await updateDocumentWithAudit(db, 'tasks', task.id, { status, order: targetTasks.length })
    } catch (caught) {
      console.error('Erro ao mover tarefa:', caught)
      setError('Não foi possível mover a tarefa. Tente novamente.')
    }
  }

  async function removeTask(task: Task) {
    if (!db || !window.confirm(`Excluir a tarefa “${task.title}”?`)) return
    try {
      await deleteDocumentWithAudit(db, 'tasks', task.id)
    } catch (caught) {
      console.error('Erro ao excluir tarefa:', caught)
      setError('Não foi possível excluir a tarefa.')
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>, taskId: string) {
    setDraggedId(taskId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
  }

  function handleDrop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/plain') || draggedId
    const task = tasks.find((item) => item.id === taskId)
    if (task) void moveTask(task, status)
    setDraggedId(null)
    setDragOverStatus(null)
  }

  return (
    <main className="dashboard-content tasks-page">
      <div className="dashboard-title tasks-title">
        <div><p className="eyebrow">Planejamento</p><h1>Quadro de tarefas</h1><p className="page-description">Organize cada etapa e acompanhe o que já foi concluído.</p></div>
        <button className="compact-primary" onClick={() => openNewTask()}><Plus size={17} />Nova tarefa</button>
      </div>

      <section className="task-overview">
        <div><ListTodo size={18} /><span><strong>{tasks.length}</strong> tarefas no quadro</span></div>
        <div className="task-progress"><span>Progresso geral</span><div><i style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong></div>
        <div className="search-field task-search"><Search size={17} /><input aria-label="Buscar tarefas" placeholder="Buscar tarefa" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      </section>

      {loading && <div className="list-state"><span className="spinner spinner--wine" />Carregando quadro...</div>}
      {error && <div className="task-error"><X size={15} />{error}<button onClick={() => setError('')} aria-label="Fechar aviso"><X size={14} /></button></div>}

      {!loading && <section className="kanban-board" aria-label="Quadro Kanban">
        {columns.map(({ status, title, description, icon: Icon }, columnIndex) => {
          const columnTasks = filteredTasks.filter((task) => task.status === status)
          return <section className={`kanban-column kanban-column--${status} ${dragOverStatus === status ? 'drag-over' : ''}`} key={status} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverStatus(status) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverStatus(null) }} onDrop={(event) => handleDrop(event, status)}>
            <header><div><span><Icon size={16} /></span><div><h2>{title}</h2><p>{description}</p></div></div><strong>{columnTasks.length}</strong></header>
            <div className="kanban-list">
              {columnTasks.map((task) => <article className={`task-card ${draggedId === task.id ? 'dragging' : ''}`} key={task.id} draggable onDragStart={(event) => handleDragStart(event, task.id)} onDragEnd={() => { setDraggedId(null); setDragOverStatus(null) }}>
                <div className="task-card-top"><span className={`priority priority--${task.priority}`}>{priorityLabels[task.priority]}</span><div><button onClick={() => openEditTask(task)} aria-label={`Editar ${task.title}`}><Pencil size={14} /></button><button onClick={() => removeTask(task)} aria-label={`Excluir ${task.title}`}><Trash2 size={14} /></button><GripVertical className="drag-handle" size={16} /></div></div>
                <h3>{task.title}</h3>
                {task.description && <p>{task.description}</p>}
                <footer>
                  <span className={task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && status !== 'done' ? 'overdue' : ''}>{task.dueDate && <><CalendarDays size={13} />{formatDueDate(task.dueDate)}</>}</span>
                  <div className="task-move-actions">
                    {columnIndex > 0 && <button onClick={() => moveTask(task, columns[columnIndex - 1].status)} aria-label="Mover para a coluna anterior"><ArrowLeft size={14} /></button>}
                    {columnIndex < columns.length - 1 && <button onClick={() => moveTask(task, columns[columnIndex + 1].status)} aria-label="Mover para a próxima coluna"><ArrowRight size={14} /></button>}
                  </div>
                </footer>
              </article>)}
              {columnTasks.length === 0 && <div className="kanban-empty"><span>{dragOverStatus === status ? 'Solte a tarefa aqui' : 'Nenhuma tarefa nesta etapa'}</span></div>}
            </div>
            <button className="add-column-task" onClick={() => openNewTask(status)}><Plus size={15} />Adicionar tarefa</button>
          </section>
        })}
      </section>}

      {formOpen && <div className="gift-form-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false) }}>
        <section className="gift-form-panel task-form-panel" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
          <div className="gift-form-header"><div><p className="eyebrow">Planejamento</p><h2 id="task-form-title">{editingId ? 'Editar tarefa' : 'Nova tarefa'}</h2></div><button onClick={() => setFormOpen(false)} aria-label="Fechar formulário"><X size={21} /></button></div>
          <form className="gift-form task-form" onSubmit={saveTask}>
            <label htmlFor="task-title">Título *</label><input id="task-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Confirmar decoração da cerimônia" required />
            <label htmlFor="task-description">Descrição <span>opcional</span></label><textarea id="task-description" rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Adicione os detalhes importantes desta tarefa" />
            <div className="task-form-grid"><div><label htmlFor="task-status">Etapa</label><select id="task-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}>{columns.map((column) => <option value={column.status} key={column.status}>{column.title}</option>)}</select></div><div><label htmlFor="task-priority">Prioridade</label><select id="task-priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriority })}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select></div></div>
            <label htmlFor="task-date">Prazo <span>opcional</span></label><input id="task-date" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
            {formError && <p className="form-message form-message--error" role="alert">{formError}</p>}
            <div className="gift-form-footer"><button type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="compact-primary" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : <><Check size={16} />{editingId ? 'Salvar alterações' : 'Criar tarefa'}</>}</button></div>
          </form>
        </section>
      </div>}
    </main>
  )
}
