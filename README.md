# BIR Filing Status Board — status.kataxpayer.com

"Can I file right now?" for eFPS and eBIRForms, from community reports and BIR advisories.
Free, unofficial, and it says so on every page. The spec is Version 1, November 2026.

Separate repo and separate Vercel project from kataxpayer.com. No git remote yet.

## Commands

```bash
npm run dev                      # localhost:3000
npm run build                    # run before saying something works
node scripts/tokens-to-css.mjs   # regenerate app/tokens.css from design/tokens.json
```

## Styling

`design/tokens.json` is a copy of the published KaTaxpayer design system, the same file
kataxpayer.com uses. `app/tokens.css` is generated from it: never hand-edit. Tailwind reads
the tokens through `@theme inline` in `app/globals.css`, so `bg-surface-brand`,
`text-ink-muted` and the rest are the brand's colours.

Two things that bite:

- `tokens.css` defines a global class per type style (`hero`, `display-1`..`3`, `price`,
  `body`, `body-lg`, `body-sm`, `caption`, `eyebrow`, `label`, `button`, `price-note`). Those
  names are reserved; do not use them for layout.
- Base element rules stay inside `@layer base`. Unlayered, they beat every Tailwind utility.

## Where things stand

- **Phase 0 done:** app shell, header with Manila time, disclaimer strip and footer on every
  page, `robots.txt`, `.env.example`, and the advisory source write-up in `docs/bir-source.md`.
- **Advisory source decided:** option A, the rendered home page (`docs/bir-source.md`).
- **The board will be a live report stream:** brief in `docs/board-motion.md`, built in Phase 2.
- Phases 1 to 5 are not started. The board cards are a placeholder.
