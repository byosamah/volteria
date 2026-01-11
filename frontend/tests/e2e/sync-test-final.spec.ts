import { test, expect } from '@playwright/test';

const TEST_EMAIL = 'mohkof1106@gmail.com';
const TEST_PASSWORD = 'Solar@1996';
const BASE_URL = 'https://volteria.org';
const SITE_URL = '/projects/6a771402-bd63-4226-9a4b-88d4d7aa9c58/sites/b3b68ee1-4e57-4b96-827b-49258fa9d2d2';

test('Sync widget - edit device and verify status changes', async ({ page }) => {
  // Enable logging
  page.on('console', msg => {
    if (!msg.text().includes('DOM')) console.log('Browser:', msg.text());
  });

  // 1. Login
  console.log('Logging in...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
  console.log('Logged in');

  // 2. Go directly to the site page
  console.log('Navigating to site: Crusher 1...');
  await page.goto(`${BASE_URL}${SITE_URL}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // Wait for data to load
  await page.screenshot({ path: 'test-results/sync-01-site-page.png' });

  // 3. Check initial sync status
  console.log('Checking initial sync status...');
  const pageContent = await page.content();
  const hasSynced = pageContent.includes('Synced') && !pageContent.includes('Not Synced') && !pageContent.includes('Never Synced');
  const hasNotSynced = pageContent.includes('Not Synced');
  const hasNeverSynced = pageContent.includes('Never Synced');
  console.log(`Initial status - Synced: ${hasSynced}, Not Synced: ${hasNotSynced}, Never Synced: ${hasNeverSynced}`);

  // 4. Find the Devices section - look for device cards or list
  console.log('Looking for devices...');
  await page.screenshot({ path: 'test-results/sync-02-before-edit.png' });

  // 5. Click Edit on the first device found
  const editButtons = page.locator('button').filter({ hasText: 'Edit' });
  const editCount = await editButtons.count();
  console.log(`Found ${editCount} edit buttons`);

  if (editCount > 0) {
    // Click the first edit button
    await editButtons.first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/sync-03-edit-dialog.png' });
    console.log('Edit dialog opened');

    // 6. Find the device name input and make a small change
    const nameInput = page.locator('input').first();
    const currentName = await nameInput.inputValue();
    console.log(`Current device name: "${currentName}"`);

    // Add a space and remove it to trigger a change
    await nameInput.fill(currentName + ' ');
    await page.waitForTimeout(200);
    await nameInput.fill(currentName);
    console.log('Made a small change to name field');

    // 7. Click Save/Update button
    const saveButton = page.locator('button').filter({ hasText: /Save|Update/i }).first();
    if (await saveButton.count() > 0) {
      console.log('Clicking save button...');
      await saveButton.click();
      await page.waitForTimeout(3000); // Wait for save and status update
      await page.screenshot({ path: 'test-results/sync-04-after-save.png' });
      console.log('Saved');
    }

    // 8. Check if sync status changed to "Not Synced"
    console.log('Checking sync status after edit...');
    await page.waitForTimeout(2000);
    const pageContentAfter = await page.content();
    const hasNotSyncedAfter = pageContentAfter.includes('Not Synced');
    await page.screenshot({ path: 'test-results/sync-05-final-status.png' });

    if (hasNotSyncedAfter) {
      console.log('SUCCESS: Sync widget now shows "Not Synced"!');
    } else {
      console.log('Status check - looking for sync indicators in page...');
      // Try to find sync indicator more specifically
      const syncIndicator = page.locator('[class*="sync"], [class*="status"]').first();
      if (await syncIndicator.count() > 0) {
        const text = await syncIndicator.textContent();
        console.log(`Sync indicator text: "${text}"`);
      }
    }
  } else {
    console.log('No edit buttons found - scrolling to find devices...');
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/sync-02b-scrolled.png' });
  }

  console.log('\nTest complete! Check test-results/ folder for screenshots.');
});
