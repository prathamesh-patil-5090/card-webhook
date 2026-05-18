import { launchBrowser, type BrowserHandle } from "./browser";

async function captureCardPngOnPage(
  page: Awaited<ReturnType<BrowserHandle["newPage"]>>,
  html: string,
): Promise<Buffer> {
  await page.setViewport({
    width: 400,
    height: 900,
    deviceScaleFactor: 2,
  });
  await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);

  await page.addStyleTag({
    content: `
        html, body {
          background: #fff !important;
          padding: 0 !important;
          margin: 0 !important;
          min-height: 0 !important;
          display: block !important;
        }
        .card {
          margin: 0 !important;
        }
      `,
  });

  const card = await page.$(".card");
  if (!card) {
    throw new Error("Card element .card not found in event pass template.");
  }

  const screenshot = await card.screenshot({ type: "png" });
  return Buffer.from(screenshot);
}

/** Renders the pass page, then crops to `.card` only (no body padding/background). */
export async function captureCardPng(html: string): Promise<Buffer> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    return await captureCardPngOnPage(page, html);
  } finally {
    await browser.close();
  }
}

/** Reuses an open browser (for bulk spreadsheet processing). */
export async function captureCardPngWithBrowser(
  browser: BrowserHandle,
  html: string,
): Promise<Buffer> {
  const page = await browser.newPage();

  try {
    return await captureCardPngOnPage(page, html);
  } finally {
    await page.close();
  }
}
