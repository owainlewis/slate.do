import * as React from "react"
import { DropdownMenu as Primitive } from "radix-ui"
import { cn } from "@/lib/utils"

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content sideOffset={sideOffset} className={cn("z-50 min-w-48 rounded-xl border border-border/90 bg-popover p-1 text-popover-foreground shadow-[0_14px_40px_rgb(0_0_0/.14),0_2px_8px_rgb(0_0_0/.06)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95", className)} {...props} /></Primitive.Portal>
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn("flex min-h-9 cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors focus:bg-muted focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45", className)} {...props} />
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className={cn("px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground", className)} {...props} />
}
export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}
