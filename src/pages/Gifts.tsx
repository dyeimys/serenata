import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc, type Timestamp } from 'firebase/firestore'
import { Check, ExternalLink, Gift, Image, PackageCheck, Pencil, Plus, Search, X } from 'lucide-react'
import { db } from '../lib/firestore'

type GiftItem = {
  id: string
  title: string
  giftType: string
  image: string
  imageAlt: string
  productLink: string
  received: boolean
  disabled: boolean
  createdAt: Timestamp | null
}

type GiftForm = Omit<GiftItem, 'id' | 'createdAt'>

const emptyForm: GiftForm = {
  title: '',
  giftType: 'eletrodomestico',
  image: '',
  imageAlt: '',
  productLink: '',
  received: false,
  disabled: false,
}

const giftTypes = [
  { value: 'eletrodomestico', label: 'Eletrodoméstico' },
  { value: 'cozinha', label: 'Cozinha' },
  { value: 'cama-mesa-banho', label: 'Cama, mesa e banho' },
  { value: 'decoracao', label: 'Decoração' },
  { value: 'jardim', label: 'Jardim' },
  { value: 'experiencia', label: 'Experiência' },
  { value: 'outros', label: 'Outros' },
]

function typeLabel(value: string) {
  return giftTypes.find((type) => type.value === value)?.label ?? value
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function Gifts() {
  const [items, setItems] = useState<GiftItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'available' | 'received' | 'disabled'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<GiftForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!db) return
    return onSnapshot(
      collection(db, 'giftRegistryItems'),
      (snapshot) => {
        const nextItems = snapshot.docs.map((itemDocument) => {
          const data = itemDocument.data()
          return {
            id: itemDocument.id,
            title: String(data.title ?? 'Presente sem nome'),
            giftType: String(data.giftType ?? 'outros'),
            image: String(data.image ?? ''),
            imageAlt: String(data.imageAlt ?? data.title ?? 'Imagem do presente'),
            productLink: String(data.productLink ?? ''),
            received: Boolean(data.received),
            disabled: Boolean(data.disabled),
            createdAt: data.createdAt ?? null,
          }
        })
        nextItems.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
        setItems(nextItems)
        setError('')
        setLoading(false)
      },
      (caught) => {
        console.error('Erro ao carregar presentes:', caught)
        setError(caught.code === 'permission-denied'
          ? 'Sua conta não tem permissão para consultar a lista. Verifique as regras do Firestore.'
          : 'Não foi possível carregar a lista de presentes agora.')
        setLoading(false)
      },
    )
  }, [])

  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return items.filter((item) => {
      const matchesSearch = !term || `${item.title} ${item.giftType}`.toLocaleLowerCase('pt-BR').includes(term)
      const matchesStatus = status === 'all'
        || (status === 'available' && !item.received && !item.disabled)
        || (status === 'received' && item.received)
        || (status === 'disabled' && item.disabled)
      return matchesSearch && matchesStatus
    })
  }, [items, search, status])

  const summary = useMemo(() => ({
    total: items.length,
    available: items.filter((item) => !item.received && !item.disabled).length,
    received: items.filter((item) => item.received).length,
    disabled: items.filter((item) => item.disabled).length,
  }), [items])

  function openNewItem() {
    setEditingId(null)
    setForm(emptyForm)
    setFormError('')
    setFormOpen(true)
  }

  function openEditItem(item: GiftItem) {
    setEditingId(item.id)
    setForm({
      title: item.title,
      giftType: item.giftType,
      image: item.image,
      imageAlt: item.imageAlt === item.title ? '' : item.imageAlt,
      productLink: item.productLink,
      received: item.received,
      disabled: item.disabled,
    })
    setFormError('')
    setFormOpen(true)
  }

  function closeForm() {
    if (saving) return
    setFormOpen(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!db) return
    setSaving(true)
    setFormError('')
    const payload = {
      title: form.title.trim(),
      giftType: form.giftType,
      image: normalizeUrl(form.image),
      imageAlt: form.imageAlt.trim() || form.title.trim(),
      productLink: normalizeUrl(form.productLink),
      received: form.received,
      disabled: form.disabled,
      updatedAt: serverTimestamp(),
    }

    try {
      if (editingId) {
        await updateDoc(doc(db, 'giftRegistryItems', editingId), payload)
      } else {
        await addDoc(collection(db, 'giftRegistryItems'), { ...payload, createdAt: serverTimestamp() })
      }
      setFormOpen(false)
    } catch (caught) {
      console.error('Erro ao salvar presente:', caught)
      setFormError('Não foi possível salvar. Verifique sua permissão e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  async function updateFlag(item: GiftItem, field: 'received' | 'disabled', value: boolean) {
    if (!db) return
    try {
      await updateDoc(doc(db, 'giftRegistryItems', item.id), { [field]: value, updatedAt: serverTimestamp() })
    } catch (caught) {
      console.error('Erro ao atualizar presente:', caught)
      setError('Não foi possível atualizar o presente. Verifique sua permissão.')
    }
  }

  return (
    <main className="dashboard-content gifts-page">
      <div className="dashboard-title gifts-title">
        <div><p className="eyebrow">Curadoria de presentes</p><h1>Lista de presentes</h1><p className="page-description">Gerencie os itens que serão exibidos aos convidados.</p></div>
        <button className="compact-primary" onClick={openNewItem}><Plus size={17} />Adicionar presente</button>
      </div>

      <section className="gift-summary" aria-label="Resumo dos presentes">
        <button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}><span>Todos os itens</span><strong>{summary.total}</strong></button>
        <button className={status === 'available' ? 'active' : ''} onClick={() => setStatus('available')}><span>Disponíveis</span><strong>{summary.available}</strong></button>
        <button className={status === 'received' ? 'active' : ''} onClick={() => setStatus('received')}><span>Recebidos</span><strong>{summary.received}</strong></button>
        <button className={status === 'disabled' ? 'active' : ''} onClick={() => setStatus('disabled')}><span>Desabilitados</span><strong>{summary.disabled}</strong></button>
      </section>

      <div className="catalog-toolbar">
        <div><h2>Catálogo</h2><p>Visualização administrativa do marketplace</p></div>
        <div className="search-field catalog-search"><Search size={17} /><input aria-label="Buscar presentes" placeholder="Buscar presente ou categoria" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      </div>

      {loading && <div className="list-state"><span className="spinner spinner--wine" />Carregando presentes...</div>}
      {error && <div className="list-state list-state--error"><X size={22} /><strong>Não foi possível acessar o catálogo</strong><p>{error}</p></div>}
      {!loading && !error && visibleItems.length === 0 && <div className="list-state gift-empty"><Gift size={28} /><strong>Nenhum presente por aqui</strong><p>Adicione um item ou altere os filtros para visualizar o catálogo.</p><button className="compact-primary" onClick={openNewItem}><Plus size={16} />Adicionar presente</button></div>}

      {!loading && !error && visibleItems.length > 0 && (
        <section className="gift-grid" aria-label="Catálogo de presentes">
          {visibleItems.map((item) => <article className={`gift-card ${item.disabled ? 'gift-card--disabled' : ''}`} key={item.id}>
            <div className="gift-image">
              {item.image ? <img src={item.image} alt={item.imageAlt} loading="lazy" /> : <div className="image-placeholder"><Image size={30} /><span>Sem imagem</span></div>}
              <div className="gift-badges">
                {item.received && <span className="gift-badge gift-badge--received"><Check size={11} />Recebido</span>}
                {item.disabled && <span className="gift-badge gift-badge--disabled"><X size={11} />Oculto</span>}
              </div>
              <button className="edit-gift" onClick={() => openEditItem(item)} aria-label={`Editar ${item.title}`}><Pencil size={15} /></button>
            </div>
            <div className="gift-card-content">
              <p>{typeLabel(item.giftType)}</p>
              <h3>{item.title}</h3>
              <div className="gift-card-actions">
                <button className={item.received ? 'selected' : ''} onClick={() => updateFlag(item, 'received', !item.received)}><PackageCheck size={15} />{item.received ? 'Recebido' : 'Marcar recebido'}</button>
                <button className={item.disabled ? 'selected danger' : ''} onClick={() => updateFlag(item, 'disabled', !item.disabled)}>{item.disabled ? 'Reativar' : 'Desabilitar'}</button>
              </div>
              {item.productLink && <a href={item.productLink} target="_blank" rel="noreferrer">Ver produto <ExternalLink size={12} /></a>}
            </div>
          </article>)}
        </section>
      )}

      {formOpen && <div className="gift-form-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}>
        <section className="gift-form-panel" role="dialog" aria-modal="true" aria-labelledby="gift-form-title">
          <div className="gift-form-header"><div><p className="eyebrow">Catálogo</p><h2 id="gift-form-title">{editingId ? 'Editar presente' : 'Novo presente'}</h2></div><button onClick={closeForm} aria-label="Fechar formulário"><X size={21} /></button></div>
          <form onSubmit={handleSubmit} className="gift-form">
            <label htmlFor="gift-title">Nome do presente *</label>
            <input id="gift-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Soprador de folhas" required />

            <label htmlFor="gift-type">Categoria *</label>
            <select id="gift-type" value={form.giftType} onChange={(event) => setForm({ ...form, giftType: event.target.value })}>{giftTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select>

            <label htmlFor="gift-image">URL da imagem *</label>
            <input id="gift-image" type="url" value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} placeholder="https://..." required />

            <label htmlFor="gift-alt">Descrição da imagem <span>opcional</span></label>
            <input id="gift-alt" value={form.imageAlt} onChange={(event) => setForm({ ...form, imageAlt: event.target.value })} placeholder="Por padrão, usaremos o nome do presente" />

            <label htmlFor="gift-link">Link do produto <span>opcional</span></label>
            <input id="gift-link" type="url" value={form.productLink} onChange={(event) => setForm({ ...form, productLink: event.target.value })} placeholder="https://..." />

            <div className="gift-form-switches">
              <label><input type="checkbox" checked={form.received} onChange={(event) => setForm({ ...form, received: event.target.checked })} /><span><strong>Já recebido</strong><small>Identifica que o casal já recebeu este item.</small></span></label>
              <label><input type="checkbox" checked={form.disabled} onChange={(event) => setForm({ ...form, disabled: event.target.checked })} /><span><strong>Desabilitado</strong><small>O item não será mostrado no site público.</small></span></label>
            </div>

            {formError && <p className="form-message form-message--error" role="alert">{formError}</p>}
            <div className="gift-form-footer"><button type="button" onClick={closeForm}>Cancelar</button><button className="compact-primary" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : <><Check size={16} />{editingId ? 'Salvar alterações' : 'Adicionar presente'}</>}</button></div>
          </form>
        </section>
      </div>}
    </main>
  )
}
