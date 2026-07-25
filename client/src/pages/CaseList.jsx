import { useState, useDeferredValue } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, SlidersHorizontal } from 'lucide-react'
import { getCases, getFilters } from '../api'
import CaseCard from '../components/CaseCard'
import CaseModal from '../components/CaseModal'
import styles from './CaseList.module.css'

const OUTCOMES = ['Pass', 'Fail', 'Pending']

export default function CaseList() {
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('')
  const [caseType, setCaseType] = useState('')
  const [outcome, setOutcome] = useState('')
  const [selected, setSelected] = useState(null)

  const dSearch = useDeferredValue(search)

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['cases', dSearch, industry, caseType, outcome],
    queryFn: () => getCases({ search: dSearch || undefined, industry: industry || undefined, case_type: caseType || undefined, outcome: outcome || undefined }),
  })

  const { data: filters = { industries: [], case_types: [] } } = useQuery({
    queryKey: ['filters'],
    queryFn: getFilters,
  })

  const pass = cases.filter(c => c.outcome === 'Pass').length
  const fail = cases.filter(c => c.outcome === 'Fail').length

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Case Library</h1>
          <p className={styles.sub}>Your consulting interview experiences</p>
        </div>
        {cases.length > 0 && (
          <div className={styles.statsRow}>
            <Stat label="Total" value={cases.length} />
            <Stat label="Pass" value={pass} color="var(--pass)" />
            <Stat label="Fail" value={fail} color="var(--fail)" />
          </div>
        )}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.search}
            placeholder="Search firm, problem, insights…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.filters}>
          <SlidersHorizontal size={14} color="var(--text-dim)" />
          <Select value={industry} onChange={setIndustry} placeholder="Industry" options={filters.industries} />
          <Select value={caseType} onChange={setCaseType} placeholder="Type" options={filters.case_types} />
          <Select value={outcome} onChange={setOutcome} placeholder="Outcome" options={OUTCOMES} />
        </div>
      </div>

      {isLoading ? (
        <div className={styles.loading}>Loading…</div>
      ) : cases.length === 0 ? (
        <Empty hasFilters={!!(search || industry || caseType || outcome)} />
      ) : (
        <div className={styles.grid}>
          {cases.map(c => (
            <CaseCard key={c.id} c={c} onClick={() => setSelected(c)} />
          ))}
        </div>
      )}

      {selected && <CaseModal c={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue} style={color ? { color } : {}}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

function Select({ value, onChange, placeholder, options }) {
  return (
    <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Empty({ hasFilters }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>📂</div>
      <p>{hasFilters ? 'No cases match your filters.' : 'No cases yet.'}</p>
      {!hasFilters && <a href="/add" className={styles.emptyLink}>Add your first case →</a>}
    </div>
  )
}
