import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Trash2, Copy, Check, AlertCircle, CheckCircle2 } from 'lucide-react'
import { createUsers, getUsers, deleteUser } from '../api'
import styles from './AdminUsers.module.css'

export default function AdminUsers() {
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [results, setResults] = useState([])
  const [copied, setCopied] = useState(null)

  const { data: users = [] } = useQuery({ queryKey: ['admin-users'], queryFn: getUsers })

  const createMutation = useMutation({
    mutationFn: (emails) => createUsers(emails),
    onSuccess: (data) => {
      setResults(data.results)
      setInput('')
      qc.invalidateQueries(['admin-users'])
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries(['admin-users']),
  })

  const handleCreate = () => {
    const emails = input.split(/[\n,]/).map(e => e.trim()).filter(Boolean)
    if (!emails.length) return
    createMutation.mutate(emails)
  }

  const copyCredentials = (r) => {
    navigator.clipboard.writeText(`Email: ${r.email}\nPassword: ${r.password}`)
    setCopied(r.email)
    setTimeout(() => setCopied(null), 2000)
  }

  const copyAll = () => {
    const successful = results.filter(r => r.success)
    const text = successful.map(r => `${r.email}  |  ${r.password}`).join('\n')
    navigator.clipboard.writeText(text)
    setCopied('all')
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>User Access</h1>
          <p className={styles.sub}>Create student accounts for casebook access</p>
        </div>
        <span className={styles.count}><Users size={13} /> {users.length} students</span>
      </div>

      {/* Add emails */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Add accounts</h3>
        <p className={styles.hint}>Enter one or more <strong>@iimb.ac.in</strong> emails — separated by commas or new lines. Passwords are auto-generated.</p>
        <textarea
          className={styles.emailInput}
          rows={4}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={'ritwick@iimb.ac.in\naditya@iimb.ac.in, priya@iimb.ac.in'}
        />
        <div className={styles.addActions}>
          <button
            className={styles.btnPrimary}
            onClick={handleCreate}
            disabled={!input.trim() || createMutation.isPending}
          >
            <Plus size={14} />
            {createMutation.isPending ? 'Creating…' : 'Create accounts'}
          </button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className={styles.results}>
            <div className={styles.resultsHeader}>
              <span className={styles.resultsTitle}>Created credentials</span>
              {results.some(r => r.success) && (
                <button className={styles.copyAllBtn} onClick={copyAll}>
                  {copied === 'all' ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy all</>}
                </button>
              )}
            </div>
            {results.map((r) => (
              <div key={r.email} className={`${styles.resultRow} ${r.success ? styles.resultOk : styles.resultFail}`}>
                {r.success ? <CheckCircle2 size={14} className={styles.resultIcon} /> : <AlertCircle size={14} className={styles.resultIcon} />}
                <div className={styles.resultInfo}>
                  <span className={styles.resultEmail}>{r.email}</span>
                  {r.success
                    ? <span className={styles.resultPass}>{r.password}</span>
                    : <span className={styles.resultError}>{r.error}</span>
                  }
                </div>
                {r.success && (
                  <button className={styles.copyBtn} onClick={() => copyCredentials(r)}>
                    {copied === r.email ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Existing users */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Existing students</h3>
        {users.length === 0 ? (
          <p className={styles.empty}>No students added yet.</p>
        ) : (
          <div className={styles.userList}>
            {users.map(u => (
              <div key={u.id} className={styles.userRow}>
                <div className={styles.userInfo}>
                  <span className={styles.userName}>{u.name}</span>
                  <span className={styles.userEmail}>{u.email}</span>
                </div>
                <span className={styles.userDate}>{new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <button
                  className={styles.deleteBtn}
                  onClick={() => deleteMutation.mutate(u.id)}
                  title="Revoke access"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
