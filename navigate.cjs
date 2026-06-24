const puppeteer = require('puppeteer');

(async () => {
  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: 'ws://127.0.0.1:34893'
    });
    const page = await browser.newPage();
    console.log('Navigating...');
    await page.goto('http://localhost:57598/', {waitUntil: 'networkidle0'});
    console.log('Navigated. Waiting...');
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({path: 'screenshot.png', fullPage: true});
    console.log('Screenshot taken.');
  } catch (e) {
    console.error(e);
  } finally {
    if (browser) await browser.close();
  }
})();
