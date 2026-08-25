import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Task } from "@/lib/types"

export function TaskDeleteDialog({ task, open, pending = false, error = "", returnFocus, onCancel, onConfirm }: {
  task: Pick<Task, "title" | "parentTaskId"> | null
  open: boolean
  pending?: boolean
  error?: string
  returnFocus?: HTMLElement | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancel = () => {
    onCancel()
    window.requestAnimationFrame(() => { if (returnFocus?.isConnected) returnFocus.focus() })
  }

  if (!task) return null
  const includesSubtasks = !task.parentTaskId

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen && !pending) cancel() }}>
      <DialogContent
        showClose={false}
        onCloseAutoFocus={event => {
          if (!returnFocus?.isConnected) return
          event.preventDefault()
          returnFocus.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete task?</DialogTitle>
          <DialogDescription>
            Delete “{task.title}”? {includesSubtasks ? "All of its subtasks will also be deleted." : "This action cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="status-message error" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" autoFocus disabled={pending} onClick={cancel}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>{pending ? "Deleting…" : "Delete task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
