import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { isModerator } from '../lib/roles'

type SkillCommentsPanelProps = {
  skillId: Id<'skills'>
  isAuthenticated: boolean
  me: Doc<'users'> | null
}

export function SkillCommentsPanel({ skillId, isAuthenticated, me }: SkillCommentsPanelProps) {
  const addComment = useMutation(api.comments.add)
  const removeComment = useMutation(api.comments.remove)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<Id<'comments'> | null>(null)
  const comments = useQuery(api.comments.listBySkill, { skillId, limit: 50 })

  const submitComment = async () => {
    const body = comment.trim()
    if (!body || isSubmitting) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await addComment({ skillId, body })
      setComment('')
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to post comment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteComment = async (commentId: Id<'comments'>) => {
    if (deletingCommentId) return
    setDeleteError(null)
    setDeletingCommentId(commentId)
    try {
      await removeComment({ commentId })
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete comment')
    } finally {
      setDeletingCommentId(null)
    }
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
        Comments
      </h2>
      {isAuthenticated ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submitComment()
          }}
          className="comment-form"
        >
          <textarea
            className="comment-input"
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Leave a note…"
            disabled={isSubmitting}
          />
          {submitError ? <div className="report-dialog-error">{submitError}</div> : null}
          <button className="btn comment-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Posting…' : 'Post comment'}
          </button>
        </form>
      ) : (
        <p className="section-subtitle">Sign in to comment.</p>
      )}
      {deleteError ? <div className="report-dialog-error">{deleteError}</div> : null}
      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {(comments ?? []).length === 0 ? (
          <div className="stat">No comments yet.</div>
        ) : (
          (comments ?? []).map((entry) => (
            <div key={entry.comment._id} className="comment-item">
              <div className="comment-body">
                <strong>@{entry.user?.handle ?? entry.user?.name ?? 'user'}</strong>
                <div className="comment-body-text">{entry.comment.body}</div>
              </div>
              {isAuthenticated && me && (me._id === entry.comment.userId || isModerator(me)) ? (
                <button
                  className="btn comment-delete"
                  type="button"
                  onClick={() => void deleteComment(entry.comment._id)}
                  disabled={Boolean(deletingCommentId) || isSubmitting}
                >
                  {deletingCommentId === entry.comment._id ? 'Deleting…' : 'Delete'}
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
