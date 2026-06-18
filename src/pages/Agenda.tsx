import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc, writeBatch, type Timestamp } from 'firebase/firestore'
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, ListTodo, MapPin, Plus, Trash2, X } from 'lucide-react'
import { db } from '../lib/firestore'

type AgendaEvent = {
  id: string
  title: string
  description: string
  date: string
  startTime: string
  endTime: string
  location: string
  category: string
  createdAt: Timestamp | null
}

type TaskItem = {
  id: string
  title: string
  description: string
  dueDate: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
}

type EventForm = Omit<AgendaEvent, 'id' | 'createdAt'>
type CalendarItem = { id: string; title: string; date: string; source: 'event' | 'task'; time: string; status?: TaskItem['status']; event?: AgendaEvent; task?: TaskItem }

const emptyForm: EventForm = { title: '', description: '', date: '', startTime: '', endTime: '', location: '', category: 'compromisso' }
const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const categories = [{ value: 'compromisso', label: 'Compromisso' }, { value: 'fornecedor', label: 'Fornecedor' }, { value: 'pagamento', label: 'Pagamento' }, { value: 'pessoal', label: 'Pessoal' }, { value: 'outros', label: 'Outros' }]

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`)
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(parseDate(value))
}

export function Agenda() {
  const [events, setEvents] = useState<AgendaEvent[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [loaded, setLoaded] = useState({ events: false, tasks: false })
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EventForm>(emptyForm)
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!db) return
    const unsubscribeEvents = onSnapshot(collection(db, 'agendaEvents'), (snapshot) => {
      setEvents(snapshot.docs.map((eventDocument) => {
        const data = eventDocument.data()
        return { id: eventDocument.id, title: String(data.title ?? 'Evento sem título'), description: String(data.description ?? ''), date: String(data.date ?? ''), startTime: String(data.startTime ?? ''), endTime: String(data.endTime ?? ''), location: String(data.location ?? ''), category: String(data.category ?? 'outros'), createdAt: data.createdAt ?? null }
      }).filter((event) => event.date))
      setLoaded((current) => ({ ...current, events: true }))
    }, (caught) => { console.error('Erro ao carregar agenda:', caught); setError('Não foi possível carregar os compromissos.'); setLoaded((current) => ({ ...current, events: true })) })

    const unsubscribeTasks = onSnapshot(collection(db, 'tasks'), (snapshot) => {
      setTasks(snapshot.docs.map((taskDocument) => {
        const data = taskDocument.data()
        return { id: taskDocument.id, title: String(data.title ?? 'Tarefa sem título'), description: String(data.description ?? ''), dueDate: String(data.dueDate ?? ''), status: ['todo', 'in_progress', 'done'].includes(data.status) ? data.status : 'todo', priority: ['low', 'medium', 'high'].includes(data.priority) ? data.priority : 'medium' }
      }).filter((task) => task.dueDate))
      setLoaded((current) => ({ ...current, tasks: true }))
    }, (caught) => { console.error('Erro ao carregar tarefas na agenda:', caught); setError('Não foi possível carregar as tarefas.'); setLoaded((current) => ({ ...current, tasks: true })) })

    return () => { unsubscribeEvents(); unsubscribeTasks() }
  }, [])

  const items = useMemo<CalendarItem[]>(() => [
    ...events.map((event) => ({ id: `event-${event.id}`, title: event.title, date: event.date, source: 'event' as const, time: event.startTime, event })),
    ...tasks.map((task) => ({ id: `task-${task.id}`, title: task.title, date: task.dueDate, source: 'task' as const, time: '', status: task.status, task })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)), [events, tasks])

  const calendarDays = useMemo(() => {
    const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date })
  }, [currentMonth])

  const upcoming = useMemo(() => {
    const today = dateKey(new Date())
    return items.filter((item) => item.date >= today && item.status !== 'done').slice(0, 6)
  }, [items])

  function openNewEvent(date = dateKey(new Date())) {
    setEditingId(null)
    setSelectedTask(null)
    setForm({ ...emptyForm, date })
    setFormError('')
    setFormOpen(true)
  }

  function openCalendarItem(item: CalendarItem) {
    setFormError('')
    if (item.source === 'task' && item.task) {
      setSelectedTask(item.task)
      setEditingId(null)
      setFormOpen(true)
      return
    }
    if (item.event) {
      setSelectedTask(null)
      setEditingId(item.event.id)
      setForm({ title: item.event.title, description: item.event.description, date: item.event.date, startTime: item.event.startTime, endTime: item.event.endTime, location: item.event.location, category: item.event.category })
      setFormOpen(true)
    }
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!db) return
    setSaving(true)
    setFormError('')
    const payload = { ...form, title: form.title.trim(), description: form.description.trim(), location: form.location.trim(), updatedAt: serverTimestamp() }
    try {
      if (editingId) await updateDoc(doc(db, 'agendaEvents', editingId), payload)
      else await addDoc(collection(db, 'agendaEvents'), { ...payload, createdAt: serverTimestamp() })
      setFormOpen(false)
    } catch (caught) {
      console.error('Erro ao salvar compromisso:', caught)
      setFormError('Não foi possível salvar o compromisso.')
    } finally { setSaving(false) }
  }

  async function removeEvent() {
    if (!db || !editingId || !window.confirm('Excluir este compromisso da agenda?')) return
    try { await deleteDoc(doc(db, 'agendaEvents', editingId)); setFormOpen(false) }
    catch (caught) { console.error('Erro ao excluir compromisso:', caught); setFormError('Não foi possível excluir o compromisso.') }
  }

  async function convertToTask() {
    if (!db || !editingId) return
    setSaving(true)
    setFormError('')
    try {
      const taskReference = doc(collection(db, 'tasks'))
      const batch = writeBatch(db)
      batch.set(taskReference, { title: form.title.trim(), description: form.description.trim(), dueDate: form.date, status: 'todo', priority: 'medium', order: tasks.filter((task) => task.status === 'todo').length, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      batch.delete(doc(db, 'agendaEvents', editingId))
      await batch.commit()
      setFormOpen(false)
    } catch (caught) { console.error('Erro ao converter compromisso:', caught); setFormError('Não foi possível transformar este compromisso em tarefa.') }
    finally { setSaving(false) }
  }

  async function toggleTaskDone() {
    if (!db || !selectedTask) return
    setSaving(true)
    try {
      const nextStatus = selectedTask.status === 'done' ? 'todo' : 'done'
      await updateDoc(doc(db, 'tasks', selectedTask.id), { status: nextStatus, updatedAt: serverTimestamp() })
      setSelectedTask({ ...selectedTask, status: nextStatus })
    } catch (caught) { console.error('Erro ao atualizar tarefa:', caught); setFormError('Não foi possível atualizar a tarefa.') }
    finally { setSaving(false) }
  }

  function changeMonth(offset: number) {
    setCurrentMonth((month) => new Date(month.getFullYear(), month.getMonth() + offset, 1))
  }

  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(currentMonth)
  const loading = !loaded.events || !loaded.tasks

  return <main className="dashboard-content agenda-page">
    <div className="dashboard-title agenda-title"><div><p className="eyebrow">Planejamento no tempo</p><h1>Agenda</h1><p className="page-description">Compromissos avulsos e prazos das tarefas em um só lugar.</p></div><button className="compact-primary" onClick={() => openNewEvent()}><Plus size={17} />Novo compromisso</button></div>
    {error && <div className="task-error"><X size={15} />{error}<button onClick={() => setError('')}><X size={14} /></button></div>}

    <section className="agenda-layout">
      <article className="calendar-card">
        <header className="calendar-toolbar"><div><button onClick={() => changeMonth(-1)} aria-label="Mês anterior"><ArrowLeft size={17} /></button><button onClick={() => changeMonth(1)} aria-label="Próximo mês"><ArrowRight size={17} /></button><button className="today-button" onClick={() => setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hoje</button></div><h2>{monthLabel}</h2><div className="calendar-legend"><span><i className="event-dot" />Avulso</span><span><i className="task-dot" />Tarefa</span></div></header>
        {loading ? <div className="list-state"><span className="spinner spinner--wine" />Carregando agenda...</div> : <div className="calendar-scroll"><div className="calendar-grid">
          {weekDays.map((day) => <div className="weekday" key={day}>{day}</div>)}
          {calendarDays.map((date) => {
            const key = dateKey(date)
            const dayItems = items.filter((item) => item.date === key)
            const outside = date.getMonth() !== currentMonth.getMonth()
            const today = key === dateKey(new Date())
            return <div className={`calendar-day ${outside ? 'outside' : ''} ${today ? 'today' : ''}`} key={key} onDoubleClick={() => openNewEvent(key)}><button className="day-number" onClick={() => openNewEvent(key)} aria-label={`Adicionar compromisso em ${key}`}>{date.getDate()}</button><div className="day-items">{dayItems.slice(0, 3).map((item) => <button className={`calendar-item calendar-item--${item.source} ${item.status === 'done' ? 'completed' : ''}`} key={item.id} onClick={() => openCalendarItem(item)} title={item.title}>{item.time && <span>{item.time}</span>}{item.title}</button>)}{dayItems.length > 3 && <span className="more-items">+{dayItems.length - 3} itens</span>}</div></div>
          })}
        </div></div>}
      </article>

      <aside className="upcoming-card"><div className="upcoming-header"><p className="eyebrow">Próximos</p><h2>Compromissos</h2><span>{upcoming.length}</span></div>{upcoming.length === 0 ? <div className="agenda-empty"><CalendarDays size={23} /><strong>Nada agendado</strong><p>Seus próximos compromissos aparecerão aqui.</p></div> : <div className="upcoming-list">{upcoming.map((item) => <button key={item.id} onClick={() => openCalendarItem(item)}><span className="upcoming-date"><strong>{parseDate(item.date).getDate()}</strong><small>{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(parseDate(item.date))}</small></span><span className="upcoming-info"><i className={item.source === 'task' ? 'task-dot' : 'event-dot'} /> <strong>{item.title}</strong><small>{item.source === 'task' ? 'Tarefa' : item.time || 'Dia inteiro'}</small></span><ArrowRight size={14} /></button>)}</div>}<button className="upcoming-add" onClick={() => openNewEvent()}><Plus size={14} />Adicionar compromisso</button></aside>
    </section>

    {formOpen && <div className="gift-form-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false) }}><section className="gift-form-panel agenda-form-panel" role="dialog" aria-modal="true" aria-labelledby="agenda-form-title">
      <div className="gift-form-header"><div><p className="eyebrow">Agenda</p><h2 id="agenda-form-title">{selectedTask ? 'Detalhes da tarefa' : editingId ? 'Editar compromisso' : 'Novo compromisso'}</h2></div><button onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={21} /></button></div>
      {selectedTask ? <div className="task-agenda-detail"><span className={`status-pill ${selectedTask.status === 'done' ? 'status-pill--confirmed' : 'status-pill--declined'}`}>{selectedTask.status === 'done' ? <Check size={12} /> : <Clock3 size={12} />}{selectedTask.status === 'done' ? 'Concluída' : selectedTask.status === 'in_progress' ? 'Em andamento' : 'A fazer'}</span><h3>{selectedTask.title}</h3>{selectedTask.description && <p>{selectedTask.description}</p>}<dl><div><dt><CalendarDays size={15} />Prazo</dt><dd>{formatLongDate(selectedTask.dueDate)}</dd></div><div><dt><ListTodo size={15} />Origem</dt><dd>Quadro de tarefas</dd></div></dl>{formError && <p className="form-message form-message--error">{formError}</p>}<button className="compact-primary task-done-button" onClick={toggleTaskDone} disabled={saving}><CheckCircle2 size={16} />{selectedTask.status === 'done' ? 'Reabrir tarefa' : 'Marcar como concluída'}</button></div> : <form className="gift-form agenda-form" onSubmit={saveEvent}>
        <label htmlFor="event-title">Título *</label><input id="event-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Reunião com o fotógrafo" required />
        <label htmlFor="event-description">Descrição <span>opcional</span></label><textarea id="event-description" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Informações importantes" />
        <div className="agenda-form-grid"><div><label htmlFor="event-date">Data *</label><input id="event-date" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></div><div><label htmlFor="event-category">Categoria</label><select id="event-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}</select></div></div>
        <div className="agenda-form-grid"><div><label htmlFor="event-start">Início</label><input id="event-start" type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /></div><div><label htmlFor="event-end">Fim</label><input id="event-end" type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></div></div>
        <label htmlFor="event-location">Local <span>opcional</span></label><div className="agenda-location"><MapPin size={16} /><input id="event-location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Nome ou endereço do local" /></div>
        {editingId && <div className="convert-task-box"><ListTodo size={18} /><div><strong>Transformar em tarefa</strong><p>O compromisso sairá dos avulsos e passará a fazer parte do Kanban.</p></div><button type="button" onClick={convertToTask} disabled={saving}>Converter</button></div>}
        {formError && <p className="form-message form-message--error">{formError}</p>}
        <div className="gift-form-footer agenda-form-footer">{editingId && <button className="delete-event" type="button" onClick={removeEvent}><Trash2 size={14} />Excluir</button>}<button type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="compact-primary" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : <><Check size={16} />Salvar</>}</button></div>
      </form>}
    </section></div>}
  </main>
}
