import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { isModerator } from "../lib/roles";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { Textarea } from "./ui/textarea";

type SkillCommentsPanelProps = {
  skillId: Id<"skills">;
  isAuthenticated: boolean;
  me: Doc<"users"> | null;
};

function formatReportError(error: unknown) {
  if (error instanceof Error) {
    const cleaned = error.message
      .replace(/\[CONVEX[^\]]*\]\s*/g, "")
      .replace(/\[Request ID:[^\]]*\]\s*/g, "")
      .replace(/^Server Error Called by client\s*/i, "")
      .replace(/^ConvexError:\s*/i, "")
      .trim();
    if (cleaned && cleaned !== "Server Error") return cleaned;
  }
  return "Failed to report comment";
}

export function SkillCommentsPanel({ skillId, isAuthenticated, me }: SkillCommentsPanelProps) {
  const addComment = useMutation(api.comments.add);
  const removeComment = useMutation(api.comments.remove);
  const reportComment = useMutation(api.comments.report);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<Id<"comments"> | null>(null);
  const [reportingCommentId, setReportingCommentId] = useState<Id<"comments"> | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const comments = useQuery(api.comments.listBySkill, { skillId, limit: 50 });

  const submitComment = async () => {
    const body = comment.trim();
    if (!body || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await addComment({ skillId, body });
      setComment("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to post comment");
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteComment = async (commentId: Id<"comments">) => {
    if (deletingCommentId) return;
    setDeletingCommentId(commentId);
    try {
      await removeComment({ commentId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete comment");
    } finally {
      setDeletingCommentId(null);
    }
  };

  const openReportForm = (commentId: Id<"comments">) => {
    setReportingCommentId(commentId);
    setReportReason("");
    setReportError(null);
    setReportNotice(null);
    setIsSubmittingReport(false);
  };

  const closeReportForm = () => {
    setReportingCommentId(null);
    setReportReason("");
    setReportError(null);
    setIsSubmittingReport(false);
  };

  const submitReport = async (commentId: Id<"comments">) => {
    if (isSubmittingReport) return;
    const reason = reportReason.trim();
    if (!reason) {
      setReportError("Report reason required.");
      return;
    }

    setIsSubmittingReport(true);
    setReportError(null);
    setReportNotice(null);
    try {
      const result = await reportComment({ commentId, reason });
      setReportNotice(
        result.alreadyReported ? "You already reported this comment." : "Report submitted.",
      );
      closeReportForm();
    } catch (error) {
      setReportError(formatReportError(error));
      setIsSubmittingReport(false);
    }
  };

  return (
    <Card>
      <h2 className="m-0 font-display text-[1.2rem] font-bold text-[color:var(--ink)]">Comments</h2>
      {isAuthenticated ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitComment();
          }}
          className="flex flex-col gap-3"
        >
          <Textarea
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Leave a note…"
            disabled={isSubmitting}
          />
          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? "Posting…" : "Post comment"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-[color:var(--ink-soft)]">Sign in to comment.</p>
      )}
      {reportNotice ? (
        <div className="text-sm text-[color:var(--ink-soft)]">{reportNotice}</div>
      ) : null}
      <div className="grid gap-3 pt-1">
        {comments === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : comments.length === 0 ? (
          <div className="text-sm text-[color:var(--ink-soft)]">No comments yet.</div>
        ) : (
          comments.map((entry) => (
            <div
              key={entry.comment._id}
              className="flex gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <strong className="text-sm">
                  @{entry.user?.handle ?? entry.user?.name ?? "user"}
                </strong>
                <div className="whitespace-pre-wrap break-words text-sm text-[color:var(--ink)]">
                  {entry.comment.body}
                </div>
                {isAuthenticated && reportingCommentId === entry.comment._id ? (
                  <form
                    className="mt-2 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitReport(entry.comment._id);
                    }}
                  >
                    <Textarea
                      rows={3}
                      value={reportReason}
                      onChange={(event) => setReportReason(event.target.value)}
                      placeholder="Why are you reporting this comment?"
                      disabled={isSubmittingReport}
                      className="min-h-[80px]"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={closeReportForm}
                        disabled={isSubmittingReport}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" type="submit" disabled={isSubmittingReport}>
                        {isSubmittingReport ? "Reporting…" : "Submit report"}
                      </Button>
                    </div>
                    {reportError ? (
                      <div className="text-sm text-red-600 dark:text-red-400">{reportError}</div>
                    ) : null}
                    <div className="text-sm text-[color:var(--ink-soft)]">
                      Reports require a reason. Abuse of reporting may result in bans.
                    </div>
                  </form>
                ) : null}
              </div>
              {isAuthenticated && me ? (
                <div className="flex shrink-0 flex-col gap-1">
                  {me._id === entry.comment.userId || isModerator(me) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void deleteComment(entry.comment._id)}
                      disabled={Boolean(deletingCommentId) || isSubmitting || isSubmittingReport}
                    >
                      {deletingCommentId === entry.comment._id ? "Deleting…" : "Delete"}
                    </Button>
                  ) : null}
                  {me._id !== entry.comment.userId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openReportForm(entry.comment._id)}
                      disabled={
                        isSubmitting ||
                        Boolean(deletingCommentId) ||
                        (Boolean(reportingCommentId) && reportingCommentId !== entry.comment._id)
                      }
                    >
                      {reportingCommentId === entry.comment._id ? "Report open" : "Report"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
