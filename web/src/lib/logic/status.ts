// Attendance statuses: API values, and labels (colours: app.css, checked by the unit tests).

export const STATUSES = ['present', 'absent', 'conge', 'rtt'] as const;
export type Status = (typeof STATUSES)[number];
export type Period = 'AM' | 'PM';
export const PERIODS: readonly Period[] = ['AM', 'PM'];

export const LABEL: Record<Status, string> = {
  present: 'Présent',
  absent: 'Non-présent',
  conge: 'Congé',
  rtt: 'RTT',
};

export const PERIOD_LABEL: Record<Period, string> = { AM: 'matin', PM: 'après-midi' };
