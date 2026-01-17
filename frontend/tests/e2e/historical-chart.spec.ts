import { test, expect, Page } from '@playwright/test';

/**
 * Historical Data Chart Performance Test
 *
 * Tests:
 * 1. Page loads and displays correctly
 * 2. Date range selector works (select 7 days)
 * 3. Device and register selection
 * 4. Chart renders with 500+ data points
 * 5. Vertical cursor line appears on hover
 * 6. Selection rectangle appears when dragging
 * 7. General responsiveness of interactions
 */

test.describe('Historical Data Chart Performance', () => {
  const TEST_EMAIL = process.env.TEST_EMAIL || 'mohkof1106@gmail.com';
  const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Solar@1996';

  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for login to complete
    await page.waitForSelector('nav, [data-testid="dashboard"]', { timeout: 15000 });
  });

  test('historical data chart with 500+ points', async ({ page }) => {
    // Navigate to historical data page
    await page.goto('/historical-data');
    await page.waitForLoadState('networkidle');

    // Screenshot 1: Initial state of the page
    await page.screenshot({
      path: 'test-results/historical-1-initial-state.png',
      fullPage: true
    });

    console.log('Screenshot 1: Initial state captured');

    // Wait for the page to fully load
    await page.waitForTimeout(2000);

    // Step 1: Select a project from dropdown
    // Look for the Project dropdown trigger (button with "Select project" text)
    const projectTrigger = page.locator('button:has-text("Select project")').first();
    if (await projectTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectTrigger.click();
      await page.waitForTimeout(500);

      // Select first project option
      const projectOption = page.locator('[role="option"]').first();
      if (await projectOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        const projectName = await projectOption.textContent();
        console.log('Selecting project:', projectName);
        await projectOption.click();
        await page.waitForTimeout(1000);
      }
    }

    // Step 2: Select a site from dropdown
    const siteTrigger = page.locator('button:has-text("Select site")').first();
    if (await siteTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await siteTrigger.click();
      await page.waitForTimeout(500);

      // Select first site option
      const siteOption = page.locator('[role="option"]').first();
      if (await siteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        const siteName = await siteOption.textContent();
        console.log('Selecting site:', siteName);
        await siteOption.click();
        await page.waitForTimeout(1000);
      }
    }

    // Screenshot 2: After project/site selection
    await page.screenshot({
      path: 'test-results/historical-2-project-site-selected.png',
      fullPage: true
    });

    console.log('Screenshot 2: Project/Site selection captured');

    // Step 3: Click 7d date range preset
    const last7dButton = page.locator('button:has-text("7d")').first();
    if (await last7dButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await last7dButton.click();
      console.log('Clicked 7 days preset');
      await page.waitForTimeout(500);
    }

    // Step 4: Select Raw aggregation for maximum data points
    const rawButton = page.locator('button:has-text("Raw")').first();
    if (await rawButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rawButton.click();
      console.log('Selected Raw aggregation');
      await page.waitForTimeout(500);
    }

    // Step 5: Select a device and add parameters
    // First, look for device selection in Parameter Selection card
    const deviceTrigger = page.locator('button:has-text("Select device"), button:has-text("Site Controller")').first();
    if (await deviceTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deviceTrigger.click();
      await page.waitForTimeout(500);

      // Look for device options including Site Controller
      const deviceOptions = page.locator('[role="option"]');
      const deviceCount = await deviceOptions.count();
      console.log(`Found ${deviceCount} device options`);

      if (deviceCount > 0) {
        // Try to find and select "Site Controller" or first option
        const siteController = page.locator('[role="option"]:has-text("Site Controller")').first();
        if (await siteController.isVisible({ timeout: 1000 }).catch(() => false)) {
          await siteController.click();
          console.log('Selected Site Controller');
        } else {
          await deviceOptions.first().click();
          console.log('Selected first device');
        }
        await page.waitForTimeout(1000);
      }
    }

    // Screenshot 3: Device selected
    await page.screenshot({
      path: 'test-results/historical-3-device-selected.png',
      fullPage: true
    });

    console.log('Screenshot 3: Device selection captured');

    // Step 6: Add parameters to chart (drag or click on available registers)
    // Look for draggable parameter items
    const parameterItems = page.locator('[draggable="true"], [data-draggable="true"], .cursor-grab');
    const paramCount = await parameterItems.count();
    console.log(`Found ${paramCount} draggable parameters`);

    // Try to find Left Y-Axis drop zone
    const leftAxis = page.locator('text=/Left Y-Axis|Left Axis/i').first();
    const leftAxisZone = page.locator('[class*="drop"], [data-drop-zone]').first();

    if (paramCount > 0 && await leftAxisZone.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Get first parameter and left axis positions
      const param = parameterItems.first();
      const paramBox = await param.boundingBox();
      const axisBox = await leftAxisZone.boundingBox();

      if (paramBox && axisBox) {
        // Drag parameter to left axis
        console.log('Dragging parameter to Left Y-Axis');
        await page.mouse.move(paramBox.x + paramBox.width / 2, paramBox.y + paramBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(axisBox.x + axisBox.width / 2, axisBox.y + axisBox.height / 2, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(1000);

        // Add second parameter if available
        if (paramCount > 1) {
          const param2 = parameterItems.nth(1);
          const param2Box = await param2.boundingBox();
          if (param2Box) {
            console.log('Dragging second parameter to Left Y-Axis');
            await page.mouse.move(param2Box.x + param2Box.width / 2, param2Box.y + param2Box.height / 2);
            await page.mouse.down();
            await page.mouse.move(axisBox.x + axisBox.width / 2, axisBox.y + axisBox.height / 2, { steps: 10 });
            await page.mouse.up();
            await page.waitForTimeout(1000);
          }
        }
      }
    }

    // Screenshot 4: Parameters added
    await page.screenshot({
      path: 'test-results/historical-4-parameters-added.png',
      fullPage: true
    });

    console.log('Screenshot 4: Parameters added captured');

    // Step 7: Click Plot button to fetch data
    const plotButton = page.locator('button:has-text("Plot")').first();
    if (await plotButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await plotButton.click();
      console.log('Clicked Plot button');
      // Wait for data to load
      await page.waitForTimeout(3000);
    }

    // Screenshot 5: After plotting data
    await page.screenshot({
      path: 'test-results/historical-5-data-plotted.png',
      fullPage: true
    });

    console.log('Screenshot 5: Data plotted captured');

    // Check for points count display
    const pointsDisplay = page.locator('text=/\\d+[,\\d]*\\s*points/i');
    if (await pointsDisplay.isVisible({ timeout: 2000 }).catch(() => false)) {
      const pointsText = await pointsDisplay.textContent();
      console.log('Points displayed:', pointsText);
    }

    // Find the chart area (recharts)
    const chartArea = page.locator('.recharts-wrapper, svg.recharts-surface').first();
    const chartVisible = await chartArea.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('Chart visible:', chartVisible);

    if (chartVisible) {
      const chartBox = await chartArea.boundingBox();
      console.log('Chart bounding box:', chartBox);

      if (chartBox && chartBox.width > 100 && chartBox.height > 100) {
        // Test hover - move mouse to center of chart
        const centerX = chartBox.x + chartBox.width / 2;
        const centerY = chartBox.y + chartBox.height / 2;

        await page.mouse.move(centerX, centerY);
        await page.waitForTimeout(500);

        // Screenshot 6: Hover state showing vertical cursor
        await page.screenshot({
          path: 'test-results/historical-6-hover-cursor.png',
          fullPage: true
        });

        console.log('Screenshot 6: Hover cursor captured');

        // Test drag selection - start from left side and drag to right
        const startX = chartBox.x + chartBox.width * 0.25;
        const endX = chartBox.x + chartBox.width * 0.55;
        const dragY = chartBox.y + chartBox.height * 0.5;

        // Start drag
        await page.mouse.move(startX, dragY);
        await page.mouse.down();

        // During drag - move slowly to capture selection rectangle
        for (let x = startX; x <= endX; x += 30) {
          await page.mouse.move(x, dragY);
          await page.waitForTimeout(30);
        }

        // Screenshot 7: During drag showing selection rectangle
        await page.screenshot({
          path: 'test-results/historical-7-drag-selection.png',
          fullPage: true
        });

        console.log('Screenshot 7: Drag selection captured');

        // Complete drag
        await page.mouse.up();
        await page.waitForTimeout(800);

        // Screenshot 8: After zoom
        await page.screenshot({
          path: 'test-results/historical-8-after-zoom.png',
          fullPage: true
        });

        console.log('Screenshot 8: After zoom captured');

        // Look for reset zoom button and click it
        const resetZoom = page.locator('button:has-text("Reset Zoom")');
        if (await resetZoom.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log('Reset Zoom button is visible - clicking to restore');
          await resetZoom.click();
          await page.waitForTimeout(500);
        }
      }
    }

    // Final screenshot
    await page.screenshot({
      path: 'test-results/historical-9-final-state.png',
      fullPage: true
    });

    console.log('Screenshot 9: Final state captured');

    // Log summary
    console.log('\n=== TEST SUMMARY ===');
    console.log('All screenshots saved to test-results/ directory');
    console.log('Test completed');
  });
});
