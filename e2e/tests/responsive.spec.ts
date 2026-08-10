import { expect, test, type Page } from '@playwright/test';

/**
 * The responsive story, checked against real browser layout.
 *
 * Two things here cannot be caught by unit tests. First, whether the *photo* and
 * the *maths* agree about where the crop sits — they read the same resolved
 * `object-position` now, but they are applied through completely different
 * mechanisms (a CSS property on an `<img>` versus arithmetic in the transform),
 * and a disagreement drifts content off its surface. Second, whether variants
 * actually swap when the viewport crosses a breakpoint.
 */

const TOLERANCE = 1;

/** Call one of the harness's `window.__*` helpers. */
function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([fn, params]) =>
      (window as unknown as Record<string, (...rest: unknown[]) => unknown>)[fn as string]!(
        ...(params as unknown[]),
      ),
    [name, args] as const,
  ) as Promise<T>;
}

async function expectProbesOnSurface(page: Page, label: string): Promise<void> {
  const actual = await call<[number, number][]>(page, '__probes', '[data-corner]');
  const expected = await call<[number, number][]>(page, '__expected', 'laptop-screen');

  expect(actual, `${label}: probe count`).toHaveLength(4);
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = actual[i]!;
    const [ex, ey] = expected[i]!;
    expect(
      Math.hypot(ax - ex, ay - ey),
      `${label}: corner ${i} at (${ax}, ${ay}), expected (${ex}, ${ey})`,
    ).toBeLessThan(TOLERANCE);
  }
}

async function open(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto('/responsive.html');
  await page.evaluate(() => (window as never as Record<string, Promise<boolean>>)['__ready']);
}

/** Resize and wait for the element to settle on the expected variant. */
async function resizeTo(page: Page, width: number, height: number, media: string | undefined) {
  await page.setViewportSize({ width, height });
  await expect
    .poll(() => call<{ media?: string }>(page, '__variant').then((v) => v.media ?? null))
    .toBe(media ?? null);
}

test('renders the unconditional variant when no query matches', async ({ page }) => {
  await open(page, 1200, 800);

  const variant = await call<{ media?: string; flat: boolean }>(page, '__variant');
  expect(variant.media).toBeUndefined();
  expect(variant.flat).toBe(false);
  await expectProbesOnSurface(page, 'default');
});

test('swaps variants when the viewport crosses a breakpoint', async ({ page }) => {
  await open(page, 1200, 800);
  await resizeTo(page, 800, 800, '(max-width: 900px)');

  // The variant asks for cover at the right-hand edge of the photo.
  expect(await call<string>(page, '__imageObjectPosition')).toBe('100% 50%');

  // 1600x1000 photo covering an 800x800 box scales by 0.8 to 1280x800, and
  // anchoring right puts its left edge 480px off-screen. That number is what the
  // *maths* believes; the assertion above is what the *photo* is doing.
  const rect = await call<{ x: number; width: number }>(page, '__layout').then(
    (layout) => (layout as unknown as { imageRect: { x: number; width: number } }).imageRect,
  );
  expect(rect.width).toBeCloseTo(1280, 6);
  expect(rect.x).toBeCloseTo(-480, 6);

  await expectProbesOnSurface(page, 'cover at 800px');

  // And back again.
  await resizeTo(page, 1200, 800, undefined);
  expect(await call<string>(page, '__imageObjectPosition')).toBe('50% 50%');
  await expectProbesOnSurface(page, 'back to default');
});

test('moves the photo and the surfaces together for object-position', async ({ page }) => {
  // The regression this exists for: the transform maths read the attribute while
  // the photo was positioned from a custom property nothing ever set, so the crop
  // and the surfaces disagreed.
  await open(page, 1200, 600);

  await call(page, '__setObjectPosition', 'left');
  expect(await call<string>(page, '__imageObjectPosition')).toBe('0% 50%');
  let rect = await call<{ imageRect: { x: number } }>(page, '__layout');
  expect(rect.imageRect.x).toBeCloseTo(0, 6);
  await expectProbesOnSurface(page, 'object-position left');

  // contain scales 1600x1000 by 0.6 into 1200x600, leaving 240px of slack that
  // anchoring right must take up entirely.
  await call(page, '__setObjectPosition', 'right');
  expect(await call<string>(page, '__imageObjectPosition')).toBe('100% 50%');
  rect = await call<{ imageRect: { x: number } }>(page, '__layout');
  expect(rect.imageRect.x).toBeCloseTo(240, 6);
  await expectProbesOnSurface(page, 'object-position right');
});

test('lets the CSS custom property win, so a media query can drive the crop', async ({ page }) => {
  await open(page, 1200, 600);

  await call(page, '__setObjectPosition', 'left');
  await call(page, '__setCssObjectPosition', '100% 50%');

  expect(await call<string>(page, '__imageObjectPosition')).toBe('100% 50%');
  const layout = await call<{ imageRect: { x: number } }>(page, '__layout');
  expect(layout.imageRect.x).toBeCloseTo(240, 6);
  await expectProbesOnSurface(page, 'custom property overrides attribute');
});

test('lets a page overrule a manifest that asks for flat', async ({ page }) => {
  // Flat is opt-in, but a page consuming someone else's manifest needs to be able
  // to say no. `flat="false"` is an opt-out rather than the attribute simply
  // being present, which would read as "flat" and mean the opposite.
  await open(page, 1200, 800);
  await resizeTo(page, 420, 800, '(max-width: 500px)');
  expect(await call<boolean>(page, '__isFlat')).toBe(true);

  await call(page, '__setFlat', 'false');
  expect(await call<boolean>(page, '__isFlat')).toBe(false);
  expect(await call<string>(page, '__surfaceTransform')).not.toBe('none');
  await expectProbesOnSurface(page, 'projection forced on at 420px');

  // And the bare attribute still forces it the other way, at any width.
  await resizeTo(page, 1200, 800, undefined);
  await call(page, '__setFlat', '');
  expect(await call<boolean>(page, '__isFlat')).toBe(true);
});

test('drops the projection in flat mode but keeps the content usable', async ({ page }) => {
  await open(page, 1200, 800);
  await resizeTo(page, 420, 800, '(max-width: 500px)');

  expect(await call<boolean>(page, '__isFlat')).toBe(true);
  // No transform at all, rather than a transform that happens to look upright.
  expect(await call<string>(page, '__surfaceTransform')).toBe('none');

  // The surface is still reported, saying how it is placed rather than
  // disappearing from the layout — but with no transform to describe.
  const layout = await call<{
    surfaces: { placement: unknown; matrix3d: string }[];
    imageRect: { width: number };
  }>(page, '__layout');
  expect(layout.surfaces).toHaveLength(1);
  expect(layout.surfaces[0]!.placement).toBe('flow');
  expect(layout.surfaces[0]!.matrix3d).toBe('');
  expect(layout.imageRect.width).toBeGreaterThan(0);

  await expect(page.locator('#hit')).toBeVisible();
  await page.locator('#hit').click();
  expect(await page.evaluate(() => (window as never as Record<string, number>)['__hits'])).toBe(1);

  // Leaving flat mode must restore a real projection.
  await resizeTo(page, 1200, 800, undefined);
  expect(await call<boolean>(page, '__isFlat')).toBe(false);
  expect(await call<string>(page, '__surfaceTransform')).not.toBe('none');
  await expectProbesOnSurface(page, 'after leaving flat');
});

test('stops clipping a surface once it floats off the object', async ({ page }) => {
  // `clip` means "stay inside the object this was marked onto". While projected
  // that is the whole point — content must not spill past the laptop's screen.
  await open(page, 1200, 800);
  expect(await call<string>(page, '__surfaceOverflow')).toBe('hidden');

  // Floated, the surface is no longer on that object: it is a box the art
  // direction chose, and clipping it there silently eats everything a card
  // paints outside its own bounds — drop shadow, glow, focus ring. A page can
  // add `overflow: hidden` to its own slotted element; it cannot remove one
  // imposed inside this shadow root, so visible is the only workable default.
  await resizeTo(page, 360, 800, '(max-width: 380px)');
  const layout = await call<{ surfaces: { placement: unknown }[] }>(page, '__layout');
  expect(layout.surfaces[0]!.placement).toEqual({ rect: [0.1, 0.1, 0.8, 0.2] });
  expect(await call<string>(page, '__surfaceOverflow')).toBe('visible');

  // And the clip comes back with the projection.
  await resizeTo(page, 1200, 800, undefined);
  expect(await call<string>(page, '__surfaceOverflow')).toBe('hidden');
});
