import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { Bold, Check, Code2, ExternalLink, Gift, Info, Italic, MessageCircle, Save, Settings as SettingsIcon, Strikethrough, Users, X } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { setDocumentWithAudit } from '../lib/audit'
import { db } from '../lib/firestore'
import { UserManagement } from './UserManagement'

type GiftSettings = {
  enableGiftConfirmation: boolean
  whatsappNumber: string
  confirmationMessageTemplate: string
}

const defaultSettings: GiftSettings = {
  enableGiftConfirmation: true,
  whatsappNumber: '+55 62 8474-8176',
  confirmationMessageTemplate: 'Oi! Tudo bem? Com muito carinho, quero presentear voces com {item}. Podem deixar que esse mimo ja esta por minha conta.',
}

const giftSettingsHash = '#lista-de-presentes'
const userSettingsHash = '#gestao-de-usuarios'

const whatsappFormats = [
  { label: 'Negrito', prefix: '*', suffix: '*', icon: Bold },
  { label: 'Itálico', prefix: '_', suffix: '_', icon: Italic },
  { label: 'Tachado', prefix: '~', suffix: '~', icon: Strikethrough },
  { label: 'Monoespaçado', prefix: '```', suffix: '```', icon: Code2 },
]

function renderWhatsappText(text: string, keyPrefix = 'message'): ReactNode[] {
  const markerPattern = /(```[\s\S]+?```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g
  const nodes: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(markerPattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index))
    const value = match[0]
    const key = `${keyPrefix}-${index}`
    if (value.startsWith('```')) nodes.push(<code key={key}>{value.slice(3, -3)}</code>)
    else if (value.startsWith('*')) nodes.push(<strong key={key}>{renderWhatsappText(value.slice(1, -1), key)}</strong>)
    else if (value.startsWith('_')) nodes.push(<em key={key}>{renderWhatsappText(value.slice(1, -1), key)}</em>)
    else nodes.push(<s key={key}>{renderWhatsappText(value.slice(1, -1), key)}</s>)
    lastIndex = index + value.length
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function Settings() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = location.hash === userSettingsHash ? 'users' : 'gifts'
  const [settings, setSettings] = useState<GiftSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!db) return
    return onSnapshot(
      doc(db, 'settings', 'gifts'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data()
          setSettings({
            enableGiftConfirmation: data.enableGiftConfirmation !== false,
            whatsappNumber: String(data.whatsappNumber ?? ''),
            confirmationMessageTemplate: String(data.confirmationMessageTemplate ?? ''),
          })
        }
        setLoading(false)
        setError('')
      },
      (caught) => {
        console.error('Erro ao carregar configurações:', caught)
        setError(caught.code === 'permission-denied'
          ? 'Sua conta não tem permissão para acessar estas configurações.'
          : 'Não foi possível carregar as configurações agora.')
        setLoading(false)
      },
    )
  }, [])

  useEffect(() => {
    if (location.hash === giftSettingsHash || location.hash === userSettingsHash) return
    void navigate({ pathname: location.pathname, search: location.search, hash: giftSettingsHash }, { replace: true })
  }, [location.hash, location.pathname, location.search, navigate])

  const preview = useMemo(() => settings.confirmationMessageTemplate.replaceAll('{item}', 'Soprador de folhas'), [settings.confirmationMessageTemplate])
  const hasItemPlaceholder = settings.confirmationMessageTemplate.includes('{item}')

  function applyWhatsappFormat(prefix: string, suffix: string) {
    const textarea = messageTextareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const message = settings.confirmationMessageTemplate
    const nextMessage = `${message.slice(0, start)}${prefix}${message.slice(start, end)}${suffix}${message.slice(end)}`
    setSettings({ ...settings, confirmationMessageTemplate: nextMessage })
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + prefix.length, end + prefix.length)
    })
  }

  function testOnWhatsapp() {
    const phone = settings.whatsappNumber.replace(/\D/g, '')
    if (!phone) {
      setError('Informe o número do WhatsApp antes de testar a mensagem.')
      return
    }
    setError('')
    const message = settings.confirmationMessageTemplate.replaceAll('{item}', 'Soprador de folhas')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!db) return
    setSaved(false)
    setError('')

    if (settings.enableGiftConfirmation && !settings.whatsappNumber.trim()) {
      setError('Informe o número do WhatsApp para habilitar a confirmação.')
      return
    }
    if (!hasItemPlaceholder) {
      setError('A mensagem precisa conter {item} para identificar o presente escolhido.')
      return
    }

    setSaving(true)
    try {
      await setDocumentWithAudit(db, 'settings', 'gifts', {
        enableGiftConfirmation: settings.enableGiftConfirmation,
        whatsappNumber: settings.whatsappNumber.trim(),
        confirmationMessageTemplate: settings.confirmationMessageTemplate.trim(),
      })
      setSaved(true)
    } catch (caught) {
      console.error('Erro ao salvar configurações:', caught)
      setError('Não foi possível salvar. Verifique sua permissão e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="dashboard-content settings-page">
      <div className="dashboard-title">
        <div><p className="eyebrow">Preferências do sistema</p><h1>Configurações</h1><p className="page-description">Personalize o comportamento das ferramentas do casamento.</p></div>
      </div>

      <div className="settings-layout">
        <aside className="settings-tabs" aria-label="Seções de configuração">
          <p>Configurações</p>
          <Link to={{ pathname: location.pathname, search: location.search, hash: giftSettingsHash }} className={activeTab === 'gifts' ? 'active' : ''} aria-current={activeTab === 'gifts' ? 'page' : undefined}><Gift size={17} /><span>Lista de presentes<small>Confirmação via WhatsApp</small></span></Link>
          <Link to={{ pathname: location.pathname, search: location.search, hash: userSettingsHash }} className={activeTab === 'users' ? 'active' : ''} aria-current={activeTab === 'users' ? 'page' : undefined}><Users size={17} /><span>Gestão de usuários<small>Acessos e papéis</small></span></Link>
        </aside>

        {activeTab === 'gifts' ? <section className="settings-card">
          <div className="settings-card-header"><span><Gift size={20} /></span><div><h2>Lista de presentes</h2><p>Defina como os convidados confirmam a escolha de um presente.</p></div></div>

          {loading ? <div className="list-state"><span className="spinner spinner--wine" />Carregando configurações...</div> : <form className="settings-form" onSubmit={handleSubmit}>
            <div className="setting-switch-row">
              <div><strong>Confirmação de presente</strong><p>Exibe no frontend a ação para o convidado confirmar o presente pelo WhatsApp.</p></div>
              <label className="toggle-control">
                <input type="checkbox" checked={settings.enableGiftConfirmation} onChange={(event) => setSettings({ ...settings, enableGiftConfirmation: event.target.checked })} />
                <span aria-hidden="true" />
                <small>{settings.enableGiftConfirmation ? 'Ativada' : 'Desativada'}</small>
              </label>
            </div>

            <div className="setting-field">
              <label htmlFor="whatsapp-number">Número do WhatsApp</label>
              <div className="setting-input"><MessageCircle size={17} /><input id="whatsapp-number" type="tel" value={settings.whatsappNumber} onChange={(event) => setSettings({ ...settings, whatsappNumber: event.target.value })} placeholder="+55 62 99999-9999" disabled={!settings.enableGiftConfirmation} /></div>
              <small>Inclua o código do país e o DDD. Exemplo: +55 62 99999-9999.</small>
            </div>

            <div className="setting-field">
              <div className="setting-label-row"><label htmlFor="message-template">Mensagem de confirmação</label><span>{settings.confirmationMessageTemplate.length} caracteres</span></div>
              <div className="message-editor">
                <div className="message-toolbar" role="toolbar" aria-label="Formatação da mensagem">
                  {whatsappFormats.map(({ label, prefix, suffix, icon: Icon }) => <button key={label} type="button" title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWhatsappFormat(prefix, suffix)}><Icon size={16} /></button>)}
                  <span aria-hidden="true" />
                  <button className="test-whatsapp-button" type="button" onClick={testOnWhatsapp}><ExternalLink size={15} />Testar no WhatsApp</button>
                </div>
                <textarea ref={messageTextareaRef} id="message-template" rows={5} value={settings.confirmationMessageTemplate} onChange={(event) => setSettings({ ...settings, confirmationMessageTemplate: event.target.value })} required />
              </div>
              <div className={`placeholder-hint ${hasItemPlaceholder ? 'valid' : 'invalid'}`}>{hasItemPlaceholder ? <Check size={13} /> : <X size={13} />}Use <code>{'{item}'}</code> no ponto onde o nome do presente deve aparecer.</div>
            </div>

            <div className="message-preview">
              <div className="preview-title"><MessageCircle size={15} /><span>Prévia da mensagem</span></div>
              <div className="message-bubble"><div>{preview ? renderWhatsappText(preview) : 'A mensagem será exibida aqui.'}</div><span>15:42 <Check size={11} /></span></div>
            </div>

            <div className="settings-info"><Info size={16} /><p>O frontend poderá ler este documento e substituir <code>{'{item}'}</code> pelo título do presente selecionado antes de abrir o WhatsApp.</p></div>
            {error && <p className="form-message form-message--error" role="alert">{error}</p>}
            {saved && <p className="form-message form-message--success" role="status"><Check size={14} />Configurações salvas com sucesso.</p>}

            <div className="settings-footer"><span><SettingsIcon size={14} />Documento: settings/gifts</span><button className="compact-primary" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : <><Save size={15} />Salvar configurações</>}</button></div>
          </form>}
        </section> : <UserManagement />}
      </div>
    </main>
  )
}
