export default function GSBLogo({ size = 32, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style={style}>
      <defs>
        <radialGradient id="gsb-bg" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#243050"/>
          <stop offset="100%" stopColor="#0e1422"/>
        </radialGradient>
        <linearGradient id="gsb-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0c96a"/>
          <stop offset="100%" stopColor="#c8952e"/>
        </linearGradient>
        <filter id="gsb-glow">
          <feGaussianBlur stdDeviation="6" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#gsb-bg)"/>
      <rect x="10" y="10" width="492" height="492" rx="104" fill="none" stroke="url(#gsb-gold)" strokeWidth="6" strokeOpacity="0.7"/>
      <line x1="256" y1="148" x2="256" y2="340" stroke="url(#gsb-gold)" strokeWidth="8" strokeLinecap="round"/>
      <path d="M256 148 L336 178 L256 208 Z" fill="url(#gsb-gold)"/>
      <ellipse cx="256" cy="342" rx="38" ry="10" fill="#0d1526" stroke="url(#gsb-gold)" strokeWidth="3"/>
      <path d="M156 342 Q196 330 256 332 Q316 330 356 342" fill="none" stroke="url(#gsb-gold)" strokeWidth="2.5" strokeOpacity="0.6" strokeLinecap="round"/>
      <rect x="96" y="240" width="18" height="100" rx="2" fill="url(#gsb-gold)" opacity="0.75"/>
      <rect x="86" y="233" width="38" height="11" rx="2" fill="url(#gsb-gold)" opacity="0.75"/>
      <rect x="86" y="338" width="38" height="9" rx="2" fill="url(#gsb-gold)" opacity="0.75"/>
      <rect x="398" y="240" width="18" height="100" rx="2" fill="url(#gsb-gold)" opacity="0.75"/>
      <rect x="388" y="233" width="38" height="11" rx="2" fill="url(#gsb-gold)" opacity="0.75"/>
      <rect x="388" y="338" width="38" height="9" rx="2" fill="url(#gsb-gold)" opacity="0.75"/>
      <text x="256" y="420" fontFamily="Georgia, serif" fontSize="58" fontWeight="700" fill="url(#gsb-gold)" textAnchor="middle" letterSpacing="8">GSB</text>
      <line x1="170" y1="433" x2="342" y2="433" stroke="url(#gsb-gold)" strokeWidth="2" strokeOpacity="0.6"/>
      <text x="256" y="456" fontFamily="Georgia, serif" fontSize="19" fill="#d4a843" textAnchor="middle" letterSpacing="4" opacity="0.85">GOLF LEAGUE</text>
    </svg>
  );
}
