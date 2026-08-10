/**
 * Evaluate a media query against a *hypothetical* viewport.
 *
 * `window.matchMedia` can only answer for the real window, but the preview needs
 * to know which variant a 390x844 phone would get while running in a desktop
 * browser. So this parses the handful of features that gate art direction in
 * practice and reports `null` — "cannot say" — for anything else, rather than
 * guessing. The caller shows an honest "pick manually" instead of a wrong answer.
 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Empty media always matches; anything unparseable stays "cannot say". */
export function mediaMatches(media: string, viewport: Viewport): boolean | null {
  return media.trim() === '' ? true : matchesViewport(media, viewport);
}

const FEATURE = /^\(\s*(min|max)-(width|height)\s*:\s*(-?[\d.]+)px\s*\)$/;
const ORIENTATION = /^\(\s*orientation\s*:\s*(portrait|landscape)\s*\)$/;

export function matchesViewport(media: string, viewport: Viewport): boolean | null {
  const query = media.trim().toLowerCase();
  if (query.length === 0) return true;

  // A comma-separated list is a disjunction; unknown branches poison the result
  // only if no other branch already matched.
  let sawUnknown = false;
  for (const clause of query.split(',')) {
    const result = matchesClause(clause, viewport);
    if (result === true) return true;
    if (result === null) sawUnknown = true;
  }
  return sawUnknown ? null : false;
}

function matchesClause(clause: string, viewport: Viewport): boolean | null {
  const terms = clause.split(/\s+and\s+/).map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) return null;

  let unknown = false;
  for (const term of terms) {
    const result = matchesTerm(term, viewport);
    if (result === false) return false;
    if (result === null) unknown = true;
  }
  return unknown ? null : true;
}

function matchesTerm(term: string, viewport: Viewport): boolean | null {
  // `screen` and `all` are true in any browser preview; `print` is not.
  if (term === 'screen' || term === 'all') return true;
  if (term === 'print') return false;

  const feature = FEATURE.exec(term);
  if (feature) {
    const [, bound, axis, raw] = feature;
    const value = axis === 'width' ? viewport.width : viewport.height;
    const limit = Number(raw);
    return bound === 'max' ? value <= limit : value >= limit;
  }

  const orientation = ORIENTATION.exec(term);
  if (orientation) {
    const portrait = viewport.height >= viewport.width;
    return orientation[1] === 'portrait' ? portrait : !portrait;
  }

  return null;
}
