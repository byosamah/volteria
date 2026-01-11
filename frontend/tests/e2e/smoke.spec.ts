import { test, expect } from '@playwright/test';

/**
 * Smoke Tests - Run before deploying to verify key functionality
 *
 * These tests verify:
 * 1. Login page loads
 * 2. Authentication works
 * 3. Main pages are accessible
 * 4. No console errors on key pages
 */

test.describe('Smoke Tests', () => {
  test('login page loads correctly', async ({ page }) => {
    await page.goto('/login');

    // Check page title or key elements
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in|log in|login/i })).toBeVisible();
  });

  test('login page has no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Filter out expected errors (like favicon 404)
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('Failed to load resource')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Authenticated Pages', () => {
  // Test credentials - use a test account
  const TEST_EMAIL = process.env.TEST_EMAIL || 'osamah96@gmail.com';
  const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

  test.skip(!process.env.TEST_PASSWORD, 'Skipping auth tests - TEST_PASSWORD not set');

  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for login to complete - look for dashboard element or navigation
    await page.waitForSelector('nav a[href="/projects"], [data-testid="dashboard"]', { timeout: 15000 });
  });

  test('projects page loads', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/projects/);

    // Should not show error state
    await expect(page.locator('text=Error')).not.toBeVisible();
  });

  test('alarms page loads', async ({ page }) => {
    await page.goto('/alarms');
    await expect(page).toHaveURL(/\/alarms/);

    // Should show alarms table or empty state
    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasEmptyState = await page.locator('text=/no.*alarm/i').isVisible().catch(() => false);

    expect(hasTable || hasEmptyState).toBeTruthy();
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
  });
});

test.describe('Build Verification', () => {
  test('static assets load correctly', async ({ page }) => {
    const failedRequests: string[] = [];

    page.on('requestfailed', request => {
      failedRequests.push(request.url());
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Filter out expected failures
    const criticalFailures = failedRequests.filter(url =>
      !url.includes('favicon') &&
      url.includes('_next') // Only care about Next.js assets
    );

    expect(criticalFailures).toHaveLength(0);
  });
});
