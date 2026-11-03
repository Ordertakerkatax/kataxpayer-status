/** The five states from spec §5 and the words the board uses for each, verbatim. */
export const STATES = ['official_down', 'down', 'issues', 'up', 'no_data'] as const;
export type State = (typeof STATES)[number];

export const STATE_COPY: Record<State, { headline: string; subline: string | null }> = {
  official_down: { headline: 'BIR advisory: unavailable', subline: null },
  down: { headline: 'Likely down', subline: 'Most filers in the last hour say it failed.' },
  issues: { headline: 'Having problems', subline: 'Some filers in the last hour say it failed.' },
  up: { headline: 'Working', subline: 'Most filers in the last hour got through.' },
  no_data: { headline: 'Not enough reports', subline: 'Fewer than 3 reports in the last hour.' },
};

/** The states that bring up "What to do now" (spec §7). */
export const TROUBLE: readonly State[] = ['official_down', 'down', 'issues'];
