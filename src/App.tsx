import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { auth, isFirebaseConfigured } from './lib/firebase'
import { installAutomaticTracking, trackPageView } from './lib/analytics'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { CompleteProfile } from './pages/CompleteProfile'
import { getUserProfile, type UserProfile } from './lib/userProfile'
import './App.css'

function App() {
  const location = useLocation()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(auth))
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState(false)

  useEffect(() => {
    installAutomaticTracking()
  }, [])

  useEffect(() => {
    trackPageView(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    if (!auth) {
      return
    }

    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setProfile(null)
      setProfileError(false)
      setProfileLoading(Boolean(currentUser))
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!user) return

    let active = true
    getUserProfile(user.uid)
      .then((storedProfile) => {
        if (active) setProfile(storedProfile)
      })
      .catch((error) => {
        console.error(error)
        if (active) setProfileError(true)
      })
      .finally(() => {
        if (active) setProfileLoading(false)
      })

    return () => { active = false }
  }, [user])

  if (loading || profileLoading) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="brand-mark brand-mark--loading">S</div>
        <span>Preparando seu espaço...</span>
      </main>
    )
  }

  if (!isFirebaseConfigured) {
    return (
      <main className="setup-page">
        <div className="brand-mark">S</div>
        <p className="eyebrow">Configuração inicial</p>
        <h1>Conecte seu Firebase</h1>
        <p>Crie o arquivo <code>.env</code> a partir do <code>.env.example</code>, preencha as credenciais do aplicativo Web e reinicie o servidor.</p>
        <div className="setup-command">copy .env.example .env</div>
        <small>As instruções completas estão no README.md.</small>
      </main>
    )
  }

  if (user) {
    if (profileError) {
      return <main className="loading-screen"><strong>Não foi possível carregar seu perfil.</strong><button className="profile-retry" onClick={() => window.location.reload()}>Tentar novamente</button></main>
    }

    if (!profile) {
      return <CompleteProfile user={user} onComplete={setProfile} />
    }

    return (
      <Routes>
        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
        <Route path="/*" element={<Dashboard profile={profile} email={user.email ?? ''} />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<LoginRedirect />} />
    </Routes>
  )
}

function LoginRedirect() {
  const location = useLocation()
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
}

export default App
