/** The load line mark: a disc crossed by the line a hull may not sink below. */
export function Symbol({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <rect x="2" y="14.6" width="28" height="2.8" rx="0.6" fill="var(--signal)" />
    </svg>
  );
}

export function Brand({ caption = "Trade execution" }: { caption?: string }) {
  return (
    <span className="brand">
      <Symbol />
      <div>
        <strong>Plimsoll</strong>
        <small>{caption}</small>
      </div>
    </span>
  );
}
