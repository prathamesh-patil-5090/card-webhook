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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getObjectField(
  fields: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  const value = getField(fields, keys);
  return isRecord(value) ? value : null;
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
    "featuredImage",
    "featured_image",
    "attachmentUrl",
    "attachment_url",
    "photo",
    "avatar",
    "file",
  ]);
  const imageObject = getObjectField(fields, [
    "image",
    "imageData",
    "image_data",
    "media",
    "imageMeta",
    "image_meta",
    "featuredImage",
    "featured_image",
  ]);
  const mimeTypeHint = getStringField(fields, [
    "imageMimeType",
    "image_mime_type",
    "mimeType",
    "image_type",
    "type",
    "contentType",
    "content_type",
    "imageContentType",
    "image_content_type",
  ]);

  const tryResolveString = async (
    value: string,
  ): Promise<{ buffer: Buffer; mimeType: string } | null> => {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith("data:")) {
      const decoded = decodeDataUrl(trimmed);
      if (!ALLOWED_IMAGE_TYPES.has(decoded.mimeType)) {
        throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      }

      return decoded;
    }

    if (isProbablyUrl(trimmed)) {
      const fetched = await fetchImageFromUrl(trimmed);
      if (!ALLOWED_IMAGE_TYPES.has(fetched.mimeType)) {
        throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      }

      return fetched;
    }

    if (mimeTypeHint && looksLikeBase64(trimmed)) {
      const mimeType = mimeTypeHint;
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      }

      return {
        buffer: Buffer.from(trimmed, "base64"),
        mimeType,
      };
    }

    return null;
  };

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
    const resolved = await tryResolveString(image);
    if (resolved) return resolved;
  }

  if (imageObject) {
    const objectCandidates: Array<unknown> = [
      imageObject.url,
      imageObject.src,
      imageObject.source_url,
      imageObject.data,
      imageObject.base64,
      imageObject.content,
      imageObject.image,
      imageObject.file,
    ];

    const objectMimeType = getStringField(imageObject, [
      "mimeType",
      "mime_type",
      "contentType",
      "content_type",
      "type",
    ]);

    for (const candidate of objectCandidates) {
      if (candidate instanceof File && candidate.size > 0) {
        const mimeType =
          candidate.type || objectMimeType || mimeTypeHint || "image/jpeg";
        if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
          throw new Error(
            "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
          );
        }

        return {
          buffer: Buffer.from(await candidate.arrayBuffer()),
          mimeType,
        };
      }

      if (typeof candidate === "string") {
        const resolved = await tryResolveString(candidate);
        if (resolved) return resolved;
      }
    }
  }

  throw new Error(
    "Field 'image' must be a file, a data URL, an image URL, or an object containing one of those values.",
  );
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

    console.info("[generate-card] Incoming fields", {
      keys: Object.keys(fields),
      contentType: request.headers.get("content-type"),
    });

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
