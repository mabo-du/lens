const puppeteer = require('puppeteer');

(async () => {
  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: 'ws://127.0.0.1:34893'
    });
    const page = await browser.newPage();
    await page.goto('http://localhost:57598/', {waitUntil: 'networkidle0'});
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({path: 'screenshot.png', fullPage: true});
  } catch (e) {
    console.error(e);
  } finally {
    if (browser) await browser.close();
  }
})();
