import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, type Timestamp } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, Gift, Heart, ListTodo, PackageCheck, Users, X } from 'lucide-react'
import { db } from '../lib/firestore'
import { isRsvpConfirmed } from '../lib/rsvp'

type Rsvp = { attending?: boolean; totalGuests: number; adults: number; children: number; createdAt: Timestamp | null }
type GiftItem = { received: boolean; disabled: boolean }
type Task = { status: 'todo' | 'in_progress' | 'done'; dueDate: string }
type Period = 7 | 30

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function Overview() {
  const [rsvps, setRsvps] = useState<Rsvp[]>([])
  const [gifts, setGifts] = useState<GiftItem[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loaded, setLoaded] = useState({ rsvps: false, gifts: false, tasks: false })
  const [errors, setErrors] = useState<string[]>([])
  const [period, setPeriod] = useState<Period>(7)

  useEffect(() => {
    if (!db) return
    const reportError = (module: string, caught: unknown) => {
      console.error(`Erro ao carregar ${module}:`, caught)
      setErrors((current) => current.includes(module) ? current : [...current, module])
      setLoaded((current) => ({ ...current, [module]: true }))
    }

    const unsubscribeRsvps = onSnapshot(collection(db, 'rsvpSubmissions'), (snapshot) => {
      setRsvps(snapshot.docs.map((document) => {
        const data = document.data()
        return { attending: typeof data.attending === 'boolean' ? data.attending : undefined, totalGuests: Number(data.totalGuests) || 0, adults: Number(data.adults) || 0, children: Number(data.children) || 0, createdAt: data.createdAt ?? null }
      }))
      setLoaded((current) => ({ ...current, rsvps: true }))
    }, (caught) => reportError('rsvps', caught))

    const unsubscribeGifts = onSnapshot(collection(db, 'giftRegistryItems'), (snapshot) => {
      setGifts(snapshot.docs.map((document) => ({ received: Boolean(document.data().received), disabled: Boolean(document.data().disabled) })))
      setLoaded((current) => ({ ...current, gifts: true }))
    }, (caught) => reportError('gifts', caught))

    const unsubscribeTasks = onSnapshot(collection(db, 'tasks'), (snapshot) => {
      setTasks(snapshot.docs.map((document) => {
        const data = document.data()
        return { status: ['todo', 'in_progress', 'done'].includes(data.status) ? data.status : 'todo', dueDate: String(data.dueDate ?? '') }
      }))
      setLoaded((current) => ({ ...current, tasks: true }))
    }, (caught) => reportError('tasks', caught))

    return () => { unsubscribeRsvps(); unsubscribeGifts(); unsubscribeTasks() }
  }, [])

  const metrics = useMemo(() => {
    const confirmed = rsvps.filter(isRsvpConfirmed)
    const confirmedGuests = confirmed.reduce((total, item) => total + item.totalGuests, 0)
    const adults = confirmed.reduce((total, item) => total + item.adults, 0)
    const children = confirmed.reduce((total, item) => total + item.children, 0)
    const activeGifts = gifts.filter((item) => !item.disabled)
    const receivedGifts = activeGifts.filter((item) => item.received).length
    const availableGifts = activeGifts.filter((item) => !item.received).length
    const completedTasks = tasks.filter((item) => item.status === 'done').length
    const inProgressTasks = tasks.filter((item) => item.status === 'in_progress').length
    const today = dateKey(new Date())
    const overdueTasks = tasks.filter((item) => item.status !== 'done' && item.dueDate && item.dueDate < today).length
    return {
      confirmedGuests, adults, children,
      receivedGifts, availableGifts,
      completedTasks, inProgressTasks, overdueTasks,
      taskProgress: tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0,
      declined: rsvps.filter((item) => !isRsvpConfirmed(item)).length,
    }
  }, [gifts, rsvps, tasks])

  const timeline = useMemo(() => {
    const values = new Map<string, number>()
    rsvps.filter(isRsvpConfirmed).forEach((item) => {
      if (!item.createdAt) return
      const key = dateKey(item.createdAt.toDate())
      values.set(key, (values.get(key) ?? 0) + item.totalGuests)
    })
    return Array.from({ length: period }, (_, index) => {
      const date = new Date()
      date.setHours(12, 0, 0, 0)
      date.setDate(date.getDate() - (period - index - 1))
      return { key: dateKey(date), label: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date), value: values.get(dateKey(date)) ?? 0 }
    })
  }, [period, rsvps])

  const maxTimelineValue = Math.max(...timeline.map((item) => item.value), 1)
  const loading = !loaded.rsvps || !loaded.gifts || !loaded.tasks
  const hasRsvps = rsvps.length > 0
  const hasGifts = gifts.length > 0
  const hasTasks = tasks.length > 0

  return <main className="dashboard-content overview-page">
    <div className="dashboard-title"><div><p className="eyebrow">Visão geral</p><h1>Seu casamento, em harmonia.</h1><p className="page-description">Dados atualizados em tempo real para apoiar suas decisões.</p></div><span className="today"><Heart size={17} /> Planejamento em andamento</span></div>

    {errors.length > 0 && <div className="overview-alert"><X size={15} />Alguns indicadores não puderam ser carregados. Verifique as permissões de: {errors.join(', ')}.</div>}

    <section className="overview-kpis" aria-label="Indicadores principais">
      <article><span className="kpi-icon"><Users size={20} /></span><div><p>Presenças confirmadas</p><strong>{loading || !hasRsvps ? '—' : metrics.confirmedGuests}</strong><small>{!loading && !hasRsvps ? 'Nenhuma resposta recebida' : `${metrics.adults} adultos e ${metrics.children} crianças`}</small></div></article>
      <article><span className="kpi-icon"><Gift size={20} /></span><div><p>Presentes disponíveis</p><strong>{loading || !hasGifts ? '—' : metrics.availableGifts}</strong><small>{!loading && !hasGifts ? 'Nenhum presente cadastrado' : `${metrics.receivedGifts} já recebidos`}</small></div></article>
      <article><span className="kpi-icon"><ListTodo size={20} /></span><div><p>Progresso das tarefas</p><strong>{loading || !hasTasks ? '—' : `${metrics.taskProgress}%`}</strong><small>{!loading && !hasTasks ? 'Nenhuma tarefa cadastrada' : `${metrics.completedTasks} de ${tasks.length} concluídas`}</small></div></article>
      <article className={metrics.overdueTasks ? 'kpi-warning' : ''}><span className="kpi-icon"><AlertTriangle size={20} /></span><div><p>Tarefas vencidas</p><strong>{loading || !hasTasks ? '—' : metrics.overdueTasks}</strong><small>{!loading && !hasTasks ? 'Sem dados de tarefas' : `${metrics.inProgressTasks} em andamento`}</small></div></article>
    </section>

    <section className="overview-grid">
      <article className="overview-panel timeline-panel">
        <header><div><p className="eyebrow">Evolução</p><h2>Confirmações ao longo do tempo</h2><small>Pessoas confirmadas por dia</small></div><div className="period-control"><button className={period === 7 ? 'active' : ''} onClick={() => setPeriod(7)}>7 dias</button><button className={period === 30 ? 'active' : ''} onClick={() => setPeriod(30)}>30 dias</button></div></header>
        {!loading && !hasRsvps ? <EmptyModule icon={<Users size={24} />} title="Ainda não há confirmações" description="O gráfico aparecerá quando as primeiras respostas forem recebidas." /> : <div className={`timeline-chart timeline-chart--${period}`}>
          {timeline.map((item, index) => <div className="timeline-item" key={item.key} title={`${item.label}: ${item.value} pessoas`}><span>{item.value || ''}</span><div className="timeline-track"><i style={{ height: `${item.value ? Math.max((item.value / maxTimelineValue) * 100, 8) : 2}%` }} /></div><small>{period === 7 || index % 5 === 0 || index === timeline.length - 1 ? item.label : ''}</small></div>)}
        </div>}
      </article>

      <article className="overview-panel status-panel">
        <header><div><p className="eyebrow">Resumo</p><h2>Lista de presença</h2></div><Users size={19} /></header>
        {!loading && !hasRsvps ? <EmptyModule icon={<Users size={22} />} title="Sem dados de convidados" description="Nenhuma resposta foi registrada até agora." /> : <><div className="status-total"><strong>{metrics.confirmedGuests}</strong><span>pessoas confirmadas</span></div>
        <div className="status-row"><span>Adultos</span><strong>{metrics.adults}</strong></div><div className="status-bar"><i style={{ width: `${metrics.confirmedGuests ? (metrics.adults / metrics.confirmedGuests) * 100 : 0}%` }} /></div>
        <div className="status-row"><span>Crianças</span><strong>{metrics.children}</strong></div><div className="status-bar status-bar--light"><i style={{ width: `${metrics.confirmedGuests ? (metrics.children / metrics.confirmedGuests) * 100 : 0}%` }} /></div>
        <div className="status-foot"><X size={13} />{metrics.declined} respostas de não comparecimento</div></>}
      </article>

      <article className="overview-panel compact-status-panel">
        <header><div><p className="eyebrow">Presentes</p><h2>Situação do catálogo</h2></div><PackageCheck size={19} /></header>
        {!loading && !hasGifts ? <EmptyModule icon={<Gift size={22} />} title="Sem presentes cadastrados" description="Adicione itens para acompanhar o catálogo aqui." /> : <div className="donut-summary"><div style={{ '--progress': `${gifts.length ? (metrics.receivedGifts / Math.max(metrics.receivedGifts + metrics.availableGifts, 1)) * 100 : 0}%` } as React.CSSProperties}><span>{metrics.receivedGifts}</span><small>recebidos</small></div><ul><li><i className="dot dot--wine" />{metrics.receivedGifts} recebidos</li><li><i className="dot dot--blush" />{metrics.availableGifts} disponíveis</li><li><i className="dot dot--muted" />{gifts.filter((item) => item.disabled).length} ocultos</li></ul></div>}
      </article>

      <article className="overview-panel compact-status-panel">
        <header><div><p className="eyebrow">Tarefas</p><h2>Andamento do quadro</h2></div><CheckCircle2 size={19} /></header>
        {!loading && !hasTasks ? <EmptyModule icon={<ListTodo size={22} />} title="Sem tarefas cadastradas" description="Crie tarefas para acompanhar o planejamento." /> : <div className="task-dashboard-list"><div><span>A fazer</span><strong>{tasks.filter((item) => item.status === 'todo').length}</strong></div><div><span>Em andamento</span><strong>{metrics.inProgressTasks}</strong></div><div><span>Concluídas</span><strong>{metrics.completedTasks}</strong></div></div>}
      </article>
    </section>
  </main>
}

function EmptyModule({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="overview-empty">{icon}<strong>{title}</strong><p>{description}</p></div>
}
