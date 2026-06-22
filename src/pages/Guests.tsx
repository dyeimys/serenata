import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore'
import { AlertTriangle, Baby, Check, ChevronDown, Search, UserRound, Users, X } from 'lucide-react'
import { db } from '../lib/firestore'
import { isRsvpConfirmed } from '../lib/rsvp'
import { consolidateRsvpDuplicates, type RsvpConsolidationSnapshot } from '../lib/rsvpConsolidation'

type RsvpSubmission = {
  id: string
  adults: number
  attending?: boolean
  children: number
  createdAt: Timestamp | null
  excludedFromMetrics: boolean
  consolidationStatus: string
  name: string
  phone: string
  totalGuests: number
}

type Filter = 'all' | 'confirmed' | 'declined'

type ConsolidationForm = {
  name: string
  phone: string
  adults: number
  children: number
  attending: boolean
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
  const [consolidation, setConsolidation] = useState<RsvpConsolidationSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [consolidating, setConsolidating] = useState(false)
  const [error, setError] = useState('')
  const [consolidationMessage, setConsolidationMessage] = useState('')
  const [consolidationError, setConsolidationError] = useState('')
  const [duplicateAlertCollapsed, setDuplicateAlertCollapsed] = useState(true)
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [form, setForm] = useState<ConsolidationForm>({ name: '', phone: '', adults: 0, children: 0, attending: true })

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
            excludedFromMetrics: data.excludedFromMetrics === true,
            consolidationStatus: String(data.consolidationStatus ?? ''),
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

  useEffect(() => {
    if (!db) return
    return onSnapshot(doc(db, 'rsvpConsolidation', 'current'), (snapshot) => {
      if (!snapshot.exists()) {
        setConsolidation(null)
        return
      }
      const data = snapshot.data()
       setConsolidation({
         generatedAt: data.generatedAt,
         hasDuplicates: Boolean(data.hasDuplicates),
         duplicateGroupCount: Number(data.duplicateGroupCount) || 0,
         duplicateSubmissionCount: Number(data.duplicateSubmissionCount) || 0,
         groups: Array.isArray(data.groups) ? data.groups.map((group: unknown) => {
           const g = group as any
           return {
             key: String(g.key ?? ''),
             reason: (g.reason === 'name_phone' ? 'name_phone' : g.reason === 'phone' ? 'phone' : g.reason === 'mixed' ? 'mixed' : 'name') as 'name' | 'phone' | 'name_phone' | 'mixed',
             canonicalSubmissionId: String(g.canonicalSubmissionId ?? ''),
             submissionIds: Array.isArray(g.submissionIds) ? g.submissionIds.map((id: unknown) => String(id)) : [],
             canonicalName: String(g.canonicalName ?? 'Não informado'),
             canonicalPhone: String(g.canonicalPhone ?? 'Não informado'),
             totalGuestsPreview: Number(g.totalGuestsPreview) || 0,
             matchedBy: Array.isArray(g.matchedBy) ? g.matchedBy.filter((value: unknown): value is 'name' | 'phone' => value === 'name' || value === 'phone') : [],
             entries: Array.isArray(g.entries) ? g.entries.map((entry: unknown) => {
               const e = entry as any
               const result: any = {
                 id: String(e.id ?? ''),
                 name: String(e.name ?? 'Não informado'),
                 phone: String(e.phone ?? 'Não informado'),
                 adults: Number(e.adults) || 0,
                 children: Number(e.children) || 0,
                 totalGuests: Number(e.totalGuests) || 0,
               }
               if (typeof e.attending === 'boolean') {
                 result.attending = e.attending
               }
               return result
             }) : [],
           } as any
         }) : [],
       })
    })
  }, [])

  const summary = useMemo(() => {
    const active = submissions.filter((item) => !item.excludedFromMetrics)
    const confirmed = active.filter(isRsvpConfirmed)
    return {
      people: confirmed.reduce((total, item) => total + item.totalGuests, 0),
      adults: confirmed.reduce((total, item) => total + item.adults, 0),
      children: confirmed.reduce((total, item) => total + item.children, 0),
      declined: active.filter((item) => !isRsvpConfirmed(item)).length,
    }
  }, [submissions])

  const duplicateIdSet = useMemo(() => {
    const ids = new Set<string>()
    consolidation?.groups.forEach((group) => group.submissionIds.forEach((id) => ids.add(id)))
    return ids
  }, [consolidation])

  const submissionLookup = useMemo(() => new Map(submissions.map((submission) => [submission.id, submission])), [submissions])

  function resolveGroupEntries(group: NonNullable<RsvpConsolidationSnapshot>['groups'][number]) {
    if (group.entries.length > 0) return group.entries
    return group.submissionIds
      .map((id) => submissionLookup.get(id))
      .filter((submission): submission is RsvpSubmission => Boolean(submission))
      .map((submission) => ({
        id: submission.id,
        name: submission.name,
        phone: submission.phone,
        adults: submission.adults,
        children: submission.children,
        totalGuests: submission.totalGuests,
        attending: submission.attending,
      }))
  }

  const selectedGroup = useMemo(() => {
    if (!selectedGroupKey) return null
    return consolidation?.groups.find((group) => group.key === selectedGroupKey) ?? null
  }, [consolidation, selectedGroupKey])

   const selectedGroupEntries = useMemo(() => selectedGroup ? resolveGroupEntries(selectedGroup) : [], [selectedGroup, submissionLookup]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeSubmissions = useMemo(() => submissions.filter((submission) => !submission.excludedFromMetrics), [submissions])

  const visibleSubmissions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return activeSubmissions.filter((submission) => {
      const confirmed = isRsvpConfirmed(submission)
      const matchesFilter = filter === 'all' || (filter === 'confirmed' ? confirmed : !confirmed)
      const matchesSearch = !term || `${submission.name} ${submission.phone}`.toLocaleLowerCase('pt-BR').includes(term)
      return matchesFilter && matchesSearch
    })
  }, [activeSubmissions, filter, search])

   function openConsolidationForm(group: NonNullable<RsvpConsolidationSnapshot>['groups'][number]) {
     const entries = resolveGroupEntries(group)
     const preferred = entries.find((entry: any) => entry.id === group.canonicalSubmissionId) ?? entries[0]
     setSelectedGroupKey(group.key)
     setConsolidationError('')
     setSelectedArchiveIds(group.submissionIds)
     setForm({
       name: preferred?.name ?? group.canonicalName,
       phone: preferred?.phone ?? group.canonicalPhone,
       adults: preferred?.adults ?? 0,
       children: preferred?.children ?? 0,
       attending: preferred?.attending !== false,
     })
   }

  function closeConsolidationForm() {
    if (consolidating) return
    setSelectedGroupKey('')
    setSelectedArchiveIds([])
    setConsolidationError('')
  }

  function toggleArchiveSelection(submissionId: string) {
    setSelectedArchiveIds((current) => current.includes(submissionId)
      ? current.filter((id) => id !== submissionId)
      : [...current, submissionId])
  }

   function duplicateReasonLabel(group: NonNullable<RsvpConsolidationSnapshot>['groups'][number]): string {
     if ((group.reason as any) === 'name_phone') return 'Mesmo nome e telefone'
     if (group.reason === 'name') return 'Mesmo nome'
     if (group.reason === 'phone') return 'Mesmo telefone (revisão manual)'
     return 'Sinais mistos para revisão'
   }

  async function submitManualConsolidation() {
    if (!selectedGroup) return
    if (!form.name.trim()) {
      setConsolidationError('Informe o nome do novo registro consolidado.')
      return
    }
    if (selectedArchiveIds.length < 2) {
      setConsolidationError('Selecione pelo menos 2 registros para arquivar.')
      return
    }

     setConsolidating(true)
     setConsolidationMessage('')
     setConsolidationError('')
     try {
       const result = await consolidateRsvpDuplicates({
         groupKey: selectedGroup.key,
         archiveSubmissionIds: selectedArchiveIds,
         name: form.name.trim(),
         phone: form.phone.trim(),
         adults: Math.max(0, Number(form.adults) || 0),
         children: Math.max(0, Number(form.children) || 0),
         attending: form.attending,
       } as any)
      setConsolidationMessage(result.message)
      setSelectedGroupKey('')
      setSelectedArchiveIds([])
    } catch (caught) {
      console.error('Erro ao consolidar confirmações:', caught)
      setConsolidationError('Não foi possível criar o registro consolidado. Verifique seu papel e tente novamente.')
    } finally {
      setConsolidating(false)
    }
  }

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

      {(consolidation || !loading) && <section className="guest-duplicate-alert" role="status" aria-live="polite">
        <button className="guest-duplicate-toggle" type="button" onClick={() => setDuplicateAlertCollapsed((current) => !current)} aria-expanded={!duplicateAlertCollapsed}>
          <div className="guest-duplicate-header"><AlertTriangle size={18} /><div><strong>Possíveis duplicações detectadas</strong><p>{consolidation ? `Encontramos ${consolidation.duplicateGroupCount} grupo(s) com ${consolidation.duplicateSubmissionCount} confirmações para revisão.` : 'A análise ainda não gerou um resumo.'}</p></div></div>
          <ChevronDown size={18} className={duplicateAlertCollapsed ? '' : 'guest-duplicate-toggle-icon--open'} />
        </button>
        {!duplicateAlertCollapsed && <>
          <p className="guest-duplicate-plan">A consolidação é manual. Telefone sozinho não confirma duplicidade, mas continua sendo um sinal de revisão. Revise os envios e crie um novo registro final apenas quando fizer sentido.</p>
          <div className="guest-duplicate-actions"><span>{consolidationMessage || (consolidation?.hasDuplicates ? 'Os grupos abaixo precisam de revisão manual.' : 'A última análise não encontrou grupos suspeitos.')}</span></div>
           {consolidation?.hasDuplicates && <div className="guest-duplicate-groups">{consolidation.groups.map((group) => <article key={group.key}><strong>{duplicateReasonLabel(group)}</strong><p>Base sugerida: {group.canonicalName} ({group.canonicalPhone})</p><small>{group.submissionIds.length} envios no grupo · total informado: {group.totalGuestsPreview}</small><small className="guest-duplicate-evidence">Sinais usados: {group.matchedBy.includes('name') ? 'nome' : ''}{group.matchedBy.includes('name') && group.matchedBy.includes('phone') ? ' + ' : ''}{group.matchedBy.includes('phone') ? 'telefone' : ''}</small><ul className="guest-duplicate-entry-list">{resolveGroupEntries(group).map((entry: any) => <li key={entry.id} className="guest-duplicate-entry"><span>{entry.name} · {entry.phone}</span><small>{entry.adults} adultos, {entry.children} crianças ({entry.totalGuests} total) · {entry.attending === false ? 'Recusou' : 'Confirmou'}</small></li>)}</ul><button className="compact-primary" type="button" onClick={() => openConsolidationForm(group)}>Criar registro consolidado</button></article>)}</div>}
        </>}
      </section>}

      <section className="guest-list-card">
        <div className="guest-toolbar">
          <div><h2>Respostas recebidas</h2><p>{activeSubmissions.length} {activeSubmissions.length === 1 ? 'envio ativo' : 'envios ativos'}</p></div>
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
                const confirmed = isRsvpConfirmed(submission)
                const isPossibleDuplicate = duplicateIdSet.has(submission.id)
                return <tr key={submission.id} className={isPossibleDuplicate ? 'guest-row--possible-duplicate' : undefined}>
                  <td data-label="Convidado"><span className="guest-avatar">{submission.name.charAt(0).toUpperCase()}</span><div><strong>{submission.name}</strong><small>ID: {submission.id}</small></div></td>
                  <td data-label="Contato">{submission.phone}</td>
                  <td data-label="Adultos">{submission.adults}</td>
                  <td data-label="Crianças">{submission.children}</td>
                  <td data-label="Total"><strong>{submission.totalGuests}</strong></td>
                  <td data-label="Resposta"><span className={`status-pill ${confirmed ? 'status-pill--confirmed' : 'status-pill--declined'}`}>{confirmed ? <Check size={12} /> : <X size={12} />}{confirmed ? 'Confirmado' : 'Não comparece'}</span>{isPossibleDuplicate && <small className="guest-duplicate-tag"><AlertTriangle size={11} />Possível duplicado</small>}</td>
                  <td data-label="Enviado em">{formatDate(submission.createdAt)}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      {selectedGroup && <div className="gift-form-layer guest-consolidation-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConsolidationForm() }}>
        <section className="gift-delete-modal guest-consolidation-modal" role="dialog" aria-modal="true" aria-labelledby="guest-consolidation-title">
          <div className="gift-delete-head"><AlertTriangle size={18} /><h2 id="guest-consolidation-title">Novo registro consolidado</h2></div>
          <p>Você criará um novo registro final para este grupo. Selecione manualmente quais envios serão arquivados e removidos da tabela principal.</p>
          <div className="guest-consolidation-existing-actions"><button type="button" onClick={() => setSelectedArchiveIds(selectedGroup.submissionIds)} disabled={consolidating}>Selecionar todos</button><button type="button" onClick={() => setSelectedArchiveIds([])} disabled={consolidating}>Limpar seleção</button><small>{selectedArchiveIds.length} de {selectedGroup.submissionIds.length} selecionados</small></div>
           <div className="guest-consolidation-existing" aria-label="Registros atuais do grupo">
             {selectedGroupEntries.map((entry: any) => <label key={entry.id} className="guest-consolidation-existing-item"><input type="checkbox" checked={selectedArchiveIds.includes(entry.id)} onChange={() => toggleArchiveSelection(entry.id)} disabled={consolidating} /><small>ID {entry.id.slice(0, 8)} · {entry.name} · {entry.phone || 'Sem telefone'} · {entry.adults}A/{entry.children}C ({entry.totalGuests}) · {entry.attending === false ? 'Recusou' : 'Confirmou'}</small></label>)}
           </div>
          <div className="guest-consolidation-form">
            <label htmlFor="consolidation-name">Nome do convidado</label>
            <input id="consolidation-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            <label htmlFor="consolidation-phone">Telefone</label>
            <input id="consolidation-phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            <div className="guest-consolidation-grid">
              <label htmlFor="consolidation-adults">Adultos</label>
              <input id="consolidation-adults" type="number" min={0} value={form.adults} onChange={(event) => setForm((current) => ({ ...current, adults: Number(event.target.value) || 0 }))} />
              <label htmlFor="consolidation-children">Crianças</label>
              <input id="consolidation-children" type="number" min={0} value={form.children} onChange={(event) => setForm((current) => ({ ...current, children: Number(event.target.value) || 0 }))} />
            </div>
            <label className="guest-consolidation-checkbox"><input type="checkbox" checked={form.attending} onChange={(event) => setForm((current) => ({ ...current, attending: event.target.checked }))} /><span>Considerar como presença confirmada</span></label>
          </div>
          {consolidationError && <p className="form-message form-message--error" role="alert">{consolidationError}</p>}
          <div className="gift-delete-actions"><button type="button" onClick={closeConsolidationForm} disabled={consolidating}>Cancelar</button><button className="compact-primary" type="button" onClick={() => void submitManualConsolidation()} disabled={consolidating}>{consolidating ? <span className="spinner" /> : 'Criar e arquivar selecionados'}</button></div>
        </section>
      </div>}
    </main>
  )
}
