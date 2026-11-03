import type { State } from './states';

/**
 * What /api/status hands out, and what the home page renders first. Shared by
 * the server and the browser, so it holds nothing private: a report is a bare
 * point (docs/board-motion.md), never a row.
 */
export type Point = {
  /** Rounded down to the minute, so a point cannot be matched to a moment. */
  t: string;
  outcome: 'ok' | 'fail';
  form: string | null;
  failure: string | null;
};

export type BoardAdvisory = {
  id: number;
  title: string;
  url: string;
  referenceNo: string | null;
  issuedOn: string | null;
  kind: string | null;
  systems: string[];
  startsAt: string | null;
  endedAt: string | null;
};

export type SystemStatus = {
  key: string;
  label: string;
  state: State;
  ok: number;
  fail: number;
  latestReportAt: string | null;
  /** The advisory an official_down rests on. */
  advisory: BoardAdvisory | null;
  /** For no_data: the last state that was not no_data, and when. */
  lastKnown: { state: State; at: string } | null;
  topForms: { form: string; fails: number }[];
  topFailure: { key: string; label: string; count: number } | null;
  points: Point[];
};

export type Board = {
  generatedAt: string;
  windowMinutes: number;
  systems: SystemStatus[];
  /** The five most recent confirmed advisories. */
  advisories: BoardAdvisory[];
};
