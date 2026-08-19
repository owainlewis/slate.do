import * as React from "react"
import { cn } from "@/lib/utils"

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50", className)} {...props} />
}
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50", className)} {...props} />
}
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50", className)} {...props} />
}
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground", className)} {...props} />
}
