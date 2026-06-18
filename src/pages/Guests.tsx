import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore'
import { Baby, Check, Search, UserRound, Users, X } from 'lucide-react'
import { db } from '../lib/firestore'

type RsvpSubmission = {
  id: string
  adults: number
  attending?: boolean
  children: number
  createdAt: Timestamp | null
  name: string
  phone: string
  totalGuests: number
}

type Filter = 'all' | 'confirmed' | 'declined'

function isConfirmed(submission: RsvpSubmission) {
  return submission.attending !== false && submission.totalGuests > 0
}

function formatDate(timestamp: Timestamp | null) {
  if (!timestamp) return 'Data não informada'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp.toDate())
}

export function Guests() {
  const [submissions, setSubmissions] = useState<RsvpSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    if (!db) return

    const submissionsQuery = query(collection(db, 'rsvpSubmissions'), orderBy('createdAt', 'desc'))
    return onSnapshot(
      submissionsQuery,
      (snapshot) => {
        setSubmissions(snapshot.docs.map((document) => {
          const data = document.data()
          return {
            id: document.id,
            adults: Number(data.adults) || 0,
            attending: typeof data.attending === 'boolean' ? data.attending : undefined,
            children: Number(data.children) || 0,
            createdAt: data.createdAt ?? null,
            name: String(data.name ?? 'Nome não informado'),
            phone: String(data.phone ?? 'Não informado'),
            totalGuests: Number(data.totalGuests) || 0,
          }
        }))
        setError('')
        setLoading(false)
      },
      (caught) => {
        console.error('Erro ao carregar confirmações:', caught)
        setError(caught.code === 'permission-denied'
          ? 'Sua conta não tem permissão para consultar as confirmações. Verifique as regras do Firestore.'
          : 'Não foi possível carregar as confirmações agora.')
        setLoading(false)
      },
    )
  }, [])

  const summary = useMemo(() => {
    const confirmed = submissions.filter(isConfirmed)
    return {
      people: confirmed.reduce((total, item) => total + item.totalGuests, 0),
      adults: confirmed.reduce((total, item) => total + item.adults, 0),
      children: confirmed.reduce((total, item) => total + item.children, 0),
      declined: submissions.filter((item) => !isConfirmed(item)).length,
    }
  }, [submissions])

  const visibleSubmissions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return submissions.filter((submission) => {
      const confirmed = isConfirmed(submission)
      const matchesFilter = filter === 'all' || (filter === 'confirmed' ? confirmed : !confirmed)
      const matchesSearch = !term || `${submission.name} ${submission.phone}`.toLocaleLowerCase('pt-BR').includes(term)
      return matchesFilter && matchesSearch
    })
  }, [filter, search, submissions])

  return (
    <main className="dashboard-content guests-page">
      <div className="dashboard-title">
        <div><p className="eyebrow">Lista de presença</p><h1>Convidados confirmados</h1><p className="page-description">Acompanhe em tempo real as respostas enviadas pelo convite.</p></div>
        <span className="today"><Check size={17} /> {summary.people} presenças confirmadas</span>
      </div>

      <section className="guest-metrics" aria-label="Resumo das confirmações">
        <article><span><Users size={20} /></span><div><small>Total confirmado</small><strong>{summary.people}</strong><p>pessoas</p></div></article>
        <article><span><UserRound size={20} /></span><div><small>Adultos</small><strong>{summary.adults}</strong><p>confirmados</p></div></article>
        <article><span><Baby size={20} /></span><div><small>Crianças</small><strong>{summary.children}</strong><p>confirmadas</p></div></article>
        <article><span><X size={20} /></span><div><small>Não comparecem</small><strong>{summary.declined}</strong><p>respostas</p></div></article>
      </section>

      <section className="guest-list-card">
        <div className="guest-toolbar">
          <div><h2>Respostas recebidas</h2><p>{submissions.length} {submissions.length === 1 ? 'envio registrado' : 'envios registrados'}</p></div>
          <div className="guest-controls">
            <div className="search-field"><Search size={17} /><input aria-label="Buscar convidados" placeholder="Buscar nome ou telefone" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="filter-group" aria-label="Filtrar respostas">
              <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
              <button className={filter === 'confirmed' ? 'active' : ''} onClick={() => setFilter('confirmed')}>Confirmados</button>
              <button className={filter === 'declined' ? 'active' : ''} onClick={() => setFilter('declined')}>Recusados</button>
            </div>
          </div>
        </div>

        {loading && <div className="list-state"><span className="spinner spinner--wine" />Carregando confirmações...</div>}
        {error && <div className="list-state list-state--error"><X size={22} /><strong>Não foi possível acessar a lista</strong><p>{error}</p></div>}
        {!loading && !error && visibleSubmissions.length === 0 && <div className="list-state"><Users size={25} /><strong>Nenhum resultado encontrado</strong><p>Tente alterar a busca ou o filtro selecionado.</p></div>}

        {!loading && !error && visibleSubmissions.length > 0 && (
          <div className="guest-table-wrap">
            <table className="guest-table">
              <thead><tr><th>Convidado</th><th>Contato</th><th>Adultos</th><th>Crianças</th><th>Total</th><th>Resposta</th><th>Enviado em</th></tr></thead>
              <tbody>{visibleSubmissions.map((submission) => {
                const confirmed = isConfirmed(submission)
                return <tr key={submission.id}>
                  <td data-label="Convidado"><span className="guest-avatar">{submission.name.charAt(0).toUpperCase()}</span><div><strong>{submission.name}</strong><small>ID: {submission.id}</small></div></td>
                  <td data-label="Contato">{submission.phone}</td>
                  <td data-label="Adultos">{submission.adults}</td>
                  <td data-label="Crianças">{submission.children}</td>
                  <td data-label="Total"><strong>{submission.totalGuests}</strong></td>
                  <td data-label="Resposta"><span className={`status-pill ${confirmed ? 'status-pill--confirmed' : 'status-pill--declined'}`}>{confirmed ? <Check size={12} /> : <X size={12} />}{confirmed ? 'Confirmado' : 'Não comparece'}</span></td>
                  <td data-label="Enviado em">{formatDate(submission.createdAt)}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
