import OutcomeBadge from './OutcomeBadge'
import styles from './CaseCard.module.css'

function Tag({ children }) {
  if (!children) return null
  return <span className={styles.tag}>{children}</span>
}

function fmt(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function CaseCard({ c, onClick }) {
  return (
    <div className={styles.card} onClick={onClick}>
      <div className={styles.top}>
        <span className={styles.firm}>{c.firm}</span>
        <OutcomeBadge outcome={c.outcome} />
      </div>
      <div className={styles.tags}>
        <Tag>{c.case_type}</Tag>
        <Tag>{c.industry}</Tag>
        <Tag>{c.round}</Tag>
      </div>
      {c.problem_statement && (
        <p className={styles.problem}>{c.problem_statement}</p>
      )}
      <div className={styles.footer}>
        {c.date && <span className={styles.date}>{fmt(c.date)}</span>}
      </div>
    </div>
  )
}
