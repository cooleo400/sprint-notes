/* Auto end sprint dates. All dates are local calendar days as YYYY-MM-DD strings, so plain string comparison orders them. */

/** `iso` plus `days` calendar days. Uses UTC arithmetic so daylight-saving changes can't skip or repeat a day. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The date offered when auto end is first switched on: one sprint from today. */
export const defaultAutoEndDate = (today, weeks) => addDays(today, weeks * 7);

/** True when the sprint should be ended automatically now: on or after the chosen day. */
export const isAutoEndDue = ({ autoEnd, autoEndDate }, today) => Boolean(autoEnd && autoEndDate && autoEndDate <= today);

/**
 * The next auto end date after a run: whole sprint lengths after the previous date, skipping any that already
 * passed (for example when the app was closed for several sprints).
 */
export function nextAutoEndDate(previous, today, weeks) {
  let next = addDays(previous, weeks * 7);
  while (next <= today) next = addDays(next, weeks * 7);
  return next;
}
