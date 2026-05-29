import { parseSpreadsheetBuffer } from "@/lib/excel-entries";
import {
  processConfirmationEmails,
  type EmailEntry,
} from "@/lib/process-confirmation-emails";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, Accept, Origin",
};

const ACCEPTED_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);
const ACCEPTED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "application/octet-stream",
]);

function jsonWithCors(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function isAuthorized(request: NextRequest): boolean {
  const requiredKey = process.env.BULK_API_KEY?.trim();
  if (!requiredKey) return true;

  const header =
    request.headers.get("authorization")?.trim() ||
    request.headers.get("x-api-key")?.trim();

  if (!header) return false;

  if (header === requiredKey) return true;
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === requiredKey;
  }

  return false;
}

function getSpreadsheetFile(formData: FormData): File | null {
  for (const key of ["file", "spreadsheet", "excel", "xlsx"]) {
    const value = formData.get(key);
    if (value instanceof File && value.size > 0) {
      return value;
    }
  }

  return null;
}

function isAcceptedFile(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (ACCEPTED_EXTENSIONS.has(extension)) return true;
  if (!file.type) return true;
  return ACCEPTED_MIME_TYPES.has(file.type);
}

function parseEmailEntriesFromSpreadsheet(buffer: Buffer): {
  entries: EmailEntry[];
  skipped: Array<{ row: number; reason: string }>;
} {
  const { entries: rawEntries, skipped } = parseSpreadsheetBuffer(buffer);

  const entries: EmailEntry[] = rawEntries.map((entry) => ({
    row: entry.row,
    name: entry.name,
    email: entry.email,
  }));

  return { entries, skipped };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return jsonWithCors(
        {
          error:
            "Unauthorized. Set Authorization: Bearer <BULK_API_KEY> or x-api-key header.",
        },
        401,
      );
    }

    const formData = await request.formData();
    const file = getSpreadsheetFile(formData);

    if (!file) {
      return jsonWithCors(
        {
          error:
            "Upload a spreadsheet as multipart field 'file' (.xlsx, .xls, or .csv).",
        },
        400,
      );
    }

    if (!isAcceptedFile(file)) {
      return jsonWithCors(
        { error: "Unsupported file type. Upload .xlsx, .xls, or .csv." },
        400,
      );
    }

    const dryRun = ["1", "true", "yes"].includes(
      (
        formData.get("dryRun") ??
        request.nextUrl.searchParams.get("dryRun") ??
        ""
      )
        .toString()
        .toLowerCase(),
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    const { entries, skipped } = parseEmailEntriesFromSpreadsheet(buffer);

    if (dryRun) {
      return jsonWithCors({
        success: true,
        dryRun: true,
        total: entries.length,
        skipped,
        entries: entries.map((entry) => ({
          row: entry.row,
          name: entry.name,
          email: entry.email,
        })),
      });
    }

    console.info("[send-confirmation-emails] Processing entries", {
      fileName: file.name,
      total: entries.length,
      skipped: skipped.length,
    });

    const results = await processConfirmationEmails(entries);
    const sent = results.filter((result) => result.success).length;
    const failed = results.length - sent;

    return jsonWithCors({
      success: failed === 0,
      total: results.length,
      sent,
      failed,
      skipped,
      results,
      message:
        failed === 0
          ? `Sent ${sent} confirmation email(s).`
          : `Sent ${sent} email(s); ${failed} failed. See results for details.`,
    });
  } catch (error) {
    console.error("[send-confirmation-emails]", error);

    const message =
      error instanceof Error ? error.message : "Internal server error";

    return jsonWithCors({ error: message }, 500);
  }
}
