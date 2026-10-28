/** The Goodminton logo: a white G over a court, on a deep-green tile. Same drawing as public/icons/logo.svg. */
export function AppIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden style={{ flex: 'none', display: 'block' }}>
      <defs>
        <radialGradient id="gm-bg" cx="0.28" cy="0.08" r="1.05">
          <stop offset="0" stopColor="#4CB47F" /><stop offset="0.42" stopColor="#17734A" /><stop offset="0.78" stopColor="#0A3E27" /><stop offset="1" stopColor="#062A1A" />
        </radialGradient>
        <linearGradient id="gm-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#D6E6DB" /></linearGradient>
        <clipPath id="gm-tile"><rect width="200" height="200" rx="46" /></clipPath>
      </defs>
      <g clipPath="url(#gm-tile)">
        <rect width="200" height="200" fill="url(#gm-bg)" />
        <g fill="none" stroke="#fff" strokeOpacity=".3" strokeWidth="3">
          <path d="M12 120 H188 L172 206 H28 Z" /><path d="M100 120 V206" /><path d="M18 154 H182" />
        </g>
        <path d="M142.4 57.6 A60 60 0 1 0 160 100 H108" fill="none" stroke="url(#gm-g)" strokeWidth="20" />
      </g>
    </svg>
  )
}
