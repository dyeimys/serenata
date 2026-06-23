import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, onSnapshot, orderBy, query, where, type Timestamp } from 'firebase/firestore'
import { jsPDF } from 'jspdf'
import { AlertTriangle, Baby, Check, ChevronDown, Download, Info, Search, UserRound, Users, X } from 'lucide-react'
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
  consolidatedFromSubmissionIds: string[]
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

type ArchivedSubmission = {
  id: string
  originalSubmissionId: string
  name: string
  phone: string
  adults: number
  children: number
  totalGuests: number
  attending?: boolean
  consolidationStatus: string
  createdAt: Timestamp | null
  archivedAt: Timestamp | null
}

type WeddingProfile = {
  coupleNames: string[]
  weddingDate: string
  ceremonyTime: string
  city: string
  state: string
  venue: string
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

function formatIsoDate(value: string) {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function toUpperPtBr(value: string) {
  return value.trim().toLocaleUpperCase('pt-BR')
}

function formatZeroAsDash(value: number) {
  return value === 0 ? '-' : String(value)
}

async function loadImageDataUrl(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(null)
        return
      }
      context.drawImage(image, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => resolve(null)
    image.src = path
  })
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
  const [archivedItemsModal, setArchivedItemsModal] = useState<{
    submissionId: string
    expectedIds: string[]
    loading: boolean
    error: string
    items: ArchivedSubmission[]
  } | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [form, setForm] = useState<ConsolidationForm>({ name: '', phone: '', adults: 0, children: 0, attending: true })
  const [weddingProfile, setWeddingProfile] = useState<WeddingProfile | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportError, setExportError] = useState('')

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
            consolidatedFromSubmissionIds: Array.isArray(data.consolidatedFromSubmissionIds)
              ? data.consolidatedFromSubmissionIds.map((value: unknown) => String(value)).filter(Boolean)
              : [],
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
    return onSnapshot(doc(db, 'settings', 'weddingProfile'), (snapshot) => {
      if (!snapshot.exists()) {
        setWeddingProfile(null)
        return
      }
      const data = snapshot.data()
      setWeddingProfile({
        coupleNames: Array.isArray(data.coupleNames) ? data.coupleNames.map((value: unknown) => String(value)).filter(Boolean) : [],
        weddingDate: String(data.weddingDate ?? ''),
        ceremonyTime: String(data.ceremonyTime ?? ''),
        city: String(data.city ?? ''),
        state: String(data.state ?? ''),
        venue: String(data.venue ?? ''),
      })
    })
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
  const confirmedSubmissions = useMemo(() => activeSubmissions.filter(isRsvpConfirmed), [activeSubmissions])

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

  async function openArchivedItemsModal(submission: RsvpSubmission) {
    setArchivedItemsModal({
      submissionId: submission.id,
      expectedIds: submission.consolidatedFromSubmissionIds,
      loading: true,
      error: '',
      items: [],
    })

    if (!db) {
      setArchivedItemsModal((current) => current
        ? { ...current, loading: false, error: 'Banco de dados não configurado.' }
        : current)
      return
    }

    try {
      const archivedQuery = query(
        collection(db, 'rsvpSubmissionsArchive'),
        where('replacedBySubmissionId', '==', submission.id),
      )
      const snapshot = await getDocs(archivedQuery)
      const items = snapshot.docs.map((document) => {
        const data = document.data()
        return {
          id: document.id,
          originalSubmissionId: String(data.originalSubmissionId ?? ''),
          name: String(data.name ?? 'Nome não informado'),
          phone: String(data.phone ?? 'Não informado'),
          adults: Number(data.adults) || 0,
          children: Number(data.children) || 0,
          totalGuests: Number(data.totalGuests) || 0,
          attending: typeof data.attending === 'boolean' ? data.attending : undefined,
          consolidationStatus: String(data.consolidationStatus ?? ''),
          createdAt: data.createdAt ?? null,
          archivedAt: data.archivedAt ?? null,
        } as ArchivedSubmission
      }).sort((a, b) => (b.archivedAt?.toMillis?.() ?? 0) - (a.archivedAt?.toMillis?.() ?? 0))

      setArchivedItemsModal((current) => current
        ? { ...current, loading: false, items }
        : current)
    } catch (caught) {
      console.error('Erro ao carregar itens arquivados:', caught)
      setArchivedItemsModal((current) => current
        ? { ...current, loading: false, error: 'Não foi possível carregar os itens arquivados agora.' }
        : current)
    }
  }

  function closeArchivedItemsModal() {
    setArchivedItemsModal(null)
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

  async function exportConfirmedGuestsPdf() {
    if (confirmedSubmissions.length === 0) {
      setExportError('Nao ha convidados confirmados para exportar no momento.')
      return
    }

    setExportingPdf(true)
    setExportError('')

    try {
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 14
      const tableBottomMargin = 16
      const tableHeaderHeight = 8
      const tableRowHeight = 7
      const logoDataUrl = await loadImageDataUrl('/icon-192.png')
      const generatedAt = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date())

      const coupleLabel = weddingProfile?.coupleNames.length
        ? weddingProfile.coupleNames.map(toUpperPtBr).join(' E ')
        : 'Nao informado'
      const weddingDateLabel = weddingProfile?.weddingDate
        ? `${formatIsoDate(weddingProfile.weddingDate)}${weddingProfile.ceremonyTime ? ` as ${weddingProfile.ceremonyTime}` : ''}`
        : 'Nao informado'
      const locationLabel = [weddingProfile?.venue, [weddingProfile?.city, weddingProfile?.state].filter(Boolean).join('/')]
        .filter(Boolean)
        .join(' - ')

      const exportSubmissions = [...confirmedSubmissions].sort((a, b) => (
        toUpperPtBr(a.name).localeCompare(toUpperPtBr(b.name), 'pt-BR', { sensitivity: 'base' })
      ))

      pdf.setFillColor(247, 243, 239)
      pdf.rect(margin, 10, pageWidth - (margin * 2), 22, 'F')
      if (logoDataUrl) {
        pdf.addImage(logoDataUrl, 'PNG', margin + 3, 13.5, 14, 14)
      }

      pdf.setTextColor(76, 52, 54)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(14)
      pdf.text('Serenata', margin + 22, 18)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.text('Lista de convidados confirmados', margin + 22, 23)
      pdf.setTextColor(130, 108, 110)
      pdf.setFontSize(9)
      pdf.text(`Gerado em ${generatedAt}`, margin + 22, 28)

      pdf.setFillColor(255, 255, 255)
      pdf.setDrawColor(232, 221, 216)
      pdf.rect(margin, 36, pageWidth - (margin * 2), 30, 'FD')

      pdf.setTextColor(109, 87, 89)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.text('Informacoes do casamento', margin + 4, 43)

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.text(`Casal: ${coupleLabel}`, margin + 4, 49)
      pdf.text(`Data: ${weddingDateLabel}`, margin + 4, 54)
      pdf.text(`Local: ${locationLabel ? toUpperPtBr(locationLabel) : 'Nao informado'}`, margin + 4, 59)
      pdf.text(`Confirmados: ${formatZeroAsDash(summary.people)} pessoas (${formatZeroAsDash(summary.adults)} adultos e ${formatZeroAsDash(summary.children)} criancas)`, margin + 4, 64)

      const columns = [
        { title: 'Convidado', width: 50 },
        { title: 'Contato', width: 36 },
        { title: 'Adultos', width: 16 },
        { title: 'Criancas', width: 16 },
        { title: 'Total', width: 14 },
        { title: 'Confirmado em', width: 46 },
      ] as const

      const drawTableHeader = (top: number) => {
        let currentX = margin
        pdf.setFillColor(245, 237, 232)
        pdf.rect(margin, top, pageWidth - (margin * 2), tableHeaderHeight, 'F')
        pdf.setTextColor(94, 72, 74)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        columns.forEach((column) => {
          pdf.text(column.title, currentX + 1.5, top + 5.5)
          currentX += column.width
        })
      }

      const drawRow = (top: number, values: string[]) => {
        let currentX = margin
        pdf.setDrawColor(238, 230, 226)
        pdf.line(margin, top + tableRowHeight, pageWidth - margin, top + tableRowHeight)
        pdf.setTextColor(82, 64, 65)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8)
        values.forEach((value, index) => {
          const width = columns[index].width
          const sliced = (pdf.splitTextToSize(value, width - 3)[0] ?? '') as string
          const alignRight = index >= 2 && index <= 4
          pdf.text(sliced, alignRight ? currentX + width - 1.5 : currentX + 1.5, top + 4.9, { align: alignRight ? 'right' : 'left' })
          currentX += width
        })
      }

      let y = 72
      drawTableHeader(y)
      y += tableHeaderHeight

      exportSubmissions.forEach((submission) => {
        if (y + tableRowHeight > pageHeight - tableBottomMargin) {
          pdf.addPage()
          y = 16
          drawTableHeader(y)
          y += tableHeaderHeight
        }

        drawRow(y, [
          toUpperPtBr(submission.name),
          submission.phone || '-',
          formatZeroAsDash(submission.adults),
          formatZeroAsDash(submission.children),
          formatZeroAsDash(submission.totalGuests),
          formatDate(submission.createdAt),
        ])
        y += tableRowHeight
      })

      const pages = pdf.getNumberOfPages()
      for (let page = 1; page <= pages; page += 1) {
        pdf.setPage(page)
        pdf.setTextColor(140, 122, 123)
        pdf.setFontSize(8)
        pdf.text(`Pagina ${page} de ${pages}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
      }

      const fileDate = new Date().toISOString().slice(0, 10)
      pdf.save(`convidados-confirmados-${fileDate}.pdf`)
    } catch (caught) {
      console.error('Erro ao exportar PDF de convidados:', caught)
      setExportError('Nao foi possivel exportar o PDF agora. Tente novamente em instantes.')
    } finally {
      setExportingPdf(false)
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
            <button className="compact-primary guest-export-button" type="button" onClick={() => void exportConfirmedGuestsPdf()} disabled={loading || exportingPdf || confirmedSubmissions.length === 0}>
              {exportingPdf ? <span className="spinner" /> : <><Download size={15} />Exportar PDF</>}
            </button>
            <div className="search-field"><Search size={17} /><input aria-label="Buscar convidados" placeholder="Buscar nome ou telefone" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="filter-group" aria-label="Filtrar respostas">
              <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
              <button className={filter === 'confirmed' ? 'active' : ''} onClick={() => setFilter('confirmed')}>Confirmados</button>
              <button className={filter === 'declined' ? 'active' : ''} onClick={() => setFilter('declined')}>Recusados</button>
            </div>
          </div>
        </div>
        {exportError && <p className="form-message form-message--error" role="alert">{exportError}</p>}

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
                const hasArchivedItems = submission.consolidationStatus === 'manual_canonical' && submission.consolidatedFromSubmissionIds.length > 0
                return <tr key={submission.id} className={isPossibleDuplicate ? 'guest-row--possible-duplicate' : undefined}>
                  <td data-label="Convidado"><span className="guest-avatar">{submission.name.charAt(0).toUpperCase()}</span><div><strong>{submission.name}{hasArchivedItems && <button type="button" className="guest-info-button" onClick={() => void openArchivedItemsModal(submission)} aria-label="Ver informações dos itens arquivados" title="Ver informações dos itens arquivados"><Info size={12} /></button>}</strong><small>ID: {submission.id}</small></div></td>
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

      {archivedItemsModal && <div className="gift-form-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeArchivedItemsModal() }}>
        <section className="gift-delete-modal" role="dialog" aria-modal="true" aria-labelledby="guest-archived-items-title">
          <div className="gift-delete-head"><AlertTriangle size={18} /><h2 id="guest-archived-items-title">Itens arquivados</h2></div>
          <p>Registro manual: <strong>{archivedItemsModal.submissionId}</strong></p>
          {archivedItemsModal.loading && <div className="list-state"><span className="spinner spinner--wine" />Carregando informações completas...</div>}
          {archivedItemsModal.error && <p className="form-message form-message--error" role="alert">{archivedItemsModal.error}</p>}
          {!archivedItemsModal.loading && !archivedItemsModal.error && archivedItemsModal.items.length === 0 && <div className="list-state"><strong>Nenhum item arquivado encontrado</strong><p>IDs esperados: {archivedItemsModal.expectedIds.join(', ') || 'nenhum'}.</p></div>}
          {!archivedItemsModal.loading && !archivedItemsModal.error && archivedItemsModal.items.length > 0 && <div className="guest-archived-list" aria-label="Lista de registros arquivados">
            {archivedItemsModal.items.map((item) => <article key={item.id} className="guest-archived-item"><strong>{item.name}</strong><small>Arquivo: {item.id}</small><small>Original: {item.originalSubmissionId || 'Não informado'}</small><small>Telefone: {item.phone || 'Não informado'}</small><small>Convidados: {item.adults} adultos, {item.children} crianças ({item.totalGuests} total)</small><small>Resposta: {item.attending === false ? 'Recusou' : 'Confirmou'}</small><small>Status: {item.consolidationStatus || 'Não informado'}</small><small>Enviado em: {formatDate(item.createdAt)}</small><small>Arquivado em: {formatDate(item.archivedAt)}</small></article>)}
          </div>}
          <div className="gift-delete-actions"><button type="button" onClick={closeArchivedItemsModal}>Fechar</button></div>
        </section>
      </div>}
    </main>
  )
}
