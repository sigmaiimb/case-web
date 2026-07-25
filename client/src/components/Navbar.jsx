import { NavLink, useNavigate } from 'react-router-dom'
import { BookOpen, Plus, Library, LogOut, User, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import styles from './Navbar.module.css'

export default function Navbar() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <nav className={styles.nav}>
      <div className={styles.brand}>
        <BookOpen size={18} color="var(--accent)" />
        CaseWeb
      </div>
      <div className={styles.links}>
        {isAdmin && (
          <NavLink to="/" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link} end>
            My Cases
          </NavLink>
        )}
        <NavLink to="/casebook" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>
          <Library size={14} /> Casebook
        </NavLink>
        {isAdmin && (
          <NavLink to="/admin/users" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>
            <Users size={14} /> Users
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/add" className={({ isActive }) => isActive ? `${styles.linkBtn} ${styles.linkBtnActive}` : styles.linkBtn}>
            <Plus size={15} /> Add Case
          </NavLink>
        )}
      </div>
      <div className={styles.userArea}>
        <span className={styles.userInfo}>
          <User size={13} />
          {user?.name || user?.email}
          {isAdmin && <span className={styles.adminBadge}>Admin</span>}
        </span>
        <button className={styles.logoutBtn} onClick={handleLogout} title="Sign out">
          <LogOut size={14} />
        </button>
      </div>
    </nav>
  )
}
