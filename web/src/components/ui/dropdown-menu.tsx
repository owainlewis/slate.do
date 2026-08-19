import * as React from "react"
import { DropdownMenu as Primitive } from "radix-ui"
import { cn } from "@/lib/utils"

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content sideOffset={sideOffset} className={cn("z-50 min-w-44 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl", className)} {...props} /></Primitive.Portal>
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn("flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-muted data-[disabled]:opacity-50", className)} {...props} />
}
