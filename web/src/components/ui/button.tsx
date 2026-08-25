import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-[color,background-color,border-color,box-shadow,transform] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/.12)] hover:bg-primary/90",
        secondary: "border border-border bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/.04)] hover:border-input hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "bg-[#b63847] text-white hover:bg-[#a63240]",
        outline: "border border-border bg-transparent hover:bg-muted",
      },
      size: { default: "h-9 px-3.5", sm: "h-8 rounded-md px-3 text-xs", lg: "h-10 px-4.5 text-sm", icon: "size-9 p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "button"
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
})

export { buttonVariants }
