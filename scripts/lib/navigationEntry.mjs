import assert from 'node:assert/strict';

// Follow the site's actual entry path before running the shared estimator assertions.
export async function enterEstimator(page, {route, brand, parent}) {
  if (parent) return;
  if (['boise-handyman-co','handyman'].includes(brand) && (route === '/' || route === '/estimate')) {
    // The homepage links to the direct intake; /estimate already hosts it.
    if (route === '/') {
      await page.locator('a[href="/estimate"]').first().click();
      await page.waitForURL(url => url.pathname === '/estimate');
      assert.equal(new URL(page.url()).pathname, '/estimate');
    }
    await page.locator('[data-p5-estimator]').first().waitFor();
  } else if (['boise-remodeling-co','remodeling'].includes(brand) && route === '/') {
    await page.locator('a[href="/#request"]:visible').first().click();
    await page.locator('#request-form form').first().waitFor();
  } else if (route === '/') {
    await page.locator('#calculator').first().scrollIntoViewIfNeeded();
  }
}
