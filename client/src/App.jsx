import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import CaseList from './pages/CaseList'
import CaseForm from './pages/CaseForm'
import CasebookList from './pages/CasebookList'
import CasebookDetail from './pages/CasebookDetail'
import LoginPage from './pages/LoginPage'
import AdminUsers from './pages/AdminUsers'

function AppRoutes() {
  const { isLoggedIn, isAdmin } = useAuth()

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {isLoggedIn && <Navbar />}
      <Routes>
        <Route path="/login" element={isLoggedIn ? <Navigate to="/casebook" replace /> : <LoginPage />} />
        <Route path="/" element={isLoggedIn ? <CaseList /> : <Navigate to="/login" replace />} />
        <Route path="/casebook" element={isLoggedIn ? <CasebookList /> : <Navigate to="/login" replace />} />
        <Route path="/casebook/:id" element={isLoggedIn ? <CasebookDetail /> : <Navigate to="/login" replace />} />
        <Route path="/add" element={isAdmin ? <CaseForm /> : <Navigate to="/casebook" replace />} />
        <Route path="/casebook/:id/edit" element={isAdmin ? <CaseForm /> : <Navigate to="/casebook" replace />} />
        <Route path="/admin/users" element={isAdmin ? <AdminUsers /> : <Navigate to="/casebook" replace />} />
        <Route path="*" element={<Navigate to={isLoggedIn ? '/casebook' : '/login'} replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
