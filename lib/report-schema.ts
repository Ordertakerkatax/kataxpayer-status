import { z } from 'zod';
import { FAILURE_TYPES, FORM_CODES, SYSTEMS } from './catalogue';

const systemKeys = SYSTEMS.map((s) => s.key) as [string, ...string[]];
const failureKeys = FAILURE_TYPES.map((f) => f.key) as [string, ...string[]];

/**
 * Spec §6 step 1. Strict, so an unknown field is a 400 as well as an unknown
 * value, and a failure type has to be one that applies to the system chosen
 * ("Can't log in" is an eFPS failure; eBIRForms has no login).
 */
export const reportSchema = z
  .strictObject({
    system_key: z.enum(systemKeys),
    outcome: z.enum(['ok', 'fail']),
    failure_type: z.enum(failureKeys).nullish(),
    form_code: z.enum(FORM_CODES).nullish(),
    turnstile_token: z.string().min(1).max(2048),
  })
  .superRefine((r, ctx) => {
    if (r.outcome === 'fail') {
      const type = FAILURE_TYPES.find((f) => f.key === r.failure_type);
      if (!type) {
        ctx.addIssue({ code: 'custom', path: ['failure_type'], message: 'Say what happened.' });
      } else if (!(type.systems as readonly string[]).includes(r.system_key)) {
        ctx.addIssue({ code: 'custom', path: ['failure_type'], message: 'That failure does not apply to this system.' });
      }
    } else if (r.failure_type) {
      ctx.addIssue({ code: 'custom', path: ['failure_type'], message: 'A report that worked has no failure type.' });
    }
  });

export type ReportBody = z.infer<typeof reportSchema>;
