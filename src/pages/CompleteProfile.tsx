import { useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { signOut } from 'firebase/auth'
import { LogOut, Phone, UserRound } from 'lucide-react'
import { auth } from '../lib/firebase'
import { saveUserProfile, type UserProfile } from '../lib/userProfile'

type CompleteProfileProps = {
  user: User
  onComplete: (profile: UserProfile) => void
}

const roles = ['Noivo', 'Noiva', 'Cerimonialista', 'Assessor(a)', 'Familiar', 'Outro']

export function CompleteProfile({ user, onComplete }: CompleteProfileProps) {
  const [name, setName] = useState(user.displayName ?? '')
  const [role, setRole] = useState('')
  const [customRole, setCustomRole] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const selectedRole = role === 'Outro' ? customRole.trim() : role
    const phoneDigits = phone.replace(/\D/g, '')

    if (!name.trim() || !selectedRole || phoneDigits.length < 10 || phoneDigits.length > 11) {
      setError('Preencha o nome, o papel no sistema e um telefone com DDD.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const profile = await saveUserProfile(user.uid, { name, role: selectedRole, phone })
      onComplete(profile)
    } catch (saveError) {
      console.error(saveError)
      setError('Não foi possível salvar suas informações. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="profile-page">
      <section className="profile-card">
        <div className="brand-mark">S</div>
        <p className="eyebrow">Primeiro acesso</p>
        <h1>Conte um pouco sobre você</h1>
        <p className="profile-intro">Essas informações identificam você na área de gestão.</p>

        <form className="profile-form" onSubmit={handleSubmit}>
          <label htmlFor="profile-name">Nome completo</label>
          <div className="profile-field"><UserRound size={17} /><input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Seu nome" required /></div>

          <label htmlFor="profile-role">Papel no sistema</label>
          <select id="profile-role" value={role} onChange={(event) => setRole(event.target.value)} required>
            <option value="">Selecione uma opção</option>
            {roles.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>

          {role === 'Outro' && <><label htmlFor="profile-custom-role">Qual é o seu papel?</label><input className="profile-input" id="profile-custom-role" value={customRole} onChange={(event) => setCustomRole(event.target.value)} placeholder="Ex.: Madrinha" required /></>}

          <label htmlFor="profile-phone">Telefone</label>
          <div className="profile-field"><Phone size={17} /><input id="profile-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="(00) 00000-0000" required /></div>

          {error && <p className="profile-error" role="alert">{error}</p>}
          <button className="profile-submit" type="submit" disabled={saving}>{saving ? <><span className="spinner" />Salvando...</> : 'Continuar'}</button>
        </form>

        <button className="profile-logout" type="button" onClick={() => auth && signOut(auth)}><LogOut size={15} />Sair da conta</button>
      </section>
    </main>
  )
}
