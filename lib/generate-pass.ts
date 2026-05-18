import { buildCardHtml } from "./card-template";
import { sendEventPassEmail, type EmailSendResult } from "./email";
import {
  assertAllowedImageType,
  fetchImageFromUrl,
} from "./fetch-image";
import { captureCardPngWithBrowser } from "./screenshot";
import { launchBrowser, type BrowserHandle } from "./browser";

export type ProcessEntryResult = {
  row: number;
  name: string;
  email: string;
  success: boolean;
  error?: string;
  delivery?: EmailSendResult;
};

export async function processSpreadsheetEntry(
  browser: BrowserHandle,
  entry: { row: number; name: string; email: string; imageUrl: string },
): Promise<ProcessEntryResult> {
  const base = {
    row: entry.row,
    name: entry.name,
    email: entry.email,
  };

  try {
    const { buffer, mimeType } = await fetchImageFromUrl(entry.imageUrl);
    assertAllowedImageType(mimeType);

    const html = await buildCardHtml(entry.name, buffer, mimeType);
    const pngBuffer = await captureCardPngWithBrowser(browser, html);
    const delivery = await sendEventPassEmail(entry.email, entry.name, pngBuffer);

    return {
      ...base,
      success: true,
      delivery,
    };
  } catch (error) {
    return {
      ...base,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function processSpreadsheetEntries(
  entries: Array<{ row: number; name: string; email: string; imageUrl: string }>,
): Promise<ProcessEntryResult[]> {
  const browser = await launchBrowser();

  try {
    const results: ProcessEntryResult[] = [];

    for (const entry of entries) {
      results.push(await processSpreadsheetEntry(browser, entry));
    }

    return results;
  } finally {
    await browser.close();
  }
}
