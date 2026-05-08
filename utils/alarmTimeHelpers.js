/**
 * Alarm / checkpoint time helpers.
 */

/**
 * Returns Date for next 8:00 AM (today if >=8AM, tomorrow if <8AM)
 */
export function getNext8AM() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  // Construct 8:00:00.000 today in local time
  const todayAt8 = new Date(y, m, d, 8, 0, 0, 0);

  if (todayAt8.getTime() > now.getTime()) {
    return todayAt8;
  }
  // Already past 8 AM — return 8 AM tomorrow
  return new Date(y, m, d + 1, 8, 0, 0, 0);
}

