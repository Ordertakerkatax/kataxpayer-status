/** Why an advisory cannot be confirmed yet. Kept out of the 'use server' file, which may only export async functions. */
export const CONFIRM_PROBLEMS = {
  'no-kind': 'Choose what kind of advisory this is before confirming it.',
  'outage-systems': 'An outage needs at least one system before it can be confirmed.',
  'outage-start': 'An outage needs a start time before it can be confirmed.',
  'outage-order': 'The end must be after the start.',
  'restored-link': 'A restoration needs the outage it closes. If that outage is missing, add it by hand first.',
  'restored-time': 'A restoration needs the time the system came back.',
} as const;

export type ConfirmProblem = keyof typeof CONFIRM_PROBLEMS;
