import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, Trash2, GripVertical, Upload, X } from 'lucide-react'
import { getCasebookCase, createCasebookCase, updateCasebookCase, uploadDiagram, deleteDiagram } from '../api'
import styles from './CaseForm.module.css'

const DIFFICULTIES = ['Easy', 'Moderate', 'Hard']
const CASE_TYPES   = ['Unconventional', 'Profitability', 'Market Entry', 'M&A / Due Diligence', 'Market Sizing', 'Growth Strategy', 'Cost Reduction', 'Pricing', 'Operations', 'PE / Investment', 'Other']

export default function CaseForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = Boolean(id)

  // Basic info
  const [title, setTitle]       = useState('')
  const [firm, setFirm]         = useState('')
  const [difficulty, setDiff]   = useState('')
  const [caseType, setCaseType] = useState('')
  const [isNum, setIsNum]     = useState(false)
  const [statement, setStatement] = useState('')

  // Conversation
  const [dialogue, setDialogue] = useState([{ speaker: 'interviewer', text: '' }])
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [parseError, setParseError] = useState('')

  // Solution notes
  const [caseFacts, setCaseFacts]   = useState('')
  const [addInfo, setAddInfo]       = useState('')
  const [recommendations, setRecs]  = useState('')
  const [tips, setTips]             = useState('')

  // Diagram
  const [diagrams, setDiagrams]         = useState([])   // existing saved diagrams
  const [pendingFile, setPendingFile]   = useState(null) // file to upload on save
  const [previewUrl, setPreviewUrl]     = useState(null)
  const fileRef = useRef()

  const { data: existing } = useQuery({
    queryKey: ['casebook-case', id],
    queryFn: () => getCasebookCase(id),
    enabled: isEdit,
  })

  useEffect(() => {
    if (!existing) return
    setTitle(existing.case_title || '')
    setFirm(existing.firm || '')
    setDiff(existing.difficulty || '')
    setCaseType(existing.case_type || '')
    setIsNum(Boolean(existing.is_numerical))
    setStatement(existing.case_statement || '')
    setDialogue(existing.dialogue?.length
      ? existing.dialogue.map(d => ({ speaker: d.speaker, text: d.dialogue_text }))
      : [{ speaker: 'interviewer', text: '' }])
    const byCategory = (cat) => {
      const items = (existing.notes || []).filter(n => n.note_category === cat).sort((a,b) => a.sort_order - b.sort_order).map(n => n.note_text)
      return items.length ? items : ['']
    }
    const mdCategory = (cat) => {
      const items = (existing.notes || []).filter(n => n.note_category === cat).sort((a,b) => a.sort_order - b.sort_order).map(n => n.note_text)
      return items.join('\n')
    }
    setCaseFacts(mdCategory('case_facts'))
    setAddInfo(mdCategory('additional_info'))
    setRecs(mdCategory('recommendations'))
    setTips(mdCategory('tips_tricks'))
    setDiagrams(existing.diagrams || [])
  }, [existing])

  const parseConversation = () => {
    setParseError('')
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) { setParseError('Nothing to parse.'); return }

    const INTERVIEWER = /^(interviewer|interviewee\s*question|i\/er|q)\s*[:\-–]/i
    const INTERVIEWEE = /^(interviewee|candidate|i\/ee|a)\s*[:\-–]/i

    // Check if any line has explicit labels
    const hasLabels = lines.some(l => INTERVIEWER.test(l) || INTERVIEWEE.test(l))

    let turns = []

    if (hasLabels) {
      let current = null
      for (const line of lines) {
        if (INTERVIEWER.test(line)) {
          if (current) turns.push(current)
          current = { speaker: 'interviewer', text: line.replace(INTERVIEWER, '').trim() }
        } else if (INTERVIEWEE.test(line)) {
          if (current) turns.push(current)
          current = { speaker: 'interviewee', text: line.replace(INTERVIEWEE, '').trim() }
        } else {
          if (current) current.text += ' ' + line
          else current = { speaker: 'interviewer', text: line }
        }
      }
      if (current) turns.push(current)
    } else {
      // No labels — split on blank lines into paragraphs, alternate starting with interviewer
      const paragraphs = pasteText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
      if (paragraphs.length < 2) {
        setParseError('Could not detect turn structure. Add blank lines between turns, or prefix each turn with "Interviewer:" / "Interviewee:".')
        return
      }
      turns = paragraphs.map((p, i) => ({
        speaker: i % 2 === 0 ? 'interviewer' : 'interviewee',
        text: p.replace(/\n/g, ' ').trim(),
      }))
    }

    if (!turns.length) { setParseError('No turns detected.'); return }
    setDialogue(turns)
    setPasteMode(false)
    setPasteText('')
  }

  const mutation = useMutation({
    mutationFn: async (payload) => {
      let caseId
      if (isEdit) {
        await updateCasebookCase(id, payload)
        caseId = Number(id)
      } else {
        const res = await createCasebookCase(payload)
        caseId = res.case_id
      }
      if (pendingFile) await uploadDiagram(caseId, pendingFile)
      return caseId
    },
    onSuccess: (caseId) => {
      qc.invalidateQueries(['casebook'])
      qc.invalidateQueries(['casebook-case', String(caseId)])
      navigate(`/casebook/${caseId}`)
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    const clean = (arr) => arr.map(s => s.trim()).filter(Boolean)
    mutation.mutate({
      case_title: title,
      firm,
      difficulty,
      case_type: caseType,
      is_numerical: isNum,
      case_statement: statement,
      dialogue: dialogue.filter(d => d.text.trim()).map(d => ({ speaker: d.speaker, text: d.text.trim() })),
      notes: {
        case_facts:      caseFacts.trim() ? [caseFacts.trim()] : [],
        additional_info: addInfo.trim()   ? [addInfo.trim()]   : [],
        recommendations: recommendations.trim() ? [recommendations.trim()] : [],
        tips_tricks:     tips.trim()            ? [tips.trim()]            : [],
      },
    })
  }

  const onFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setPendingFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const removePending = () => {
    setPendingFile(null)
    setPreviewUrl(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate(-1)}>
          <ChevronLeft size={16} /> Back
        </button>
        <div>
          <h1 className={styles.title}>{isEdit ? 'Edit Case' : 'Add Case'}</h1>
          <p className={styles.sub}>ICON IIM Bangalore Casebook</p>
        </div>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>

        {/* ── Basic Info ── */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Basic Info</h3>
          <div className={styles.row}>
            <Field label="Case Title" required>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Government in Middle East" required />
            </Field>
            <Field label="Firm">
              <input value={firm} onChange={e => setFirm(e.target.value)} placeholder="e.g. LEK, McKinsey" />
            </Field>
          </div>
          <div className={styles.row}>
            <Field label="Difficulty">
              <select value={difficulty} onChange={e => setDiff(e.target.value)}>
                <option value="">Select difficulty</option>
                {DIFFICULTIES.map(d => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Case Type">
              <select value={caseType} onChange={e => setCaseType(e.target.value)}>
                <option value="">Select type</option>
                {CASE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className={styles.checkRow}>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={isNum} onChange={e => setIsNum(e.target.checked)} className={styles.checkbox} />
              Numerical case
            </label>
          </div>
          <Field label="Case Statement">
            <textarea rows={3} value={statement} onChange={e => setStatement(e.target.value)} placeholder="Your client is a government in Middle East looking to attract…" />
          </Field>
        </div>

        {/* ── Conversation ── */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>
              Conversation
              {!pasteMode && dialogue.some(d => d.text) && (
                <span className={styles.turnCount}>{dialogue.filter(d => d.text).length} turns</span>
              )}
            </h3>
            <div className={styles.sectionActions}>
              <button type="button" className={`${styles.modeBtn} ${pasteMode ? styles.modeBtnActive : ''}`} onClick={() => { setPasteMode(p => !p); setParseError('') }}>
                {pasteMode ? 'Manual mode' : 'Paste full conversation'}
              </button>
              {!pasteMode && (
                <button type="button" className={styles.addBtn} onClick={() => setDialogue(d => [...d, { speaker: 'interviewer', text: '' }])}>
                  <Plus size={13} /> Add Turn
                </button>
              )}
            </div>
          </div>

          {pasteMode ? (
            <div className={styles.pasteWrap}>
              <p className={styles.pasteHint}>
                Paste the full conversation. Prefix turns with <code>Interviewer:</code> / <code>Interviewee:</code>, or just separate turns with a blank line (alternates starting with Interviewer).
              </p>
              <textarea
                className={styles.pasteArea}
                rows={14}
                value={pasteText}
                onChange={e => { setPasteText(e.target.value); setParseError('') }}
                placeholder={`Interviewer: Confirming the problem statement…\n\nInterviewee: Yes, your understanding is correct…\n\nInterviewer: Before starting the analysis…`}
              />
              {parseError && <p className={styles.parseError}>{parseError}</p>}
              <div className={styles.pasteActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => { setPasteMode(false); setParseError('') }}>Cancel</button>
                <button type="button" className={styles.btnPrimary} onClick={parseConversation} disabled={!pasteText.trim()}>
                  Parse into turns
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.dialogueList}>
              {dialogue.map((d, i) => (
                <div key={i} className={`${styles.dialogueTurn} ${d.speaker === 'interviewer' ? styles.turnInterviewer : styles.turnInterviewee}`}>
                  <div className={styles.turnTop}>
                    <div className={styles.speakerToggle}>
                      <button
                        type="button"
                        className={`${styles.speakerBtn} ${d.speaker === 'interviewer' ? styles.speakerActive : ''}`}
                        onClick={() => setDialogue(prev => prev.map((x, j) => j === i ? { ...x, speaker: 'interviewer' } : x))}
                      >Interviewer</button>
                      <button
                        type="button"
                        className={`${styles.speakerBtn} ${d.speaker === 'interviewee' ? styles.speakerActive : ''}`}
                        onClick={() => setDialogue(prev => prev.map((x, j) => j === i ? { ...x, speaker: 'interviewee' } : x))}
                      >Interviewee</button>
                    </div>
                    {dialogue.length > 1 && (
                      <button type="button" className={styles.removeBtn} onClick={() => setDialogue(prev => prev.filter((_, j) => j !== i))}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={d.text}
                    onChange={e => setDialogue(prev => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                    placeholder={d.speaker === 'interviewer' ? 'Interviewer says…' : 'Interviewee responds…'}
                    className={styles.turnTextarea}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Solution ── */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Solution</h3>

          <div className={styles.row}>
            <Field label="Case Facts">
              <textarea
                rows={6}
                value={caseFacts}
                onChange={e => setCaseFacts(e.target.value)}
                placeholder={`- Client is Government of Middle East\n- Attract international education providers\n- Target to implement by 2030`}
                className={styles.mdTextarea}
              />
            </Field>
            <Field label="Additional Information">
              <textarea
                rows={6}
                value={addInfo}
                onChange={e => setAddInfo(e.target.value)}
                placeholder={`- Gaps across all level of education\n- Benchmark 20% ROI\n- 11-year payback against regional peers`}
                className={styles.mdTextarea}
              />
            </Field>
          </div>

          {/* Diagram */}
          <Field label="Framework Diagram">
            {diagrams.map(d => (
              <div key={d.diagram_id} className={styles.existingDiagram}>
                <img src={d.image_path} alt="diagram" className={styles.diagramThumb} />
                <span className={styles.diagName}>{d.image_path.split('/').pop()}</span>
              </div>
            ))}
            {previewUrl ? (
              <div className={styles.previewWrap}>
                <img src={previewUrl} alt="preview" className={styles.diagramThumb} />
                <button type="button" className={styles.removeBtn} onClick={removePending}><X size={13} /> Remove</button>
              </div>
            ) : (
              <label className={styles.uploadArea}>
                <Upload size={18} />
                <span>Click to upload diagram image</span>
                <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} hidden />
              </label>
            )}
          </Field>

          <div className={styles.row}>
            <Field label="Recommendations">
              <textarea
                rows={6}
                value={recommendations}
                onChange={e => setRecs(e.target.value)}
                placeholder={`- Benchmark feasibility across regional peers\n- Focus on high-gap, high-demand segments`}
                className={styles.mdTextarea}
              />
            </Field>
            <Field label="Tips & Tricks">
              <textarea
                rows={6}
                value={tips}
                onChange={e => setTips(e.target.value)}
                placeholder={`- Could have explored PPP or JV models\n- Focus on enhancing local institutions`}
                className={styles.mdTextarea}
              />
            </Field>
          </div>
        </div>

        {mutation.isError && (
          <div className={styles.errorBanner}>Failed to save. Please try again.</div>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.btnSecondary} onClick={() => navigate(-1)}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Case'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}{required && <span className={styles.req}> *</span>}</label>
      {children}
    </div>
  )
}

function BulletListField({ label, items, setItems, placeholder }) {
  const update = (i, val) => setItems(prev => prev.map((x, j) => j === i ? val : x))
  const add    = () => setItems(prev => [...prev, ''])
  const remove = (i) => setItems(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)

  return (
    <div className={styles.field}>
      <div className={styles.bulletHeader}>
        <label className={styles.label}>{label}</label>
        <button type="button" className={styles.addSmall} onClick={add}><Plus size={11} /> Add</button>
      </div>
      <div className={styles.bulletList}>
        {items.map((item, i) => (
          <div key={i} className={styles.bulletRow}>
            <span className={styles.bulletDot}>•</span>
            <input
              value={item}
              onChange={e => update(i, e.target.value)}
              placeholder={placeholder}
              className={styles.bulletInput}
            />
            {items.length > 1 && (
              <button type="button" className={styles.removeBtn} onClick={() => remove(i)}><Trash2 size={12} /></button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
