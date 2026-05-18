import * as XLSX from "xlsx";

export type SpreadsheetEntry = {
  row: number;
  name: string;
  email: string;
  imageUrl: string;
};

export type ParseSpreadsheetResult = {
  entries: SpreadsheetEntry[];
  skipped: Array<{ row: number; reason: string }>;
};

const NAME_KEYS = ["name", "full name", "fullname", "attendee", "guest name"];
const EMAIL_KEYS = ["email", "e-mail", "mail"];
const IMAGE_KEYS = [
  "photo url",
  "photourl",
  "photo",
  "image url",
  "imageurl",
  "image",
  "picture",
  "photo link",
  "image link",
  "avatar",
  "avatar url",
];

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickValue(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  const normalizedRow = new Map<string, unknown>();

  for (const [key, value] of Object.entries(row)) {
    normalizedRow.set(normalizeHeader(key), value);
  }

  for (const key of keys) {
    const value = normalizedRow.get(key);
    if (value === undefined || value === null || value === "") continue;

    const text = String(value).trim();
    if (text) return text;
  }

  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isProbablyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function parseSpreadsheetBuffer(buffer: Buffer): ParseSpreadsheetResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("Spreadsheet is empty.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  if (rows.length === 0) {
    throw new Error("Spreadsheet has no data rows.");
  }

  const entries: SpreadsheetEntry[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = pickValue(row, NAME_KEYS);
    const email = pickValue(row, EMAIL_KEYS);
    const imageUrl = pickValue(row, IMAGE_KEYS);

    if (!name && !email && !imageUrl) {
      return;
    }

    if (!name) {
      skipped.push({ row: rowNumber, reason: "Missing name." });
      return;
    }

    if (!email || !isValidEmail(email)) {
      skipped.push({ row: rowNumber, reason: "Invalid or missing email." });
      return;
    }

    if (!imageUrl || !isProbablyUrl(imageUrl)) {
      skipped.push({
        row: rowNumber,
        reason: "Invalid or missing photo URL.",
      });
      return;
    }

    entries.push({
      row: rowNumber,
      name,
      email,
      imageUrl,
    });
  });

  if (entries.length === 0) {
    throw new Error(
      "No valid rows found. Expected columns like Name, Email, and Photo URL.",
    );
  }

  return { entries, skipped };
}
