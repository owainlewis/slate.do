import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ className, children, showClose = true, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[5px] data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 text-foreground shadow-2xl outline-none", className)} {...props}>
        {children}
        {showClose && <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close"><X className="size-4" /></DialogPrimitive.Close>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader(props: React.HTMLAttributes<HTMLDivElement>) { return <div className="mb-5 space-y-1.5" {...props} /> }
export function DialogTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title className="font-serif text-2xl" {...props} /> }
export function DialogDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description className="text-sm leading-6 text-muted-foreground" {...props} /> }
export function DialogFooter(props: React.HTMLAttributes<HTMLDivElement>) { return <div className="mt-6 flex justify-end gap-2" {...props} /> }
