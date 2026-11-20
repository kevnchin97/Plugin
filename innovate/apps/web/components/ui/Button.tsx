import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-strong disabled:opacity-40",
  secondary: "bg-surface-3 text-text border border-border-strong hover:bg-surface-4 disabled:opacity-40",
  ghost: "text-text-muted hover:text-text hover:bg-surface-3 disabled:opacity-40",
  danger: "bg-transparent text-danger border border-danger/40 hover:bg-danger/10",
};
const sizes: Record<Size, string> = { sm: "h-7 px-2.5 text-sm gap-1.5", md: "h-8 px-3 text-base gap-2" };

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ variant = "secondary", size = "md", className = "", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors duration-[var(--in-fast)] ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
});
