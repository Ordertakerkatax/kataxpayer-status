/**
 * The KaTaxpayer mark.
 *
 * Inlined rather than served as <img src="logo.svg">, because an SVG loaded
 * through an img tag is its own document: it inherits no currentColor and no
 * custom properties, so the mark could not take its colours from the tokens.
 * Inline, the circle and the K are `currentColor` — set `color` on the parent —
 * and the bubble and dot are overridable with --logo-bubble and --logo-dot.
 *
 * The K is a path lifted from Plus Jakarta Sans at 800, the brand's own face,
 * so the mark never waits on a webfont and never shifts if one fails to load.
 *
 * public/logo.svg is the same drawing, kept for the favicon, e-mail and
 * open-graph, where no CSS reaches it and the literal fallbacks apply.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      role="img"
      aria-label="KaTaxpayer"
      focusable="false"
    >
      <title>KaTaxpayer</title>
      <circle cx="64" cy="64" r="64" fill="currentColor"/>
      <path d="M44.0 36.0 H86.0 A11.0 11.0 0 0 1 97.0 47.0 V66.0 A11.0 11.0 0 0 1 86.0 77.0 H56.0 L38.0 99.0 L46.0 77.0 H44.0 A11.0 11.0 0 0 1 33.0 66.0 V47.0 A11.0 11.0 0 0 1 44.0 36.0 Z" fill="var(--logo-bubble, #f6f0e6)"/>
      <path d="M66 0V745H221V372L178 387L476 745H670L375 389L384 499L676 0H495L313 315L221 204V0Z" transform="translate(51.55 70.00) scale(0.03624 -0.03624)" fill="currentColor"/>
      <circle cx="99.2" cy="43.4" r="9.3" fill="var(--logo-dot, #ffd60a)"/>
    </svg>
  );
}
