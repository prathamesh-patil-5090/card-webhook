import chromium from "@sparticuz/chromium-min";
import puppeteerCore, { type Browser } from "puppeteer-core";

export type BrowserHandle = Browser;

const isServerless =
  process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

/** Hosted pack — avoids bundling bin/ into the serverless function. */
const CHROMIUM_PACK_URL =
  process.env.CHROMIUM_PACK_URL ??
  "https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar";

export async function launchBrowser(): Promise<Browser> {
  if (isServerless) {
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);

    return puppeteerCore.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
  }

  const puppeteer = await import("puppeteer");
  return puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}
