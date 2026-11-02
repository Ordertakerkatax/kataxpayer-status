import { SYSTEMS } from '@/lib/catalogue';

/**
 * Phase 0 placeholder. The live board, the report flow and the advisories list
 * arrive in Phase 2, once the database exists. Until then each card says so
 * plainly rather than showing a state nobody has reported.
 */
export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl sm:text-4xl">Is eFPS or eBIRForms working right now?</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {SYSTEMS.map((s) => (
          <section
            key={s.key}
            aria-labelledby={`sys-${s.key}`}
            className="rounded-lg border border-border bg-surface-raised p-6 shadow-[var(--shadow-sm)]"
          >
            <h2 id={`sys-${s.key}`} className="text-2xl">
              {s.label}
            </h2>
            <p className="mt-2 font-semibold">Not enough reports</p>
            <p className="text-ink-muted text-sm">The board starts counting reports at launch.</p>
          </section>
        ))}
      </div>
    </div>
  );
}
