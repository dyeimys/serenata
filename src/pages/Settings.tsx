import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { Check, Gift, Info, MessageCircle, Save, Settings as SettingsIcon, X } from 'lucide-react'
import { db } from '../lib/firestore'

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

export function Settings() {
  const [settings, setSettings] = useState<GiftSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

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

  const preview = useMemo(() => settings.confirmationMessageTemplate.replaceAll('{item}', 'Soprador de folhas'), [settings.confirmationMessageTemplate])
  const hasItemPlaceholder = settings.confirmationMessageTemplate.includes('{item}')

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
      await setDoc(doc(db, 'settings', 'gifts'), {
        enableGiftConfirmation: settings.enableGiftConfirmation,
        whatsappNumber: settings.whatsappNumber.trim(),
        confirmationMessageTemplate: settings.confirmationMessageTemplate.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true })
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
          <button className="active"><Gift size={17} /><span>Lista de presentes<small>Confirmação via WhatsApp</small></span></button>
        </aside>

        <section className="settings-card">
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
              <textarea id="message-template" rows={5} value={settings.confirmationMessageTemplate} onChange={(event) => setSettings({ ...settings, confirmationMessageTemplate: event.target.value })} required />
              <div className={`placeholder-hint ${hasItemPlaceholder ? 'valid' : 'invalid'}`}>{hasItemPlaceholder ? <Check size={13} /> : <X size={13} />}Use <code>{'{item}'}</code> no ponto onde o nome do presente deve aparecer.</div>
            </div>

            <div className="message-preview">
              <div className="preview-title"><MessageCircle size={15} /><span>Prévia da mensagem</span></div>
              <div className="message-bubble">{preview || 'A mensagem será exibida aqui.'}<span>15:42 <Check size={11} /></span></div>
            </div>

            <div className="settings-info"><Info size={16} /><p>O frontend poderá ler este documento e substituir <code>{'{item}'}</code> pelo título do presente selecionado antes de abrir o WhatsApp.</p></div>
            {error && <p className="form-message form-message--error" role="alert">{error}</p>}
            {saved && <p className="form-message form-message--success" role="status"><Check size={14} />Configurações salvas com sucesso.</p>}

            <div className="settings-footer"><span><SettingsIcon size={14} />Documento: settings/gifts</span><button className="compact-primary" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : <><Save size={15} />Salvar configurações</>}</button></div>
          </form>}
        </section>
      </div>
    </main>
  )
}
