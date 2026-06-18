import { lazy, Suspense, useState } from 'react'
import type { User } from 'firebase/auth'
import { signOut } from 'firebase/auth'
import { Bell, CalendarDays, ChevronRight, Gift, Heart, LayoutDashboard, LogOut, Menu, Settings, Users, X } from 'lucide-react'
import { auth } from '../lib/firebase'

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

type DashboardProps = { user: User }

type View = 'overview' | 'guests' | 'gifts' | 'settings'

const menuItems = [
  { label: 'Visão geral', icon: LayoutDashboard, view: 'overview' as View },
  { label: 'Convidados', icon: Users, view: 'guests' as View },
  { label: 'Lista de presentes', icon: Gift, view: 'gifts' as View },
  { label: 'Agenda', icon: CalendarDays, badge: 'Plano S+' },
  { label: 'Configurações', icon: Settings, view: 'settings' as View },
]

export function Dashboard({ user }: DashboardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [view, setView] = useState<View>('overview')
  const firstName = user.displayName?.split(' ')[0] || 'Organizador'
  const initial = firstName.charAt(0).toUpperCase()

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-brand"><span className="brand-mark">S</span><span className="brand-name">Serenata</span></div>
        <button className="close-menu" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={22} /></button>
        <nav aria-label="Menu principal">
          <p className="nav-label">Seu casamento</p>
          {menuItems.map(({ label, icon: Icon, view: itemView, badge }) => (
            <button key={label} className={`nav-item ${itemView === view ? 'nav-item--active' : ''}`} onClick={() => { if (itemView) setView(itemView); setMenuOpen(false) }}><Icon size={19} /><span>{label}</span>{badge && <small className="nav-plan-badge">{badge}</small>}{itemView === view && <ChevronRight size={16} />}</button>
          ))}
        </nav>
        <div className="sidebar-event"><Heart size={20} /><span>Seu grande dia</span><strong>Começa por aqui</strong></div>
        <button className="logout-button" onClick={() => auth && signOut(auth)}><LogOut size={18} />Sair da conta</button>
      </aside>
      {menuOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}

      <div className="app-content">
        <header className="app-header">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={23} /></button>
          <div><p className="header-kicker">Área de gestão</p><strong>Olá, {firstName}</strong></div>
          <div className="header-actions"><button aria-label="Notificações"><Bell size={20} /></button><div className="avatar">{initial}</div><span>{user.email}</span></div>
        </header>
        {view === 'guests' ? <Suspense fallback={<PageLoading />}><Guests /></Suspense> : view === 'gifts' ? <Suspense fallback={<PageLoading />}><Gifts /></Suspense> : view === 'settings' ? <Suspense fallback={<PageLoading />}><SettingsPage /></Suspense> : <main className="dashboard-content">
          <div className="dashboard-title"><div><p className="eyebrow">Visão geral</p><h1>Seu casamento, em harmonia.</h1></div><span className="today"><CalendarDays size={17} /> Planejamento em andamento</span></div>
          <section className="welcome-card">
            <div><p className="eyebrow">Bem-vindo à Serenata</p><h2>Tudo pronto para começar a planejar.</h2><p>Este é o seu novo espaço de gestão. Em breve, convidados, fornecedores, orçamento e cronograma estarão reunidos aqui.</p></div>
            <div className="welcome-monogram">S</div>
          </section>
          <section className="metric-grid" aria-label="Resumo do casamento">
            <article><span className="metric-icon"><Users size={21} /></span><p>Convidados</p><strong>0</strong><small>Cadastre sua primeira lista</small></article>
            <article><span className="metric-icon"><CalendarDays size={21} /></span><p>Compromissos</p><strong>0</strong><small>Nenhum evento agendado</small></article>
            <article><span className="metric-icon"><Heart size={21} /></span><p>Progresso geral</p><strong>0%</strong><small>Uma linda jornada começa</small></article>
          </section>
        </main>}
      </div>
    </div>
  )
}

function PageLoading() {
  return <main className="dashboard-content"><div className="list-state"><span className="spinner spinner--wine" />Preparando página...</div></main>
}
