import { useState, useDeferredValue } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, SlidersHorizontal, Hash, CheckCircle2, ThumbsUp, ThumbsDown } from 'lucide-react'
import { getCasebookCases, getCasebookFilters, getProgress } from '../api'
import { useAuth } from '../context/AuthContext'
import styles from './CasebookList.module.css'

const DIFFICULTIES = ['Easy', 'Moderate', 'Hard']

export default function CasebookList() {
  const [search, setSearch]     = useState('')
  const [caseType, setCaseType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [firm, setFirm]           = useState('')
  const [numerical, setNumerical] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const dSearch = useDeferredValue(search)

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['casebook', dSearch, caseType, difficulty, firm, numerical],
    queryFn: () => getCasebookCases({
      search: dSearch || undefined,
      case_type: caseType || undefined,
      difficulty: difficulty || undefined,
      firm: firm || undefined,
      is_numerical: numerical || undefined,
    }),
  })

  const { data: filters = { case_types: [], difficulties: [], firms: [] } } = useQuery({
    queryKey: ['casebook-filters'],
    queryFn: getCasebookFilters,
  })

  const { data: allProgress = [] } = useQuery({
    queryKey: ['progress'],
    queryFn: getProgress,
    enabled: !isAdmin,
  })

  const progressMap = Object.fromEntries(allProgress.map(p => [p.case_id, p]))

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Casebook</h1>
          <p className={styles.sub}>ICON IIM Bangalore 2025–26</p>
        </div>
        {cases.length > 0 && (
          <div className={styles.count}>{cases.length} cases</div>
        )}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.search}
            placeholder="Search title, firm, statement…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.filters}>
          <SlidersHorizontal size={14} color="var(--text-dim)" />
          <Select value={caseType}   onChange={setCaseType}   placeholder="Type"       options={filters.case_types} />
          <Select value={difficulty} onChange={setDifficulty} placeholder="Difficulty" options={DIFFICULTIES} />
          <Select value={firm}       onChange={setFirm}       placeholder="Firm"       options={filters.firms} />
          <select className={styles.select} value={numerical} onChange={e => setNumerical(e.target.value)}>
            <option value="">All</option>
            <option value="1">Numerical</option>
            <option value="0">Non-numerical</option>
          </select>
          {!isAdmin && (
            <select className={styles.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All status</option>
              <option value="done">Done</option>
              <option value="pending">Pending</option>
            </select>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className={styles.loading}>Loading…</div>
      ) : cases.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📚</div>
          <p>No cases match your filters.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {cases.filter(c => {
            if (!statusFilter) return true
            const p = progressMap[c.case_id]
            if (statusFilter === 'done') return p?.status === 'done'
            if (statusFilter === 'pending') return p?.status !== 'done'
            return true
          }).map(c => (
            <CasebookCard key={c.case_id} c={c} progress={progressMap[c.case_id]} onClick={() => navigate(`/casebook/${c.case_id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}

function CasebookCard({ c, progress, onClick }) {
  const isDone = progress?.status === 'done'
  const reaction = progress?.reaction
  return (
    <div className={`${styles.card} ${isDone ? styles.cardDone : ''}`} onClick={onClick}>
      <div className={styles.cardTop}>
        <span className={styles.firm}>{c.firm}</span>
        <div className={styles.cardTopRight}>
          {isDone && <CheckCircle2 size={14} className={styles.doneIcon} />}
          {reaction === 'like' && <ThumbsUp size={13} className={styles.likeIcon} />}
          {reaction === 'dislike' && <ThumbsDown size={13} className={styles.dislikeIcon} />}
          <DifficultyBadge d={c.difficulty} />
        </div>
      </div>
      <h3 className={styles.cardTitle}>{c.case_title}</h3>
      <div className={styles.cardTags}>
        {c.case_type && <span className={styles.tag}>{c.case_type}</span>}
        {c.is_numerical ? <span className={`${styles.tag} ${styles.tagNum}`}><Hash size={10} />Numerical</span> : null}
      </div>
      {c.case_statement && (
        <p className={styles.statement}>{c.case_statement}</p>
      )}
    </div>
  )
}

function DifficultyBadge({ d }) {
  if (!d) return null
  const cls = d === 'Easy' ? styles.easy : d === 'Hard' ? styles.hard : styles.moderate
  return <span className={`${styles.badge} ${cls}`}>{d}</span>
}

function Select({ value, onChange, placeholder, options }) {
  return (
    <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
