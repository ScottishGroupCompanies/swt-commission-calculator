export function ScottishMark({ size = 44 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" fill="#1B2A4A" />
      <rect x="30" width="4" height="64" fill="#ffffff" />
      <rect y="30" width="64" height="4" fill="#ffffff" />
    </svg>
  );
}

export function ScottishLogo({ markSize = 48 }: { markSize?: number }) {
  return (
    <div className="brand">
      <ScottishMark size={markSize} />
      <div>
        <div className="wordmark">SCOTTISH</div>
        <div className="brand-sub">GROUP COMPANIES</div>
      </div>
    </div>
  );
}
