/**
 * Inline SVG so the panel stays monochrome, crisp at any scale, and free of
 * icon-pack attribution requirements.
 */

export function GearIcon() {
  // Ring plus eight teeth — drawn from primitives so it stays crisp at any size.
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
      {teeth.map((angle) => (
        <rect
          key={angle}
          x="10.5"
          y="1.8"
          width="3"
          height="4.4"
          rx="0.8"
          fill="currentColor"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <circle
        cx="12"
        cy="12"
        r="6.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
      />
    </svg>
  );
}

export function CaptureIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9,4.5 4.5,4.5 4.5,9" />
        <polyline points="15,4.5 19.5,4.5 19.5,9" />
        <polyline points="19.5,15 19.5,19.5 15,19.5" />
        <line x1="10.9" y1="4.5" x2="13.1" y2="4.5" />
        <line x1="19.5" y1="10.9" x2="19.5" y2="13.1" />
      </g>
      {/* The lens is a hole so the camera reads on any button background. */}
      <mask id="capture-lens">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        <circle cx="9" cy="15.9" r="2.7" fill="black" />
      </mask>
      <g fill="currentColor" mask="url(#capture-lens)">
        <rect x="6.2" y="8.8" width="5.6" height="4" rx="1.4" />
        <rect x="2.6" y="11.3" width="12.8" height="9.1" rx="2.4" />
      </g>
    </svg>
  );
}
