import { useI18n } from '../i18n/useI18n'

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
  const { t } = useI18n()
  if (!isOpen) return null

  return (
    <div className="report-dialog-backdrop">
      <div className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <h2 id="report-title" className="section-title" style={{ margin: 0, fontSize: '1.1rem' }}>
          {t('skillReport.title')}
        </h2>
        <p className="section-subtitle" style={{ margin: 0 }}>
          {t('skillReport.subtitle')}
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
            aria-label={t('skillReport.ariaLabel')}
            placeholder={t('skillReport.placeholder')}
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
              {t('skillReport.cancel')}
            </button>
            <button type="submit" className="btn" disabled={isSubmitting}>
              {isSubmitting ? t('skillReport.submitting') : t('skillReport.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
