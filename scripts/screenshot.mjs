#!/usr/bin/env node
/**
 * Screenshot a running example. Handy when working on the transform maths, where
 * "looks right" is a genuine part of the acceptance criteria.
 *
 *   node scripts/screenshot.mjs http://localhost:5180/ out.png [width] [height]
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const [url, out, width = '1280', height = '900'] = positional;
const click = flag('click');

if (!url || !out) {
  console.error(
    'usage: node scripts/screenshot.mjs <url> <out.png> [width] [height] [--click <selector>]',
  );
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  deviceScaleFactor: 2,
});

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.log(`[${message.type()}]`, message.text());
  }
});
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// Comma-separated selectors are clicked in order, so a short flow can be
// captured in one shot.
for (const selector of click ? click.split(',') : []) {
  await page.click(selector.trim());
  await page.waitForTimeout(600);
}

await page.screenshot({ path: out });
await browser.close();

console.log('saved', out);
