/** Colombia (UTC-5): a shared clock format for browser previews and server writes. */
export function sessionWindow(now = new Date()) {
  const end = new Date(now.getTime() + 10 * 60_000);
  const local = (date: Date) => new Date(date.getTime() - 5 * 60 * 60_000).toISOString();
  return {
    date: local(now).slice(0, 10),
    startTime: local(now).slice(11, 19),
    endTime: local(end).slice(11, 19),
    registration_opens_at: now.toISOString(),
    registration_closes_at: end.toISOString(),
  };
}
