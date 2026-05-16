import { buildCardHtml } from "@/lib/card-template";
import { sendEventPassEmail } from "@/lib/email";
import { captureCardPng } from "@/lib/screenshot";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, Accept, Origin",
};

function jsonWithCors(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getStringField(
  fields: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }

  return null;
}

function getField(fields: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in fields) {
      return fields[key];
    }
  }

  return null;
}

function isProbablyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);

  if (!match) {
    throw new Error("Invalid data URL in image field.");
  }

  const mimeType = match[1] || "image/jpeg";
  const isBase64 = Boolean(match[2]);
  const data = match[3];

  if (!isBase64) {
    throw new Error("Image data URL must be base64 encoded.");
  }

  return {
    mimeType,
    buffer: Buffer.from(data, "base64"),
  };
}

function looksLikeBase64(value: string): boolean {
  return /^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length >= 32;
}

async function fetchImageFromUrl(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Unable to fetch image from URL. Received ${response.status} ${response.statusText}.`,
    );
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());

  return { buffer, mimeType };
}

async function resolveImageSource(
  fields: Record<string, unknown>,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const image = getField(fields, [
    "image",
    "imageUrl",
    "image_url",
    "imageBase64",
    "image_base64",
  ]);
  const mimeTypeHint = getStringField(fields, [
    "imageMimeType",
    "image_mime_type",
    "mimeType",
    "image_type",
    "type",
  ]);

  if (image instanceof File && image.size > 0) {
    const mimeType = image.type || mimeTypeHint || "image/jpeg";

    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
    }

    return {
      buffer: Buffer.from(await image.arrayBuffer()),
      mimeType,
    };
  }

  if (typeof image === "string") {
    const value = image.trim();

    if (!value) {
      throw new Error(
        "Field 'image' must be a non-empty image file, data URL, or image URL.",
      );
    }

    if (value.startsWith("data:")) {
      const decoded = decodeDataUrl(value);
      if (!ALLOWED_IMAGE_TYPES.has(decoded.mimeType)) {
        throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      }

      return decoded;
    }

    if (isProbablyUrl(value)) {
      const fetched = await fetchImageFromUrl(value);
      if (!ALLOWED_IMAGE_TYPES.has(fetched.mimeType)) {
        throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      }

      return fetched;
    }

    if (mimeTypeHint && looksLikeBase64(value)) {
      const mimeType = mimeTypeHint;
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      }

      return {
        buffer: Buffer.from(value, "base64"),
        mimeType,
      };
    }
  }

  throw new Error("Field 'image' must be a file, a data URL, or an image URL.");
}

async function readRequestFields(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return body;
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }

  throw new Error(
    `Unsupported Content-Type. Expected multipart/form-data, application/x-www-form-urlencoded, or application/json. Received: ${contentType || "unknown"}`,
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  try {
    const fields = await readRequestFields(request);
    const name = getStringField(fields, ["name", "fullName"]);
    const email = getStringField(fields, ["email"]);

    if (!name) {
      return jsonWithCors({ error: "Field 'name' is required." }, 400);
    }

    if (!email || !isValidEmail(email)) {
      return jsonWithCors(
        { error: "Field 'email' must be a valid email address." },
        400,
      );
    }

    const { buffer: imageBuffer, mimeType } = await resolveImageSource(fields);

    const html = await buildCardHtml(name, imageBuffer, mimeType);
    const pngBuffer = await captureCardPng(html);
    const delivery = await sendEventPassEmail(email, name, pngBuffer);

    return jsonWithCors({
      success: true,
      message: `Event pass handed off to Brevo for ${email}. Check inbox, Spam, and Promotions.`,
      delivery: {
        ...delivery,
        note: "SMTP 250 only means Brevo queued the message. Final delivery status appears in Brevo transactional logs.",
      },
    });
  } catch (error) {
    console.error("[generate-card]", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return jsonWithCors({ error: message }, 500);
  }
}
