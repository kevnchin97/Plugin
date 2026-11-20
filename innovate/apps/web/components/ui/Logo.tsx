/** Wordmark: in/out brackets around a frame, the app's core gesture. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4H5v16h3M16 4h3v16h-3" fill="none" stroke="var(--in-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="9.5" y="9" width="5" height="6" rx="1" fill="currentColor" fillOpacity="0.85" />
      </svg>
      {!compact && <span className="text-md font-semibold tracking-[-0.01em]">Innovate</span>}
    </span>
  );
}
