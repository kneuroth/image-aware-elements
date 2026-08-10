import { expect, test, type Page } from '@playwright/test';

/**
 * These tests exist to catch the one class of bug unit tests structurally cannot:
 * a matrix that is arithmetically correct but that browsers interpret differently
 * than intended — wrong column order, a doubled perspective divide, a
 * transform-origin drift.
 *
 * Every assertion compares where the browser *actually* painted a corner against
 * where the maths says it should be. Zero-sized probe elements are used because a
 * projective transform maps a point to a point, so a probe's bounding rect is the
 * projected corner exactly.
 */

/** Largest distance between measured and expected corners, in CSS pixels. */
const TOLERANCE = 1;

interface Measured {
  actual: [number, number][];
  expected: [number, number][];
}

async function measure(page: Page, selector: string, surfaceId: string): Promise<Measured> {
  return page.evaluate(
    ([sel, id]) => ({
      actual: (window as never as Record<string, (s: string) => [number, number][]>)['__probes']!(sel!),
      expected: (window as never as Record<string, (s: string) => [number, number][]>)['__expected']!(id!),
    }),
    [selector, surfaceId] as const,
  );
}

function expectCornersMatch({ actual, expected }: Measured, label: string): void {
  expect(actual, `${label}: probe count`).toHaveLength(4);
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = actual[i]!;
    const [ex, ey] = expected[i]!;
    expect(Math.hypot(ax - ex, ay - ey), `${label}: corner ${i} at (${ax}, ${ay}), expected (${ex}, ${ey})`)
      .toBeLessThan(TOLERANCE);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as never as Record<string, Promise<boolean>>)['__ready']);
  await expect(page.locator('#hit')).toBeVisible();
});

test('projects the design rect onto the marked corners', async ({ page }) => {
  expectCornersMatch(await measure(page, '[data-corner]', 'laptop-screen'), 'laptop');
});

test('projects a second surface independently', async ({ page }) => {
  expectCornersMatch(await measure(page, '[data-phone]', 'phone-screen'), 'phone');
});

test('stays locked to the surface across container sizes', async ({ page }) => {
  for (const [w, h] of [
    [400, 250],
    [1200, 750],
    [640, 900],
    [900, 300],
  ] as const) {
    await page.evaluate(
      ([width, height]) =>
        (window as never as Record<string, (w: number, h: number) => Promise<boolean>>)['__resize']!(
          width!,
          height!,
        ),
      [w, h] as const,
    );
    expectCornersMatch(await measure(page, '[data-corner]', 'laptop-screen'), `${w}x${h}`);
  }
});

test('tracks the cropped photo, not the element box, under fit=cover', async ({ page }) => {
  await page.evaluate(
    () => (window as never as Record<string, (f: string) => Promise<boolean>>)['__setFit']!('cover'),
  );

  // A square container against a 1.6:1 photo forces real cropping, so a naive
  // implementation that anchored to the element box would visibly drift here.
  await page.evaluate(
    () => (window as never as Record<string, (w: number, h: number) => Promise<boolean>>)['__resize']!(600, 600),
  );

  const rect = await page.evaluate(
    () => (window as never as Record<string, () => { imageRect: { x: number; width: number } }>)['__layout']!().imageRect,
  );
  expect(rect.width).toBeGreaterThan(600);
  expect(rect.x).toBeLessThan(0);

  expectCornersMatch(await measure(page, '[data-corner]', 'laptop-screen'), 'cover');
});

test('keeps content interactive through the transform', async ({ page }) => {
  // Hit-testing is done by the browser against the transformed geometry. If the
  // matrix were wrong in a way that still looked plausible, clicking the visible
  // button would miss.
  await page.locator('#hit').click();
  expect(await page.evaluate(() => (window as never as Record<string, number>)['__hits'])).toBe(1);

  const text = await page.locator('.content').innerText();
  expect(text).toContain('Selectable harness text');
});

test('renders without a doubled perspective divide', async ({ page }) => {
  // A parent `perspective` would apply the projective divide a second time. The
  // symptom is corners that are close but consistently wrong toward the far edge,
  // so compare the far corners specifically at a large size.
  await page.evaluate(
    () => (window as never as Record<string, (w: number, h: number) => Promise<boolean>>)['__resize']!(1400, 875),
  );
  const { actual, expected } = await measure(page, '[data-corner]', 'laptop-screen');

  // Corner 1 (top-right) is the most foreshortened in this scene.
  const [ax, ay] = actual[1]!;
  const [ex, ey] = expected[1]!;
  expect(Math.hypot(ax - ex, ay - ey)).toBeLessThan(TOLERANCE);
});

test('fills a viewport-pinned container instead of letterboxing', async ({ page }) => {
  // The full-page-background case: `position: fixed; inset: 0` leaves height
  // auto, and an aspect-ratio on the host would make that height determinate —
  // so the element would stop stretching and letterbox. Regression guard.
  const result = await page.evaluate(async () => {
    const host = document.createElement('image-surface');
    host.setAttribute('src', '/desk.svg');
    host.setAttribute('manifest', '/desk.surfaces.json');
    host.setAttribute('fit', 'cover');
    host.style.cssText = 'position: fixed; inset: 0;';
    document.body.append(host);

    await new Promise((resolve) => {
      host.addEventListener('image-surface-layout', resolve, { once: true });
      setTimeout(resolve, 3000);
    });

    return {
      height: host.getBoundingClientRect().height,
      width: host.getBoundingClientRect().width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(result.height).toBeCloseTo(result.viewportHeight, 0);
  expect(result.width).toBeCloseTo(result.viewportWidth, 0);
});

test('still takes its height from the photo when left unsized', async ({ page }) => {
  // The other half of the same trade-off: with no given height the element must
  // still size itself from the photo's aspect ratio.
  const ratio = await page.evaluate(async () => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'width: 640px;';
    const host = document.createElement('image-surface');
    host.setAttribute('src', '/desk.svg');
    host.setAttribute('manifest', '/desk.surfaces.json');
    wrapper.append(host);
    document.body.append(wrapper);

    await new Promise((resolve) => {
      host.addEventListener('image-surface-layout', resolve, { once: true });
      setTimeout(resolve, 3000);
    });

    const rect = host.getBoundingClientRect();
    return rect.width / rect.height;
  });

  // desk.svg is 1600x1000.
  expect(ratio).toBeCloseTo(1.6, 2);
});

test('exposes a layout with one entry per surface', async ({ page }) => {
  const layout = await page.evaluate(
    () =>
      (window as never as Record<string, () => { surfaces: { id: string; ok: boolean }[] }>)['__layout']!(),
  );
  expect(layout.surfaces.map((s) => s.id)).toEqual(['laptop-screen', 'phone-screen']);
  expect(layout.surfaces.every((s) => s.ok)).toBe(true);
});
