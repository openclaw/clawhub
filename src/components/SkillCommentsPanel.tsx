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
  const comments = useQuery(api.comments.listBySkill, { skillId, limit: 50 })

  return (
    <div className="card">
      <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
        Comments
      </h2>
      {isAuthenticated ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!comment.trim()) return
            void addComment({ skillId, body: comment.trim() }).then(() => setComment(''))
          }}
          className="comment-form"
        >
          <textarea
            className="comment-input"
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Leave a note…"
          />
          <button className="btn comment-submit" type="submit">
            Post comment
          </button>
        </form>
      ) : (
        <p className="section-subtitle">Sign in to comment.</p>
      )}
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
                  onClick={() => void removeComment({ commentId: entry.comment._id })}
                >
                  Delete
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
