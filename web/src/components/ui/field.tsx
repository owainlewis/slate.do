import * as React from "react"
import { cn } from "@/lib/utils"

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/80 hover:border-muted-foreground/40 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60", className)} {...props} />
}
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] leading-6 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/80 hover:border-muted-foreground/40 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60", className)} {...props} />
}
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-9 w-full cursor-pointer rounded-lg border border-input bg-background px-3 text-[13px] outline-none transition-[border-color,box-shadow,background-color] hover:border-muted-foreground/40 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60", className)} {...props} />
}
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-xs font-medium text-muted-foreground", className)} {...props} />
}
