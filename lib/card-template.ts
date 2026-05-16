import { readFile } from "fs/promises";
import path from "path";
import { escapeHtml } from "./escape-html";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public",
  "page",
  "event_pass_page.html",
);

export async function buildCardHtml(
  name: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const template = await readFile(TEMPLATE_PATH, "utf-8");
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  return template
    .replaceAll("{{USER_NAME}}", escapeHtml(name))
    .replaceAll("{{USER_IMAGE}}", dataUrl);
}
