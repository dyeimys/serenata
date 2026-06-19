import { lazy, type ReactNode, Suspense, useState } from 'react'
import { signOut } from 'firebase/auth'
import { Bell, CalendarDays, ChevronRight, Gift, Heart, LayoutDashboard, ListTodo, LogOut, Menu, Settings, Users, X } from 'lucide-react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { auth } from '../lib/firebase'
import type { UserProfile } from '../lib/userProfile'
import { AssistantWidget } from '../components/assistant/AssistantWidget'

const Guests = lazy(async () => {
  const module = await import('./Guests')
  return { default: module.Guests }
})
const Gifts = lazy(async () => {
  const module = await import('./Gifts')
  return { default: module.Gifts }
})
const SettingsPage = lazy(async () => {
  const module = await import('./Settings')
  return { default: module.Settings }
})
const Tasks = lazy(async () => {
  const module = await import('./Tasks')
  return { default: module.Tasks }
})
const Overview = lazy(async () => {
  const module = await import('./Overview')
  return { default: module.Overview }
})
type DashboardProps = { profile: UserProfile, email: string }

const menuItems = [
  { label: 'Visão geral', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Convidados', icon: Users, path: '/convidados' },
  { label: 'Lista de presentes', icon: Gift, path: '/presentes' },
  { label: 'Tarefas', icon: ListTodo, path: '/tarefas' },
  { label: 'Agenda', icon: CalendarDays, path: '/agenda', badge: 'Plano S+', disabled: true },
  { label: 'Configurações', icon: Settings, path: '/configuracoes' },
]

export function Dashboard({ profile, email }: DashboardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const firstName = profile.name.split(/\s+/)[0]
  const initials = profile.name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase()

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-brand"><span className="brand-mark">S</span><span className="brand-name">Serenata</span></div>
        <button className="close-menu" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={22} /></button>
        <nav aria-label="Menu principal">
          <p className="nav-label">Seu casamento</p>
          {menuItems.map(({ label, icon: Icon, path, badge, disabled }) => disabled ? (
            <button key={path} className="nav-item nav-item--disabled" disabled title="Disponível em breve"><Icon size={19} /><span>{label}</span>{badge && <small className="nav-plan-badge">{badge}</small>}</button>
          ) : (
            <NavLink key={path} to={path} className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`} onClick={() => setMenuOpen(false)}>
              {({ isActive }) => <><Icon size={19} /><span>{label}</span>{badge && <small className="nav-plan-badge">{badge}</small>}{isActive && <ChevronRight size={16} />}</>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-event"><Heart size={20} /><span>Seu grande dia</span><strong>Começa por aqui</strong></div>
        <button className="logout-button" onClick={() => auth && signOut(auth)}><LogOut size={18} />Sair da conta</button>
      </aside>
      {menuOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}

      <div className="app-content">
        <header className="app-header">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={23} /></button>
          <div><p className="header-kicker">Área de gestão <span className="header-role-tag">{profile.role}</span></p><strong>Olá, {firstName}</strong></div>
          <div className="header-actions">
            <button aria-label="Notificações"><Bell size={20} /></button>
            <div className="avatar" title={profile.name} aria-label={`Avatar de ${profile.name}`}>{initials}</div>
            <div className="header-identity">
              <strong>{profile.name}</strong>
              <span>{profile.role}</span>
              {email && <small>{email}</small>}
            </div>
          </div>
        </header>
        <Routes>
          <Route path="/dashboard" element={<LazyPage><Overview /></LazyPage>} />
          <Route path="/convidados" element={<LazyPage><Guests /></LazyPage>} />
          <Route path="/presentes" element={<LazyPage><Gifts /></LazyPage>} />
          <Route path="/tarefas" element={<LazyPage><Tasks /></LazyPage>} />
          <Route path="/configuracoes" element={<LazyPage><SettingsPage /></LazyPage>} />
          <Route path="/agenda" element={<Navigate to="/dashboard" replace />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
      <AssistantWidget />
    </div>
  )
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>
}

function PageLoading() {
  return <main className="dashboard-content"><div className="list-state"><span className="spinner spinner--wine" />Preparando página...</div></main>
}
