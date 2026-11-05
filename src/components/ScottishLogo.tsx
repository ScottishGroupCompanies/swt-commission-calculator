/** Same lockup as the SWT rep dashboard: four navy tiles, then the wordmark. */
export function ScottishLogo({ height = 52 }: { height?: number }) {
  return (
    <svg
      className="brand-logo"
      height={height}
      viewBox="0 0 268 56"
      role="img"
      aria-label="Scottish Group Companies"
    >
      <rect width="56" height="56" rx="4" fill="#ffffff" />
      <g fill="#1B2A4A">
        <rect x="4" y="4" width="22" height="22" />
        <rect x="30" y="4" width="22" height="22" />
        <rect x="4" y="30" width="22" height="22" />
        <rect x="30" y="30" width="22" height="22" />
      </g>
      <text
        x="72"
        y="28"
        fill="currentColor"
        fontFamily="var(--font-display), Georgia, serif"
        fontSize="26"
      >
        SCOTTISH
      </text>
      <text
        x="72"
        y="46"
        fill="currentColor"
        fontFamily="var(--font-sans), Helvetica, Arial, sans-serif"
        fontSize="9"
        letterSpacing="2.6"
      >
        GROUP COMPANIES
      </text>
    </svg>
  );
}
