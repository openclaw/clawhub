type SkillReportDialogProps = {
  isOpen: boolean
  isSubmitting: boolean
  reportReason: string
  reportError: string | null
  onReasonChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}

export function SkillReportDialog({
  isOpen,
  isSubmitting,
  reportReason,
  reportError,
  onReasonChange,
  onCancel,
  onSubmit,
}: SkillReportDialogProps) {
  if (!isOpen) return null

  return (
    <div className="report-dialog-backdrop">
      <div className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <h2 id="report-title" className="section-title" style={{ margin: 0, fontSize: '1.1rem' }}>
          Report skill
        </h2>
        <p className="section-subtitle" style={{ margin: 0 }}>
          Describe the issue so moderators can review it quickly.
        </p>
        <form
          className="report-dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <textarea
            className="report-dialog-textarea"
            aria-label="Report reason"
            placeholder="What should moderators know?"
            value={reportReason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={5}
            disabled={isSubmitting}
          />
          {reportError ? <p className="report-dialog-error">{reportError}</p> : null}
          <div className="report-dialog-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (!isSubmitting) onCancel()
              }}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
