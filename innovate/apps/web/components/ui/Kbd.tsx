export function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-border-strong bg-surface-3 px-1 font-mono text-2xs leading-none text-text-muted ${className}`}
    >
      {children}
    </kbd>
  );
}
