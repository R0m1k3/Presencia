// Attendance statuses: API values, labels and colours (see plan-webui §2).

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

/** Text, tinted background and bar colour of each status, all WCAG AA. */
export const COLORS: Record<Status, { fg: string; bg: string; bar: string }> = {
  present: { fg: '#1D6B45', bg: '#DFF0E5', bar: '#2E8A5C' },
  absent: { fg: '#A8261C', bg: '#FADFDB', bar: '#C8463A' },
  conge: { fg: '#8A4B00', bg: '#FBEBD2', bar: '#D9891F' },
  rtt: { fg: '#244A9E', bg: '#E2E9FA', bar: '#4A6FC4' },
};

export const PERIOD_LABEL: Record<Period, string> = { AM: 'matin', PM: 'après-midi' };

export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** WCAG relative luminance contrast ratio of two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
