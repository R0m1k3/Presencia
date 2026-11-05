// Who may do what on a planning (plan-webui §5.1). Every input comes from
// GET /api/attendance; nothing is recomputed from dates.

export type PlanningFlags = {
  editable: boolean;
  cadreValidated: boolean;
  companyValidated: boolean;
};

export type Banner = 'none' | 'cadre-own' | 'cadre-own-editable' | 'cadre-admin' | 'company';

export function lockState(f: PlanningFlags, viewingOther: boolean) {
  return {
    locked: !f.editable,
    canValidate: !viewingOther && !f.cadreValidated && !f.companyValidated,
    canReopen: viewingOther && f.cadreValidated && !f.companyValidated,
    banner: (f.companyValidated
      ? 'company'
      : f.cadreValidated
        ? viewingOther
          ? 'cadre-admin'
          : f.editable
            ? 'cadre-own-editable' // an admin's own validated month stays editable
            : 'cadre-own'
        : 'none') as Banner,
  };
}
