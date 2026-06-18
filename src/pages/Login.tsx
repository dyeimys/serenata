import { type FormEvent, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth'
import { Eye, EyeOff, Heart, LockKeyhole, Mail } from 'lucide-react'
import { auth } from '../lib/firebase'

const authMessages: Record<string, string> = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'Digite um e-mail válido.',
  'auth/missing-password': 'Digite sua senha.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
  'auth/user-disabled': 'Este acesso foi desativado. Fale com o administrador.',
}

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)

    try {
      if (!auth) throw new Error('Firebase não configurado')
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (caught) {
      const code = caught instanceof FirebaseError ? caught.code : ''
      setError(authMessages[code] ?? 'Não foi possível entrar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordReset() {
    setError('')
    setNotice('')
    if (!email.trim()) {
      setError('Informe seu e-mail para recuperar a senha.')
      return
    }

    try {
      if (!auth) throw new Error('Firebase não configurado')
      await sendPasswordResetEmail(auth, email.trim())
      setNotice('Enviamos as instruções de recuperação para seu e-mail.')
    } catch (caught) {
      const code = caught instanceof FirebaseError ? caught.code : ''
      setError(authMessages[code] ?? 'Não foi possível enviar o e-mail agora.')
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Boas-vindas">
        <div className="botanical botanical--top" />
        <div className="story-content">
          <div className="brand-lockup">
            <span className="brand-mark">S</span>
            <span className="brand-name">Serenata</span>
          </div>
          <p className="eyebrow">Gestão de casamentos</p>
          <h1>Organize cada detalhe.<br />Viva cada momento.</h1>
          <p className="story-copy">
            Um espaço delicado e completo para transformar planos em memórias inesquecíveis.
          </p>
          <div className="story-signature">
            <Heart size={16} strokeWidth={1.5} />
            <span>Onde cada detalhe conta uma história</span>
          </div>
        </div>
        <div className="botanical botanical--bottom" />
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-brand">
            <span className="brand-mark">S</span>
            <span className="brand-name">Serenata</span>
          </div>
          <p className="eyebrow">Bem-vindo de volta</p>
          <h2>Acesse sua conta</h2>
          <p className="login-intro">Entre para continuar cuidando de momentos únicos.</p>

          <form onSubmit={handleSubmit}>
            <label htmlFor="email">E-mail</label>
            <div className="input-wrap">
              <Mail size={18} aria-hidden="true" />
              <input id="email" type="email" autoComplete="email" placeholder="seu@email.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>

            <div className="label-row">
              <label htmlFor="password">Senha</label>
              <button className="text-button" type="button" onClick={handlePasswordReset}>Esqueci minha senha</button>
            </div>
            <div className="input-wrap">
              <LockKeyhole size={18} aria-hidden="true" />
              <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Sua senha" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error && <p className="form-message form-message--error" role="alert">{error}</p>}
            {notice && <p className="form-message form-message--success" role="status">{notice}</p>}

            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? <span className="spinner" aria-label="Entrando" /> : 'Entrar na plataforma'}
            </button>
          </form>

          <p className="login-help">Precisa de acesso? <a href="https://wa.me/5564993243584?text=Ol%C3%A1%21%20Gostaria%20de%20solicitar%20acesso%20ao%20sistema%20Serenata." target="_blank" rel="noreferrer">Fale com o administrador</a></p>
        </div>
        <p className="copyright">© 2026 Serenata. Feito com cuidado para o seu grande dia.</p>
      </section>
    </main>
  )
}
