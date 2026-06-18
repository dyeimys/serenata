import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { auth, isFirebaseConfigured } from './lib/firebase'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import './App.css'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(auth))

  useEffect(() => {
    if (!auth) {
      return
    }

    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })
  }, [])

  if (loading) {
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
    return (
      <Routes>
        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
        <Route path="/*" element={<Dashboard user={user} />} />
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
