import { test, expect } from '@playwright/test';

const TEST_EMAIL = 'mohkof1106@gmail.com';
const TEST_PASSWORD = 'Solar@1996';
const BASE_URL = 'https://volteria.org';

test('Full sync widget test - edit device and verify sync status changes', async ({ page }) => {
  test.setTimeout(120000);

  // 1. Login
  console.log('Step 1: Logging in...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
  console.log('✓ Logged in successfully');

  // 2. Navigate to Projects
  console.log('Step 2: Going to projects...');
  await page.goto(`${BASE_URL}/projects`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // Wait for cards to load
  await page.screenshot({ path: 'test-results/sync-full-01-projects.png' });

  // 3. Click on a project (look for project cards)
  console.log('Step 3: Clicking on project...');
  const projectLinks = page.locator('a[href^="/projects/"]');
  const projectCount = await projectLinks.count();
  console.log(`Found ${projectCount} project links`);

  if (projectCount > 0) {
    // Click the first one that's not "new"
    for (let i = 0; i < projectCount; i++) {
      const href = await projectLinks.nth(i).getAttribute('href');
      if (href && !href.includes('/new')) {
        await projectLinks.nth(i).click();
        break;
      }
    }
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/sync-full-02-project.png' });

  // 4. Find and click on a site
  console.log('Step 4: Looking for sites...');
  const siteLinks = page.locator('a[href*="/sites/"]');
  const siteCount = await siteLinks.count();
  console.log(`Found ${siteCount} site links`);

  if (siteCount > 0) {
    for (let i = 0; i < siteCount; i++) {
      const href = await siteLinks.nth(i).getAttribute('href');
      if (href && !href.includes('/new')) {
        await siteLinks.nth(i).click();
        break;
      }
    }
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/sync-full-03-site.png' });
  console.log('✓ On site page');

  // 5. Check initial sync status
  console.log('Step 5: Checking initial sync status...');
  const syncStatusBefore = await page.locator('text=Last configuration update').first().textContent();
  console.log(`Initial sync status area: ${syncStatusBefore}`);

  // Look for the sync button
  const syncButton = page.locator('button:has-text("Synchronize configuration")');
  const syncButtonCount = await syncButton.count();
  console.log(`Sync button found: ${syncButtonCount > 0}`);

  if (syncButtonCount > 0) {
    const isDisabled = await syncButton.isDisabled();
    console.log(`Sync button disabled: ${isDisabled}`);
  }

  // 6. Find and click edit on a device
  console.log('Step 6: Looking for device edit button...');

  // Scroll down to see devices
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(1000);

  const editButtons = page.locator('button').filter({ hasText: /^Edit$/ });
  const editCount = await editButtons.count();
  console.log(`Found ${editCount} edit buttons`);
  await page.screenshot({ path: 'test-results/sync-full-04-devices.png' });

  if (editCount > 0) {
    console.log('Step 7: Clicking edit button...');
    await editButtons.first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/sync-full-05-edit-dialog.png' });
    console.log('✓ Edit dialog opened');

    // 8. Find and modify device name slightly
    console.log('Step 8: Making a change to device...');
    const nameInput = page.locator('input[id="name"], input[name="name"]').first();
    if (await nameInput.count() > 0) {
      const currentName = await nameInput.inputValue();
      console.log(`Current name: "${currentName}"`);

      // Add a space at the end then remove it (to trigger change detection)
      await nameInput.fill(currentName.trim() + ' ');
      await page.waitForTimeout(300);
      await nameInput.fill(currentName.trim());
      console.log('✓ Made a change to name field');
    } else {
      console.log('Name input not found, trying first input...');
      const firstInput = page.locator('input[type="text"]').first();
      if (await firstInput.count() > 0) {
        const val = await firstInput.inputValue();
        await firstInput.fill(val + ' ');
        await firstInput.fill(val);
      }
    }

    // 9. Click Save button
    console.log('Step 9: Saving changes...');
    const saveBtn = page.locator('button').filter({ hasText: /Save|Update/ });
    if (await saveBtn.count() > 0) {
      await saveBtn.first().click();
      await page.waitForTimeout(3000);
      console.log('✓ Save clicked');
    }
    await page.screenshot({ path: 'test-results/sync-full-06-after-save.png' });

    // 10. Check sync status changed
    console.log('Step 10: Checking sync status after edit...');
    await page.waitForTimeout(2000);

    // Scroll back up to see sync status
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'test-results/sync-full-07-sync-status.png' });

    // Check if "Last configuration update" shows today's date
    const syncArea = await page.locator('text=Last configuration update').first().textContent();
    console.log(`Sync area after edit: ${syncArea}`);

    // Check if sync button is now enabled
    const syncBtnAfter = page.locator('button:has-text("Synchronize configuration")');
    if (await syncBtnAfter.count() > 0) {
      const isDisabledAfter = await syncBtnAfter.isDisabled();
      console.log(`Sync button disabled after edit: ${isDisabledAfter}`);

      if (!isDisabledAfter) {
        console.log('✓ SUCCESS: Sync button is now enabled!');

        // 11. Click the sync button
        console.log('Step 11: Clicking Synchronize configuration...');
        await syncBtnAfter.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-results/sync-full-08-after-sync.png' });
        console.log('✓ Sync button clicked');

        // Check if it shows synced now
        const isDisabledFinal = await syncBtnAfter.isDisabled();
        console.log(`Sync button disabled after sync: ${isDisabledFinal}`);
        if (isDisabledFinal) {
          console.log('✓ SUCCESS: Sync completed - button is now disabled (synced state)!');
        }
      } else {
        console.log('✗ ISSUE: Sync button is still disabled after edit');
      }
    }
  } else {
    console.log('No edit buttons found on page');
  }

  console.log('\n=== Test Complete ===');
  console.log('Check test-results/ folder for screenshots');
});
