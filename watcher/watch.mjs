// The advisory watcher (spec §8, docs/bir-source.md, option A).
//
// The BIR home page draws its announcements with JavaScript and its content API
// refuses outside callers, so this opens the page once in headless Chromium,
// reads each "sentence + PDF link" pair from the announcements block, and posts
// them to the sync route, which does the rest.
//
//   SYNC_URL=https://status.kataxpayer.com/api/advisories/sync \
//   CRON_SECRET=... BIR_USER_AGENT=... node watch.mjs
//
// DRY_RUN=1 prints the pairs and posts nothing. Exits non-zero when the page
// yields no items or the route does not answer 200, so a silent break shows as
// a red run in GitHub Actions rather than an empty board.

import { chromium } from 'playwright';

const HOME = 'https://www.bir.gov.ph/home';
const BLOCK = 'div.text-description.richtext.prose';
const UA = process.env.BIR_USER_AGENT || 'KaTaxpayerStatusBot/1.0 (+https://status.kataxpayer.com/about)';
const dryRun = process.env.DRY_RUN === '1';

const browser = await chromium.launch();
let items = [];
try {
  const page = await browser.newPage({ userAgent: UA });
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(`${BLOCK} a[href*=".pdf" i]`, { timeout: 60_000 });

  // Walk the block in document order: the text since the last link is the title
  // of the next link. The block is hand-typed rich text, so nesting varies and
  // no element can be relied on to hold exactly one item.
  items = await page.$$eval(BLOCK, (blocks) => {
    const out = [];
    for (const block of blocks) {
      let text = '';
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A') {
          const href = node.href;
          if (/\.pdf(?:$|[?#])/i.test(href)) {
            const title = text.replace(/\s+/g, ' ').trim();
            if (title) out.push({ title, url: href });
            text = '';
          }
        }
        // A link's own text ("more") is not part of any title.
        if (node.nodeType === Node.TEXT_NODE && !node.parentElement?.closest('a')) {
          text += node.textContent;
        }
        if (node.nodeType === Node.ELEMENT_NODE && /^(P|DIV|LI|BR)$/.test(node.tagName)) text += ' ';
        node = walker.nextNode();
      }
    }
    return out;
  });
} finally {
  await browser.close();
}

console.log(`Read ${items.length} items from ${HOME}`);
if (!items.length) {
  console.error('No items found. The BIR page may have changed; see docs/bir-source.md.');
  process.exit(1);
}

if (dryRun) {
  console.log(JSON.stringify(items, null, 2));
  process.exit(0);
}

const { SYNC_URL, CRON_SECRET } = process.env;
if (!SYNC_URL || !CRON_SECRET) {
  console.error('Set SYNC_URL and CRON_SECRET.');
  process.exit(2);
}
const res = await fetch(SYNC_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
  body: JSON.stringify({ items }),
  signal: AbortSignal.timeout(120_000),
});
const body = await res.text();
console.log(`Sync answered ${res.status}: ${body}`);
if (!res.ok) process.exit(1);
