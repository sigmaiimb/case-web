import { createContext, useContext, useState, useCallback } from 'react'
import { jwtDecode } from 'jwt-decode'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const token = localStorage.getItem('cw_token')
      if (!token) return null
      const decoded = jwtDecode(token)
      if (decoded.exp * 1000 < Date.now()) { localStorage.removeItem('cw_token'); return null }
      return decoded
    } catch { return null }
  })

  const login = useCallback((token) => {
    localStorage.setItem('cw_token', token)
    setUser(jwtDecode(token))
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('cw_token')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout, isAdmin: user?.role === 'admin', isLoggedIn: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
