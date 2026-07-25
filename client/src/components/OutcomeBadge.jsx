const config = {
  Pass:    { color: 'var(--pass)',    bg: 'var(--pass-bg)' },
  Fail:    { color: 'var(--fail)',    bg: 'var(--fail-bg)' },
  Pending: { color: 'var(--pending)', bg: 'var(--pending-bg)' },
}

export default function OutcomeBadge({ outcome }) {
  const c = config[outcome]
  if (!c) return null
  return (
    <span style={{
      color: c.color, background: c.bg,
      fontSize: '0.68rem', fontWeight: 700, padding: '0.2rem 0.55rem',
      borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.6px',
    }}>
      {outcome}
    </span>
  )
}
