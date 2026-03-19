import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { buildSkillHref } from './skillDetailUtils'

type OwnedSkillOption = {
  _id: Id<'skills'>
  slug: string
  displayName: string
}

type SkillOwnershipPanelProps = {
  skillId: Id<'skills'>
  slug: string
  ownerHandle: string | null
  ownerId: Id<'users'> | null
  ownedSkills: OwnedSkillOption[]
}

function formatMutationError(error: unknown) {
  if (error instanceof Error) {
    return error.message
      .replace(/\[CONVEX[^\]]*\]\s*/g, '')
      .replace(/\[Request ID:[^\]]*\]\s*/g, '')
      .replace(/^Server Error Called by client\s*/i, '')
      .replace(/^ConvexError:\s*/i, '')
      .trim()
  }
  return 'Request failed.'
}

export function SkillOwnershipPanel({
  skillId,
  slug,
  ownerHandle,
  ownerId,
  ownedSkills,
}: SkillOwnershipPanelProps) {
  const navigate = useNavigate()
  const renameOwnedSkill = useMutation(api.skills.renameOwnedSkill)
  const mergeOwnedSkillIntoCanonical = useMutation(api.skills.mergeOwnedSkillIntoCanonical)
  const deleteOwnedSkill = useMutation(api.skills.deleteOwnedSkill)

  const [renameSlug, setRenameSlug] = useState(slug)
  const [mergeTargetSlug, setMergeTargetSlug] = useState(ownedSkills[0]?.slug ?? '')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ownerHref = (nextSlug: string) => buildSkillHref(ownerHandle, ownerId, nextSlug)
  const isDeleteConfirmed = deleteConfirmation.trim().toLowerCase() === 'delete'

  const handleRename = async () => {
    const nextSlug = renameSlug.trim().toLowerCase()
    if (!nextSlug || nextSlug === slug) return
    if (!window.confirm(`Rename ${slug} to ${nextSlug}? Old slug will redirect.`)) return
    setIsSubmitting(true)
    setError(null)
    try {
      await renameOwnedSkill({ slug, newSlug: nextSlug })
      await navigate({
        to: '/$owner/$slug',
        params: {
          owner: ownerHandle ?? String(ownerId ?? ''),
          slug: nextSlug,
        },
        replace: true,
      })
    } catch (renameError) {
      setError(formatMutationError(renameError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleMerge = async () => {
    const targetSlug = mergeTargetSlug.trim().toLowerCase()
    if (!targetSlug || targetSlug === slug) return
    if (
      !window.confirm(
        `Merge ${slug} into ${targetSlug}? ${slug} will stop listing publicly and redirect.`,
      )
    ) {
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await mergeOwnedSkillIntoCanonical({
        sourceSlug: slug,
        targetSlug,
      })
      await navigate({
        to: '/$owner/$slug',
        params: {
          owner: ownerHandle ?? String(ownerId ?? ''),
          slug: targetSlug,
        },
        replace: true,
      })
    } catch (mergeError) {
      setError(formatMutationError(mergeError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!isDeleteConfirmed) return
    setIsSubmitting(true)
    setError(null)
    try {
      await deleteOwnedSkill({ slug })
      await navigate({ to: '/dashboard', replace: true })
    } catch (deleteError) {
      setError(formatMutationError(deleteError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="card skill-owner-tools" data-skill-id={skillId}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Owner tools
      </h2>
      <p className="section-subtitle">
        Rename the canonical slug, fold this listing into another one you own, or remove it from
        public listings. Old slugs stay as redirects and stop polluting search/list views.
      </p>

      <div className="skill-owner-tools-grid">
        <label className="management-control management-control-stack">
          <span className="mono">rename slug</span>
          <input
            className="management-field"
            value={renameSlug}
            onChange={(event) => setRenameSlug(event.target.value)}
            placeholder="new-slug"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="section-subtitle">Current page: {ownerHref(slug)}</span>
        </label>
        <div className="management-control management-control-stack">
          <span className="mono">rename action</span>
          <button
            className="btn management-action-btn"
            type="button"
            onClick={() => void handleRename()}
            disabled={isSubmitting || renameSlug.trim().toLowerCase() === slug}
          >
            Rename and redirect
          </button>
        </div>
        <label className="management-control management-control-stack">
          <span className="mono">merge into</span>
          <select
            className="management-field"
            value={mergeTargetSlug}
            onChange={(event) => setMergeTargetSlug(event.target.value)}
            disabled={ownedSkills.length === 0 || isSubmitting}
          >
            {ownedSkills.length === 0 ? <option value="">No other owned skills</option> : null}
            {ownedSkills.map((entry) => (
              <option key={entry._id} value={entry.slug}>
                {entry.displayName} ({entry.slug})
              </option>
            ))}
          </select>
        </label>
        <div className="management-control management-control-stack">
          <span className="mono">merge action</span>
          <button
            className="btn management-action-btn"
            type="button"
            onClick={() => void handleMerge()}
            disabled={isSubmitting || !mergeTargetSlug}
          >
            Merge into target
          </button>
        </div>
        <div className="management-control management-control-stack skill-owner-delete-panel">
          <span className="mono">delete skill</span>
          <span className="section-subtitle">
            Soft delete hides this skill from public view. Type <span className="mono">delete</span>{' '}
            before confirming.
          </span>
          {showDeleteConfirmation ? (
            <input
              className="management-field"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder='type "delete"'
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
            />
          ) : (
            <span className="section-subtitle">
              This removes the current skill listing and returns you to your dashboard.
            </span>
          )}
        </div>
        <div className="management-control management-control-stack">
          <span className="mono">delete action</span>
          {showDeleteConfirmation ? (
            <div className="skill-owner-delete-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setDeleteConfirmation('')
                  setShowDeleteConfirmation(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger management-action-btn"
                type="button"
                onClick={() => void handleDelete()}
                disabled={isSubmitting || !isDeleteConfirmed}
              >
                {isSubmitting ? 'Deleting…' : 'Confirm delete'}
              </button>
            </div>
          ) : (
            <button
              className="btn btn-danger management-action-btn"
              type="button"
              onClick={() => {
                setDeleteConfirmation('')
                setShowDeleteConfirmation(true)
                setError(null)
              }}
              disabled={isSubmitting}
            >
              Delete skill
            </button>
          )}
        </div>
      </div>

      {error ? <div className="stat" style={{ color: 'var(--danger)' }}>{error}</div> : null}
      <div className="section-subtitle">
        Merge keeps the target live and hides this row. Delete is a soft delete and restore remains
        CLI-only for now.
      </div>
    </div>
  )
}
