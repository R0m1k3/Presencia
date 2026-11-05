// The Validation badge (companies not yet validated this month): fetched once,
// then again only after an action that can change it.

class Badge {
  version = $state(0);
  refresh() {
    this.version++;
  }
}

export const badge = new Badge();
