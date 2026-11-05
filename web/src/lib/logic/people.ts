// Small rules shared by several admin screens.

/** People whose name or e-mail contains the query (case-insensitive). */
export function search<T extends { full_name: string; email: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? list.filter((u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : list;
}

/** A company the admin can validate: not yet validated, every active cadre done. */
export function isReady(c: { companyValidated: boolean; activeCadres: number; validatedCadres: number }): boolean {
  return !c.companyValidated && c.activeCadres > 0 && c.validatedCadres === c.activeCadres;
}

/**
 * « 12/44 » for a count of filled half-days against the month's workdays.
 * The API's count includes weekends, so it may exceed the total: then the
 * count alone, rather than « 46/44 ».
 */
export function filledText(filled: number, total: number): string {
  return filled > total ? `${filled}` : `${filled}/${total}`;
}
