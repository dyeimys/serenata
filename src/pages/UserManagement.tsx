import { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { Check, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react'
import { listAuthenticationUsers, updateAuthenticationUserRole, type ManagedUser } from '../lib/adminUsers'

const roleOptions = ['Noivo', 'Noiva', 'Cerimonialista', 'Assessor(a)', 'Familiar', 'Convidado']

export function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState('')

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      const response = await listAuthenticationUsers()
      setUsers(response.users)
      setCurrentUserId(response.currentUserId)
      setCanManage(response.canManage)
    } catch (caught) {
      console.error('Erro ao carregar usuários:', caught)
      const code = caught instanceof FirebaseError ? caught.code : ''
      setError(code.includes('permission-denied')
        ? 'Seu papel não permite visualizar ou gerenciar os usuários.'
        : 'Não foi possível buscar os usuários do Firebase Authentication.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    listAuthenticationUsers()
      .then((response) => {
        if (!active) return
        setUsers(response.users)
        setCurrentUserId(response.currentUserId)
        setCanManage(response.canManage)
      })
      .catch((caught) => {
        console.error('Erro ao carregar usuários:', caught)
        if (!active) return
        const code = caught instanceof FirebaseError ? caught.code : ''
        setError(code.includes('permission-denied')
          ? 'Seu papel não permite visualizar ou gerenciar os usuários.'
          : 'Não foi possível buscar os usuários do Firebase Authentication.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return users
    return users.filter((user) => [user.name, user.email, user.phone, user.role].some((value) => value?.toLocaleLowerCase('pt-BR').includes(term)))
  }, [search, users])

  async function changeRole(user: ManagedUser, role: string) {
    if (!role || role === user.role) return
    setUpdatingId(user.id)
    setSavedId('')
    setError('')
    try {
      await updateAuthenticationUserRole(user.id, role)
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, role } : item))
      setSavedId(user.id)
    } catch (caught) {
      console.error('Erro ao alterar papel:', caught)
      setError('Não foi possível alterar o papel deste usuário.')
    } finally {
      setUpdatingId('')
    }
  }

  return (
    <section className="settings-card user-management-card">
      <div className="settings-card-header"><span><Users size={20} /></span><div><h2>Gestão de usuários</h2><p>Contas do Firebase Authentication e seus dados de perfil.</p></div></div>

      <div className="user-management-body">
        <div className="user-toolbar">
          <label className="user-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, e-mail ou papel" /></label>
          <button type="button" onClick={() => void loadUsers()} disabled={loading}><RefreshCw size={14} />Atualizar</button>
        </div>

        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        {loading ? <div className="list-state"><span className="spinner spinner--wine" />Buscando usuários...</div> : (
          <>
            <div className="user-summary"><ShieldCheck size={15} /><span>{users.length} {users.length === 1 ? 'conta encontrada' : 'contas encontradas'} no Authentication</span></div>
            <div className="user-table-wrap">
              <table className="user-table">
                <thead><tr><th>Usuário</th><th>Status</th><th>Telefone</th><th>Último acesso</th><th>Papel</th></tr></thead>
                <tbody>{filteredUsers.map((user) => {
                  const isCurrentUser = user.id === currentUserId
                  const canEdit = canManage && user.hasProfile && !isCurrentUser
                  return <tr key={user.id} className={!user.hasProfile ? 'user-row--incomplete' : undefined}>
                    <td data-label="Usuário"><div className="user-list-avatar">{(user.name || user.email || '?').charAt(0).toUpperCase()}</div><div><strong>{user.name || 'Perfil não preenchido'}</strong><small>{user.email || 'Sem e-mail'}{isCurrentUser ? ' · Você' : ''}</small></div></td>
                    <td data-label="Status"><div className="user-status-stack"><span className={`auth-status ${user.disabled ? 'auth-status--disabled' : 'auth-status--active'}`}>{user.disabled ? 'Desativado' : 'Ativo'}</span><small className="verification-status">{user.emailVerified ? 'E-mail verificado' : 'Não verificado'}</small></div></td>
                    <td data-label="Telefone">{user.phone || 'Não informado'}</td>
                    <td data-label="Último acesso">{formatDate(user.lastSignInAt)}</td>
                    <td data-label="Papel"><div className="role-control"><select value={user.role ?? ''} onChange={(event) => void changeRole(user, event.target.value)} disabled={!canEdit || updatingId === user.id} title={!user.hasProfile ? 'O usuário ainda não preencheu o perfil' : isCurrentUser ? 'Você não pode alterar o próprio papel' : undefined}><option value="">Não informado</option>{roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}{user.role && !roleOptions.includes(user.role) && <option value={user.role}>{user.role}</option>}</select>{updatingId === user.id && <span className="spinner spinner--wine" />}{savedId === user.id && updatingId !== user.id && <Check className="role-saved" size={14} />}</div></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
            {!filteredUsers.length && <div className="list-state">Nenhum usuário corresponde à busca.</div>}
          </>
        )}
      </div>
    </section>
  )
}

function formatDate(value: string | null) {
  if (!value) return 'Nunca acessou'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}
