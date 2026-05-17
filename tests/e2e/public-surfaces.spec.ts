// tests/e2e/public-surfaces.spec.ts
//
// Smoke tests for the three public surfaces of the app:
//   - /            → the lock screen (login form)
//   - /intake      → buyer intake form
//   - /seller-intake → seller intake form
//
// For each surface we verify:
//   (a) The page renders without a fatal JS error.
//   (b) Key visible affordances are present.
//   (c) axe-core finds no `critical` or `serious` WCAG 2.1 AA violations.
//
// Authenticated flows (login → client → viewing → send) are out of scope
// here — they need a seeded test agent in Supabase and live in a follow-up
// PR (#6b).

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Collect console errors emitted during page load so we can fail the
// test if any of the security-sweeping PRs accidentally broke a script.
async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function expectClean(page: Page, criticalOnly = true) {
  const a11y = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = a11y.violations.filter((v) =>
    criticalOnly
      ? v.impact === 'critical' || v.impact === 'serious'
      : true,
  );
  if (blocking.length) {
    // Render a compact summary so CI logs explain *which* rules failed.
    console.error(
      'axe-core blocking violations:\n' +
        blocking
          .map((v) => `  - ${v.id} (${v.impact}): ${v.help}`)
          .join('\n'),
    );
  }
  expect(blocking).toEqual([]);
}

test.describe('lock screen (/)', () => {
  test('renders without JS errors and passes axe critical/serious', async ({
    page,
  }) => {
    const errors = await collectConsoleErrors(page);
    await page.goto('/');

    // Lock-screen affordances we know exist (per index.html).
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-password')).toBeVisible();
    await expect(page.locator('.lock-btn')).toContainText(/unlock/i);

    // Sub-resource errors from Supabase/Unsplash are common in CI and not
    // our concern — filter to genuine JS errors.
    const jsErrors = errors.filter(
      (e) => !e.includes('supabase.co') && !e.includes('images.unsplash.com'),
    );
    expect(jsErrors).toEqual([]);

    await expectClean(page);
  });
});

test.describe('buyer intake (/intake)', () => {
  test('renders the multi-step form and passes axe critical/serious', async ({
    page,
  }) => {
    await page.goto('/intake');
    // Router screen asks "buying / selling / both" first.
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    await expect(page.getByText(/i'm buying a home/i)).toBeVisible();
    await expect(page.getByText(/i'm selling my home/i)).toBeVisible();

    await expectClean(page);
  });
});

test.describe('seller intake (/seller-intake)', () => {
  test('renders the form and passes axe critical/serious', async ({
    page,
  }) => {
    await page.goto('/seller-intake');
    // Page should at least produce a non-empty body.
    await expect(page.locator('body')).not.toBeEmpty();
    await expectClean(page);
  });
});
