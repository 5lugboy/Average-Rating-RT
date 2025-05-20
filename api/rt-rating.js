const puppeteer = require('puppeteer-core');
const chrome = require('chrome-aws-lambda');

module.exports = async (req, res) => {
  const slug = req.query.movie;
  if (!slug) return res.status(400).json({ error: "Missing movie slug" });

  const url = `https://www.rottentomatoes.com/m/${slug}/reviews`;

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chrome.args,
      executablePath: await chrome.executablePath,
      headless: chrome.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Click Load More until gone
    let clicked = 0;
    while (clicked < 25) {
      const button = await page.$('rt-button[data-qa="load-more-btn"]');
      if (!button) break;
      await button.evaluate(b => b.click());
      await page.waitForTimeout(1200);
      clicked++;
    }

    const bodyText = await page.evaluate(() => document.body.innerText);
    await browser.close();

    const matches = bodyText.match(/Original Score:\\s*([A-F][+-]?|\\d+(\\.\\d+)?\\/10|\\d+(\\.\\d+)?\\/5|\\d+(\\.\\d+)?\\/4)/gi) || [];

    const gradeMap = {
      'A+': 10, 'A': 9.5, 'A-': 9,
      'B+': 8.5, 'B': 8, 'B-': 7.5,
      'C+': 7, 'C': 6.5, 'C-': 6,
      'D+': 5.5, 'D': 5, 'F': 3
    };

    const convert = rating => {
      rating = rating.trim().toUpperCase();
      if (rating.includes("/10")) return Math.min(parseFloat(rating), 10);
      if (rating.includes("/5")) return Math.min(parseFloat(rating) * 2, 10);
      if (rating.includes("/4")) return Math.min(parseFloat(rating) * 2.5, 10);
      return gradeMap[rating] ?? null;
    };

    const scores = matches.map(m => convert(m.split(":")[1])).filter(x => x !== null);
    const average = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate');
    res.json({ average: parseFloat(average), count: scores.length, slug });

  } catch (e) {
    if (browser) await browser.close();
    res.status(500).json({ error: e.message });
  }
};
