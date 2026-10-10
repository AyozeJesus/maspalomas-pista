// Los iconos de la app (trazo, del color del texto), los mismos de siempre.
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" strokeWidth="2.4" {...STROKE}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" strokeWidth="2.2" {...STROKE}>
      <path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" strokeWidth="2.2" {...STROKE}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

export function RideIcon() {
  return (
    <svg viewBox="0 0 24 24" strokeWidth="2" {...STROKE}>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l4.5-5" />
      <path d="M12 16h0.01" />
    </svg>
  );
}

export function RoutesIcon() {
  return (
    <svg viewBox="0 0 24 24" strokeWidth="2" {...STROKE}>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" strokeWidth="2" {...STROKE}>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}
