import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Pencil, Trash2, Calendar, Building2, Layers, BarChart3 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteCase } from '../api'
import OutcomeBadge from './OutcomeBadge'
import styles from './CaseModal.module.css'

function fmt(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Section({ label, value }) {
  if (!value) return null
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>{label}</div>
      <div className={styles.sectionValue}>{value}</div>
    </div>
  )
}

function MetaItem({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className={styles.metaItem}>
      <Icon size={13} color="var(--accent)" />
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  )
}

export default function CaseModal({ c, onClose }) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const del = useMutation({
    mutationFn: () => deleteCase(c.id),
    onSuccess: () => { qc.invalidateQueries(['cases']); onClose() },
  })

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleDelete = () => {
    if (window.confirm('Delete this case?')) del.mutate()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.title}>{c.firm}</h2>
            {c.round && <span className={styles.round}>{c.round}</span>}
            <OutcomeBadge outcome={c.outcome} />
          </div>
          <div className={styles.headerActions}>
            <button className={styles.actionBtn} onClick={() => navigate(`/edit/${c.id}`)}>
              <Pencil size={15} /> Edit
            </button>
            <button className={`${styles.actionBtn} ${styles.danger}`} onClick={handleDelete}>
              <Trash2 size={15} /> Delete
            </button>
            <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className={styles.meta}>
          <MetaItem icon={BarChart3} label="Type" value={c.case_type} />
          <MetaItem icon={Building2} label="Industry" value={c.industry} />
          <MetaItem icon={Calendar} label="Date" value={fmt(c.date)} />
          <MetaItem icon={Layers} label="Round" value={c.round} />
        </div>

        <div className={styles.body}>
          <Section label="Problem Statement" value={c.problem_statement} />
          <Section label="My Approach / Framework" value={c.my_approach} />
          <Section label="Key Insights & Recommendations" value={c.key_insights} />
          <Section label="Notes / Feedback" value={c.notes} />
        </div>
      </div>
    </div>
  )
}
