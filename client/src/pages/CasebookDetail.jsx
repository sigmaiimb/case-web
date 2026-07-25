import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Hash, MessageSquare, BookOpen, Pencil, Check, X, Upload, ThumbsUp, ThumbsDown, CheckCircle2, Pencil as EditIcon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { getCasebookCase, patchNoteCategory, uploadDiagram, deleteDiagram, getCaseProgress, updateProgress, updatePersonalNotes } from '../api'
import { useAuth } from '../context/AuthContext'
import styles from './CasebookDetail.module.css'

export default function CasebookDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState('conversation')

  const { data: c, isLoading, isError } = useQuery({
    queryKey: ['casebook-case', id],
    queryFn: () => getCasebookCase(id),
  })

  if (isLoading) return <div className={styles.loading}>Loading…</div>
  if (isError || !c) return <div className={styles.loading}>Case not found.</div>

  const notesByCategory = (cat) =>
    (c.notes || []).filter(n => n.note_category === cat).sort((a, b) => a.sort_order - b.sort_order)

  const caseFacts       = notesByCategory('case_facts')
  const additionalInfo  = notesByCategory('additional_info')
  const recommendations = notesByCategory('recommendations')
  const tips            = notesByCategory('tips_tricks')

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate('/casebook')}>
        <ChevronLeft size={16} /> Casebook
      </button>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.meta}>
            {c.case_type && <span className={styles.category}>{c.case_type}</span>}
            {c.firm && <span className={styles.firm}>{c.firm}</span>}
            {c.is_numerical ? <span className={styles.numBadge}><Hash size={10} /> Numerical</span> : null}
          </div>
          <h1 className={styles.title}>{c.case_title}</h1>
          {c.case_statement && <p className={styles.statement}>{c.case_statement}</p>}
        </div>
        <div className={styles.headerRight}>
          {c.difficulty && <DifficultyBadge d={c.difficulty} />}
          {isAdmin && (
            <button className={styles.editCaseBtn} onClick={() => navigate(`/casebook/${id}/edit`)}>
              <EditIcon size={13} /> Edit case
            </button>
          )}
        </div>
      </div>

      {!isAdmin && <ProgressBar caseId={id} />}

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'conversation' ? styles.tabActive : ''}`} onClick={() => setTab('conversation')}>
          <MessageSquare size={14} /> Conversation
        </button>
        <button className={`${styles.tab} ${tab === 'solution' ? styles.tabActive : ''}`} onClick={() => setTab('solution')}>
          <BookOpen size={14} /> Solution
        </button>
      </div>

      {tab === 'conversation' ? (
        <ConversationTab dialogue={c.dialogue || []} />
      ) : (
        <>
          <SolutionTab
            caseId={id}
            caseFacts={caseFacts}
            additionalInfo={additionalInfo}
            recommendations={recommendations}
            tips={tips}
            diagrams={c.diagrams || []}
          />
          {!isAdmin && <PersonalNotes caseId={id} />}
        </>
      )}
    </div>
  )
}

function ConversationTab({ dialogue }) {
  if (!dialogue.length) return <div className={styles.empty}>No conversation recorded for this case.</div>
  return (
    <div className={styles.conversation}>
      {dialogue.map((d) => {
        const isInterviewer = d.speaker === 'interviewer'
        return (
          <div key={d.dialogue_id} className={`${styles.bubble} ${isInterviewer ? styles.interviewer : styles.interviewee}`}>
            <span className={styles.speaker}>{isInterviewer ? 'Interviewer' : 'Interviewee'}</span>
            <p className={styles.bubbleText}>{d.dialogue_text}</p>
          </div>
        )
      })}
    </div>
  )
}

function SolutionTab({ caseId, caseFacts, additionalInfo, recommendations, tips, diagrams }) {
  return (
    <div className={styles.solution}>
      <div className={styles.solutionTop}>
        <div className={styles.sidePanel}>
          <EditableSection caseId={caseId} category="case_facts" title="Case Facts" items={caseFacts} />
          <EditableSection caseId={caseId} category="additional_info" title="Additional Information" items={additionalInfo} />
        </div>

        <div className={styles.diagramPanel}>
          <DiagramSection caseId={caseId} diagrams={diagrams} />
        </div>
      </div>

      <div className={styles.solutionBottom}>
        <EditableSection caseId={caseId} category="recommendations" title="Recommendations" items={recommendations} />
        <EditableSection caseId={caseId} category="tips_tricks" title="Tips & Tricks" items={tips} />
      </div>
    </div>
  )
}

function EditableSection({ caseId, category, title, items }) {
  const qc = useQueryClient()
  const { isAdmin } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const content = items.map(n => n.note_text).join('\n')

  const startEdit = () => {
    setDraft(content)
    setEditing(true)
  }

  const cancel = () => setEditing(false)

  const save = async () => {
    setSaving(true)
    await patchNoteCategory(caseId, category, draft)
    qc.invalidateQueries(['casebook-case', caseId])
    setSaving(false)
    setEditing(false)
  }

  return (
    <div className={styles.solutionSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {isAdmin && (
          editing ? (
            <div className={styles.editActions}>
              <button className={styles.iconBtn} onClick={cancel} title="Cancel"><X size={13} /></button>
              <button className={`${styles.iconBtn} ${styles.iconBtnSave}`} onClick={save} disabled={saving} title="Save">
                <Check size={13} />
              </button>
            </div>
          ) : (
            <button className={styles.iconBtn} onClick={startEdit} title="Edit"><Pencil size={13} /></button>
          )
        )}
      </div>

      {editing ? (
        <textarea
          className={styles.editTextarea}
          rows={6}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
        />
      ) : content ? (
        <div className={styles.mdContent}>
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      ) : (
        <p className={styles.emptySection}>
          {isAdmin
            ? <>No content yet. <button className={styles.inlineEdit} onClick={startEdit}>Add →</button></>
            : 'No content yet.'}
        </p>
      )}
    </div>
  )
}

function DiagramSection({ caseId, diagrams }) {
  const qc = useQueryClient()
  const { isAdmin } = useAuth()
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    await uploadDiagram(caseId, file)
    qc.invalidateQueries(['casebook-case', caseId])
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDelete = async (diagramId) => {
    await deleteDiagram(diagramId)
    qc.invalidateQueries(['casebook-case', caseId])
  }

  return (
    <div className={styles.solutionSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Framework Diagram</h3>
        {isAdmin && (
          <label className={styles.iconBtn} title="Upload diagram" style={{ cursor: 'pointer' }}>
            <Upload size={13} />
            <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} hidden />
          </label>
        )}
      </div>

      {uploading && <p className={styles.emptySection}>Uploading…</p>}

      {diagrams.length > 0 ? (
        diagrams.map(d => (
          <div key={d.diagram_id} className={styles.diagramWrap}>
            {d.framework_name && <p className={styles.frameworkLabel}>{d.framework_name}</p>}
            <img src={`/diagrams/${d.image_path}`} alt="Framework diagram" className={styles.diagram} />
            {isAdmin && (
              <button className={styles.diagramDelete} onClick={() => handleDelete(d.diagram_id)} title="Remove diagram">
                <X size={12} /> Remove
              </button>
            )}
          </div>
        ))
      ) : (
        !uploading && (
          isAdmin ? (
            <label className={styles.noDiagram} style={{ cursor: 'pointer' }}>
              <Upload size={16} />
              <span>Click to upload diagram</span>
              <input type="file" accept="image/*" onChange={handleUpload} hidden />
            </label>
          ) : (
            <p className={styles.emptySection}>No diagram uploaded.</p>
          )
        )
      )}
    </div>
  )
}

function PersonalNotes({ caseId }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: progress = {} } = useQuery({
    queryKey: ['progress', caseId],
    queryFn: () => getCaseProgress(caseId),
  })

  const notes = progress.personal_notes ?? ''

  const startEdit = () => {
    setDraft(notes)
    setEditing(true)
  }

  const cancel = () => setEditing(false)

  const save = async () => {
    setSaving(true)
    await updatePersonalNotes(caseId, draft)
    qc.invalidateQueries(['progress', caseId])
    setSaving(false)
    setEditing(false)
  }

  return (
    <div className={styles.personalNotes}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>My Notes</h3>
        {editing ? (
          <div className={styles.editActions}>
            <button className={styles.iconBtn} onClick={cancel} title="Cancel"><X size={13} /></button>
            <button className={`${styles.iconBtn} ${styles.iconBtnSave}`} onClick={save} disabled={saving} title="Save">
              <Check size={13} />
            </button>
          </div>
        ) : (
          <button className={styles.iconBtn} onClick={startEdit} title="Edit"><Pencil size={13} /></button>
        )}
      </div>
      {editing ? (
        <textarea
          className={styles.editTextarea}
          rows={5}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Your personal notes for this case…"
          autoFocus
        />
      ) : notes ? (
        <p className={styles.notesText}>{notes}</p>
      ) : (
        <p className={styles.emptySection}>
          No notes yet. <button className={styles.inlineEdit} onClick={startEdit}>Add →</button>
        </p>
      )}
    </div>
  )
}

function MarkdownNotes({ items }) {
  const content = items.map(n => n.note_text).join('\n')
  return (
    <div className={styles.mdContent}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}

function ProgressBar({ caseId }) {
  const qc = useQueryClient()
  const { data: progress = { status: null, reaction: null } } = useQuery({
    queryKey: ['progress', caseId],
    queryFn: () => getCaseProgress(caseId),
  })

  const mutation = useMutation({
    mutationFn: (data) => updateProgress(caseId, data),
    onSuccess: () => qc.invalidateQueries(['progress', caseId]),
  })

  const toggleDone = () => mutation.mutate({ status: progress.status === 'done' ? null : 'done' })
  const toggleReaction = (r) => mutation.mutate({ reaction: progress.reaction === r ? null : r })

  return (
    <div className={styles.progressBar}>
      <button
        className={`${styles.progressBtn} ${progress.status === 'done' ? styles.progressDone : ''}`}
        onClick={toggleDone}
      >
        <CheckCircle2 size={15} />
        {progress.status === 'done' ? 'Completed' : 'Mark as done'}
      </button>
      <div className={styles.reactions}>
        <button
          className={`${styles.reactionBtn} ${progress.reaction === 'like' ? styles.reactionLike : ''}`}
          onClick={() => toggleReaction('like')}
          title="Like"
        >
          <ThumbsUp size={14} />
        </button>
        <button
          className={`${styles.reactionBtn} ${progress.reaction === 'dislike' ? styles.reactionDislike : ''}`}
          onClick={() => toggleReaction('dislike')}
          title="Dislike"
        >
          <ThumbsDown size={14} />
        </button>
      </div>
    </div>
  )
}

function DifficultyBadge({ d }) {
  const cls = d === 'Easy' ? styles.easy : d === 'Hard' ? styles.hard : styles.moderate
  return <span className={`${styles.diffBadge} ${cls}`}>{d}</span>
}
