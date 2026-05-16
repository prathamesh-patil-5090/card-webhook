import { launchBrowser } from "./browser";

/** Renders the pass page, then crops to `.card` only (no body padding/background). */
export async function captureCardPng(html: string): Promise<Buffer> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
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
  } finally {
    await browser.close();
  }
}
