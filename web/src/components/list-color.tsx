import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export const listColors = [
  { value: "slate", label: "Slate", hex: "#8b8d98" },
  { value: "red", label: "Red", hex: "#dc4c3e" },
  { value: "orange", label: "Orange", hex: "#e67e22" },
  { value: "yellow", label: "Yellow", hex: "#c99a0c" },
  { value: "green", label: "Green", hex: "#4c9a62" },
  { value: "teal", label: "Teal", hex: "#27958c" },
  { value: "blue", label: "Blue", hex: "#3f7dcc" },
  { value: "indigo", label: "Indigo", hex: "#5966c9" },
  { value: "purple", label: "Purple", hex: "#8e5bb7" },
  { value: "pink", label: "Pink", hex: "#c75c91" },
] as const

export type ListColor = typeof listColors[number]["value"]

export function listColorHex(color?: string) {
  return listColors.find(option => option.value === color)?.hex || listColors[0].hex
}

export function ListColorDot({ color, className }: { color?: string; className?: string }) {
  return <span className={cn("list-color-dot", className)} style={{ backgroundColor: listColorHex(color) }} aria-hidden="true" />
}

export function ListColorPicker({ value, onChange, disabled = false, label = "List color" }: { value?: string; onChange: (color: ListColor) => void; disabled?: boolean; label?: string }) {
  return (
    <div className="list-color-picker" role="group" aria-label={label}>
      {listColors.map(color => (
        <button
          key={color.value}
          type="button"
          className={cn("list-color-choice", value === color.value && "active")}
          aria-label={`${color.label} list color`}
          aria-pressed={value === color.value}
          title={color.label}
          disabled={disabled}
          onClick={() => onChange(color.value)}
        >
          <span style={{ backgroundColor: color.hex }} />
          {value === color.value && <Check aria-hidden="true" />}
        </button>
      ))}
    </div>
  )
}
