import { test, expect } from '@playwright/test';

const TEST_EMAIL = 'mohkof1106@gmail.com';
const TEST_PASSWORD = 'Solar@1996';
const BASE_URL = 'https://volteria.org';

test('Sync widget test - edit device and check status', async ({ page }) => {
  // Enable console logging
  page.on('console', msg => console.log('Browser:', msg.text()));

  // 1. Login
  console.log('Step 1: Logging in...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
  console.log('Logged in successfully');

  // 2. Go to projects page
  console.log('Step 2: Navigating to projects...');
  await page.goto(`${BASE_URL}/projects`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/01-projects.png' });

  // 3. Click on first project (look for any clickable project link)
  console.log('Step 3: Clicking on project...');
  const projectLink = page.locator('a[href^="/projects/"]').first();
  await projectLink.click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/02-project-detail.png' });

  // 4. Find and click on a site
  console.log('Step 4: Finding site...');
  const siteLink = page.locator('a[href*="/sites/"]').first();
  if (await siteLink.count() > 0) {
    await siteLink.click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/03-site-page.png' });
    console.log('On site page');

    // 5. Check current sync status
    console.log('Step 5: Checking sync widget...');
    await page.waitForTimeout(2000);

    // Look for sync indicators
    const syncedText = await page.locator('text=Synced').count();
    const notSyncedText = await page.locator('text=Not Synced').count();
    const neverSyncedText = await page.locator('text=Never Synced').count();

    console.log(`Sync status - Synced: ${syncedText}, Not Synced: ${notSyncedText}, Never Synced: ${neverSyncedText}`);
    await page.screenshot({ path: 'test-results/04-sync-status.png' });

    // 6. Go to Devices tab
    console.log('Step 6: Looking for devices...');
    const devicesTab = page.locator('button:has-text("Devices"), a:has-text("Devices")').first();
    if (await devicesTab.count() > 0) {
      await devicesTab.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: 'test-results/05-devices.png' });

    // 7. Find edit button
    console.log('Step 7: Looking for edit button...');
    const editBtn = page.locator('button:has-text("Edit")').first();
    if (await editBtn.count() > 0) {
      console.log('Found edit button, clicking...');
      await editBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/06-edit-dialog.png' });

      // 8. Make a small change - find any input and modify slightly
      console.log('Step 8: Making a change...');

      // Try to find a text input we can modify
      const nameInput = page.locator('input[name="name"], input[placeholder*="name"]').first();
      if (await nameInput.count() > 0) {
        const currentValue = await nameInput.inputValue();
        await nameInput.fill(currentValue + ' ');
        await nameInput.fill(currentValue.trim()); // Change back to trigger update
        console.log('Modified name field');
      }

      // 9. Save
      console.log('Step 9: Saving...');
      const saveBtn = page.locator('button:has-text("Save"), button:has-text("Update")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(2000);
        console.log('Saved');
      }

      await page.screenshot({ path: 'test-results/07-after-save.png' });

      // 10. Check sync status changed
      console.log('Step 10: Checking sync status after edit...');
      await page.waitForTimeout(2000);

      const notSyncedAfter = await page.locator('text=Not Synced').count();
      console.log(`Not Synced indicators after edit: ${notSyncedAfter}`);
      await page.screenshot({ path: 'test-results/08-final-sync-status.png' });

      if (notSyncedAfter > 0) {
        console.log('SUCCESS: Sync widget shows "Not Synced" after device edit!');
      }
    } else {
      console.log('No edit button found');
    }
  } else {
    console.log('No site found');
  }

  console.log('Test complete - check screenshots in test-results/');
});
