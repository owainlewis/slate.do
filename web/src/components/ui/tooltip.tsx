import * as React from "react"
import { Tooltip as Primitive } from "radix-ui"
import { cn } from "@/lib/utils"

export const Tooltip = Primitive.Root
export const TooltipTrigger = Primitive.Trigger

export function TooltipContent({ className, sideOffset = 8, children, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-lg", className)}
        {...props}
      >
        {children}
        <Primitive.Arrow className="fill-popover" />
      </Primitive.Content>
    </Primitive.Portal>
  )
}
