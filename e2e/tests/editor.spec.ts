import { expect, test, type Page } from '@playwright/test';

/**
 * The editor is half the product, so these cover the marking loop itself rather
 * than the rendering maths (which projection.spec.ts already pins down).
 */

test.use({ baseURL: 'http://localhost:5190' });

/** Coordinate readout for one corner, as displayed in the inspector. */
async function corner(page: Page, index: number): Promise<[number, number]> {
  const row = page.locator('.coords-row').nth(index);
  const values = await row.locator('.coords-val').allInnerTexts();
  return [Number(values[0]), Number(values[1])];
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.register-item')).toHaveCount(2);
});

test('opens on the fixture with both surfaces marked', async ({ page }) => {
  await expect(page.locator('.register-item').first()).toContainText('laptop-screen');
  await expect(page.locator('.register-item').nth(1)).toContainText('phone-screen');
  await expect(page.locator('#status-validity')).toHaveText('convex — renderable');
  await expect(page.locator('#file-readout')).toContainText('1600×1000');
});

test('shows four crosshair handles on the selected surface only', async ({ page }) => {
  await expect(page.locator('.handle')).toHaveCount(4);

  await page.locator('.register-item').nth(1).click();
  await expect(page.locator('.handle')).toHaveCount(4);
  await expect(page.locator('.handle').first()).toHaveAttribute('data-surface', 'phone-screen');
});

test('dragging a corner updates its stored coordinate', async ({ page }) => {
  const before = await corner(page, 0);

  const handle = page.locator('.handle[data-corner="0"]');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();

  const after = await corner(page, 0);
  expect(after[0]).toBeGreaterThan(before[0]);
  expect(after[1]).toBeGreaterThan(before[1]);
  await expect(page.locator('#file-readout')).toContainText('unsaved');
});

test('the loupe appears while placing a corner', async ({ page }) => {
  const handle = page.locator('.handle[data-corner="1"]');
  const box = (await handle.boundingBox())!;

  await expect(page.locator('#loupe')).toBeHidden();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#loupe')).toBeVisible();
});

test('arrow keys nudge the active corner by a pixel', async ({ page }) => {
  const handle = page.locator('.handle[data-corner="0"]');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  const before = await corner(page, 0);
  await page.keyboard.press('ArrowRight');
  const after = await corner(page, 0);

  // One image pixel on a 1600px-wide photo.
  expect(after[0] - before[0]).toBeCloseTo(1 / 1600, 4);
});

test('the yaw slider re-projects the quad and keeps it renderable', async ({ page }) => {
  const before = await corner(page, 0);

  const slider = page.locator('#slider-yaw');
  await slider.evaluate((node: HTMLInputElement) => {
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    node.value = '10';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const after = await corner(page, 0);
  expect(after).not.toEqual(before);
  // Composing from a pose always projects a true rectangle, so the result must
  // stay a shape the renderer accepts.
  await expect(page.locator('#status-validity')).toHaveText('convex — renderable');
});

test('flags a quad dragged into a bowtie instead of rendering it', async ({ page }) => {
  // Drag the top-right corner past the bottom-left one to cross the edges.
  const handle = page.locator('.handle[data-corner="1"]');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 380, box.y + 330, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('#status-validity')).toHaveText('invalid quad');
  await expect(page.locator('.notice')).toContainText('convex');
  await expect(page.locator('.register-item').first().locator('.register-flag')).toBeVisible();
});

test('adds and deletes surfaces', async ({ page }) => {
  await page.locator('#add-surface').click();
  await expect(page.locator('.register-item')).toHaveCount(3);
  await expect(page.locator('.register-item[aria-selected="true"]')).toContainText('surface');

  await page.locator('button', { hasText: 'Delete surface' }).click();
  await expect(page.locator('.register-item')).toHaveCount(2);
});

test('preview renders the marking through the real element', async ({ page }) => {
  await page.locator('#mode-screens').click();
  await expect(page.locator('#preview-holder')).toBeVisible();

  const surface = page.locator('image-surface');
  await expect(surface).toHaveCount(1);
  // Patterns are slotted light-DOM children, one per marked surface.
  await expect(surface.locator('.pattern')).toHaveCount(2);

  const applied = await page.evaluate(() => {
    const host = document.querySelector('image-surface')!;
    const node = host.shadowRoot!.querySelector<HTMLElement>('[part="surface"]');
    return node?.style.transform ?? '';
  });
  expect(applied).toMatch(/^matrix3d\(/);
});

test('edits a viewport without ever writing a media query', async ({ page }) => {
  await page.locator('#mode-screens').click();
  await page.locator('#preview-presets .preset', { hasText: 'Phone' }).click();

  // The query is derived from the preset and explained, not typed.
  await expect(page.locator('.preview-summary')).toContainText('Applies below 480px');
  await expect(page.locator('#preview-presets .has-variant')).toHaveCount(0);

  // The variant appears on first edit, and the preset is marked as having one.
  await page.locator('button', { hasText: 'Frame all surfaces' }).click();
  await expect(page.locator('.preview-summary')).toContainText('Applies below 480px');
  await expect(page.locator('#preview-presets .has-variant')).toHaveCount(1);
});

test('frames every surface, and says when that leaves empty space', async ({ page }) => {
  await page.locator('#mode-screens').click();

  // 1024x640 holds both surfaces with photo to spare.
  await page.locator('#preview-presets .preset', { hasText: 'Laptop' }).click();
  await page.locator('button', { hasText: 'Frame all surfaces' }).click();
  await expect(page.locator('.preview-report .is-bad')).toHaveCount(0);

  // 390x844 needs to show more than the photo contains above and below them.
  // That is allowed — the photo simply stops filling the frame — but it is worth
  // saying, since on a page the background would show through.
  await page.locator('#preview-presets .preset', { hasText: 'Phone' }).click();
  await page.locator('button', { hasText: 'Frame all surfaces' }).click();
  await expect(page.locator('.preview-report .is-bad')).toHaveCount(0);
  await expect(page.locator('.preview-report')).toContainText('does not fill');
});

test('zooms out past the whole photo and pans without a fence', async ({ page }) => {
  await page.locator('#mode-screens').click();
  await page.locator('#preview-presets .preset', { hasText: 'Phone' }).click();

  const frame = (await page.locator('#preview-frame').boundingBox())!;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;

  await page.mouse.move(cx, cy);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);

  // Zoomed far enough out that the photo no longer covers the viewport at all,
  // which the old clamp made impossible.
  const shrunk = await page.evaluate(() => {
    const rect = document.querySelector('image-surface')!.layout!.imageRect;
    return { width: rect.width, height: rect.height };
  });
  expect(shrunk.width).toBeLessThan(390);
  expect(shrunk.height).toBeLessThan(844);

  // And it can be dragged off centre, including past the edges.
  await page.mouse.down();
  await page.mouse.move(cx - 100, cy - 160, { steps: 10 });
  await page.mouse.up();

  const moved = await page.evaluate(() => {
    const rect = document.querySelector('image-surface')!.layout!.imageRect;
    return { x: rect.x, y: rect.y };
  });
  expect(moved.y).toBeLessThan(200);
});

test('drops a surface out of the projection at one viewport only', async ({ page }) => {
  await page.locator('#mode-screens').click();
  await page.locator('#preview-presets .preset', { hasText: 'Phone' }).click();

  await page
    .locator('.register-item', { hasText: 'laptop-screen' })
    .locator('.register-placement')
    .selectOption('flow');

  await expect(page.locator('.preview-report')).toContainText('below the photo');

  const transform = await page.evaluate(() => {
    const host = document.querySelector('image-surface')!;
    const node = host.shadowRoot!.querySelector<HTMLElement>('[part="surface"][data-id="laptop-screen"]');
    return getComputedStyle(node!).transform;
  });
  expect(transform).toBe('none');

  // The base is untouched: this was a change to phones, not to the marking.
  await page.locator('#preview-presets .preset', { hasText: 'Desktop' }).click();
  await expect(
    page.locator('.register-item', { hasText: 'laptop-screen' }).locator('.register-placement'),
  ).toHaveValue('projected');
});

test('reports how small a surface renders at a phone viewport', async ({ page }) => {
  await page.locator('#mode-screens').click();
  await page.locator('#preview-presets .preset', { hasText: 'Phone' }).click();

  // The whole point of the preset: a 1280x800 design space on a 390px viewport
  // is unusable, and the editor should say so in real numbers.
  const report = page.locator('.preview-report');
  await expect(report).toContainText('laptop-screen');
  await expect(report.locator('.preview-line').first()).toContainText('renders at');
});

test('places and sizes a floating surface by dragging it', async ({ page }) => {
  await page.locator('#mode-screens').click();
  await page.locator('#preview-presets .preset', { hasText: 'Phone' }).click();
  await page
    .locator('.register-item', { hasText: 'laptop-screen' })
    .locator('.register-placement')
    .selectOption('float');

  const box = page.locator('.preview-float').first();
  await expect(box).toBeVisible();
  const before = (await box.boundingBox())!;

  // Move it up the viewport.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 - 120, {
    steps: 10,
  });
  await page.mouse.up();

  const moved = (await box.boundingBox())!;
  expect(moved.y).toBeLessThan(before.y - 40);
  expect(Math.abs(moved.width - before.width)).toBeLessThan(2);

  // Resize from the corner, which must change the size and not just the position.
  const handle = page.locator('.preview-float-handle.is-se').first();
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 60, grip.y + grip.height / 2, { steps: 10 });
  await page.mouse.up();

  const resized = (await box.boundingBox())!;
  expect(resized.width).toBeLessThan(moved.width - 20);

  // The element is really rendering it there, not just the editing overlay.
  const applied = await page.evaluate(() => {
    const host = document.querySelector('image-surface')!;
    const node = host.shadowRoot!.querySelector<HTMLElement>(
      '[part="surface"][data-id="laptop-screen"]',
    );
    return { placement: node?.dataset['placement'], width: node?.style.width };
  });
  expect(applied.placement).toBe('float');
  expect(applied.width).toMatch(/%$/);
});

test('keeps the design resolution matched to the quad as it is dragged', async ({ page }) => {
  // Regression: a new surface used to keep the resolution estimated from the
  // default starting box, so every marked surface was the wrong shape — and
  // therefore stretched its content — until "Match quad size" was pressed.
  await page.locator('#add-surface').click();
  const readout = page.locator('.register-item[aria-selected="true"] .register-res');
  const before = await readout.innerText();

  const grip = (await page.locator('.handle[data-corner="0"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 140, grip.y + grip.height / 2 + 60, {
    steps: 12,
  });
  await page.mouse.up();

  await expect(readout).not.toHaveText(before);
});
