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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getField(fields: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in fields) return fields[key];
  }
  return null;
}

function getObjectField(
  fields: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  const value = getField(fields, keys);
  return isRecord(value) ? value : null;
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

function getStringFieldLoose(
  fields: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (trimmed) return trimmed;
        }
      }
    }
  }

  return null;
}

function splitWordPressUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;

  const match = userAgent.match(/WordPress\/[^;]+;\s*(https?:\/\/[^\s]+)/i);
  return match?.[1] ?? null;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function getWordPressMediaBaseUrl(request: NextRequest): string | null {
  const headers = Object.fromEntries(request.headers.entries());
  const explicit = getStringFieldLoose(headers, [
    "x-wordpress-site-url",
    "x-site-url",
    "x-origin",
    "origin",
    "referer",
  ]);

  if (explicit) {
    try {
      return normalizeBaseUrl(new URL(explicit).origin);
    } catch {
      // Ignore and fall through to user agent parsing.
    }
  }

  return splitWordPressUserAgent(request.headers.get("user-agent"));
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

function basenameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function mediaItemMatchesGuess(
  candidate: Record<string, unknown>,
  guess: string,
): boolean {
  const normalizedGuess = guess.trim().toLowerCase();
  if (!normalizedGuess) return false;

  const sourceUrl =
    typeof candidate.source_url === "string" ? candidate.source_url : "";
  const slug = typeof candidate.slug === "string" ? candidate.slug : "";
  const title =
    isRecord(candidate.title) && typeof candidate.title.rendered === "string"
      ? candidate.title.rendered
      : "";
  const mediaFile =
    isRecord(candidate.media_details) &&
    typeof candidate.media_details.file === "string"
      ? candidate.media_details.file
      : "";

  const sourceBasename = basenameFromUrl(sourceUrl).toLowerCase();
  const mediaBasename = mediaFile.split("/").pop()?.toLowerCase() || "";

  return (
    slug.toLowerCase() === normalizedGuess ||
    sourceUrl.toLowerCase().includes(normalizedGuess) ||
    sourceBasename === normalizedGuess ||
    mediaBasename === normalizedGuess ||
    mediaFile.toLowerCase().endsWith(`/${normalizedGuess}`) ||
    title.toLowerCase() === normalizedGuess ||
    title.toLowerCase().includes(normalizedGuess)
  );
}

function getWordPressMediaSourceUrl(
  item: Record<string, unknown>,
): string | null {
  return typeof item.source_url === "string" ? item.source_url : null;
}

async function fetchWordPressMediaSourceUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string>,
): Promise<string | null> {
  const queryUrl = new URL(
    `${normalizeBaseUrl(baseUrl)}/wp-json/wp/v2/${path}`,
  );

  for (const [key, value] of Object.entries(params)) {
    queryUrl.searchParams.set(key, value);
  }

  const response = await fetch(queryUrl);
  if (!response.ok) return null;

  const payload = (await response.json()) as unknown;
  const items = Array.isArray(payload) ? payload : [payload];

  for (const item of items) {
    if (!isRecord(item)) continue;
    const sourceUrl = getWordPressMediaSourceUrl(item);
    if (sourceUrl) return sourceUrl;
  }

  return null;
}

async function fetchWordPressMediaBySlug(
  baseUrl: string,
  slug: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const sourceUrl = await fetchWordPressMediaSourceUrl(baseUrl, "media", {
    slug: slug.trim(),
  });

  if (!sourceUrl) return null;

  try {
    return await fetchImageFromUrl(sourceUrl);
  } catch {
    return null;
  }
}

async function fetchWordPressMediaById(
  baseUrl: string,
  id: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const sourceUrl = await fetchWordPressMediaSourceUrl(
    baseUrl,
    `media/${trimmed}`,
    {},
  );

  if (!sourceUrl) return null;

  try {
    return await fetchImageFromUrl(sourceUrl);
  } catch {
    return null;
  }
}

function buildWordPressUploadsUrl(
  baseUrl: string,
  relativePath: string,
): string {
  return `${normalizeBaseUrl(baseUrl)}/wp-content/uploads/${relativePath.replace(/^\/+/, "")}`;
}

async function fetchWordPressMediaByGuess(
  baseUrl: string,
  guesses: string[],
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const uniqueGuesses = [
    ...new Set(guesses.map((guess) => guess.trim()).filter(Boolean)),
  ];

  for (const guess of uniqueGuesses) {
    const bySlug = await fetchWordPressMediaBySlug(baseUrl, guess);
    if (bySlug) return bySlug;

    const queryUrl = new URL(
      `${normalizeBaseUrl(baseUrl)}/wp-json/wp/v2/media`,
    );
    queryUrl.searchParams.set("search", guess);
    queryUrl.searchParams.set("per_page", "100");

    const response = await fetch(queryUrl);
    if (!response.ok) continue;

    const items = (await response.json()) as Array<Record<string, unknown>>;
    const item = items.find((candidate) => mediaItemMatchesGuess(candidate, guess));

    const sourceUrl = item ? getWordPressMediaSourceUrl(item) : null;
    if (!sourceUrl) continue;

    try {
      return await fetchImageFromUrl(sourceUrl);
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveWordPressBracketImage(
  meta: Record<string, unknown>,
  baseUrl: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const id = getStringFieldLoose(meta, ["id", "ID", "attachment_id", "attachmentId"]);
  if (id) {
    const byId = await fetchWordPressMediaById(baseUrl, id);
    if (byId) return byId;
  }

  const postname = getStringFieldLoose(meta, [
    "postname",
    "post_name",
    "slug",
    "postName",
  ]);
  if (postname) {
    const bySlug = await fetchWordPressMediaBySlug(baseUrl, postname);
    if (bySlug) return bySlug;

    if (postname.includes("/")) {
      try {
        const direct = await fetchImageFromUrl(
          buildWordPressUploadsUrl(baseUrl, postname),
        );
        if (ALLOWED_IMAGE_TYPES.has(direct.mimeType)) {
          return direct;
        }
      } catch {
        // Fall through to search-based resolution.
      }
    }
  }

  const name = getStringFieldLoose(meta, [
    "name",
    "filename",
    "fileName",
    "file",
    "title",
  ]);
  if (name) {
    if (isProbablyUrl(name)) {
      try {
        return await fetchImageFromUrl(name);
      } catch {
        // Fall through.
      }
    }

    if (name.includes("/")) {
      try {
        return await fetchImageFromUrl(buildWordPressUploadsUrl(baseUrl, name));
      } catch {
        // Fall through.
      }
    }
  }

  const guessed = await fetchWordPressMediaByGuess(
    baseUrl,
    [postname, name].filter(Boolean) as string[],
  );
  if (guessed) return guessed;

  return null;
}

function collectBracketNamespace(
  fields: Record<string, unknown>,
  namespace: string,
): Record<string, unknown> | null {
  const prefix = `${namespace}[`;
  const result: Record<string, unknown> = {};
  let found = false;

  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(prefix)) continue;

    const tokens = [...key.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
    if (tokens.length === 0) continue;

    found = true;
    let cursor: Record<string, unknown> = result;

    tokens.forEach((token, index) => {
      const isLast = index === tokens.length - 1;

      if (isLast) {
        cursor[token] = value;
        return;
      }

      const existing = cursor[token];
      if (isRecord(existing)) {
        cursor = existing;
        return;
      }

      const next: Record<string, unknown> = {};
      cursor[token] = next;
      cursor = next;
    });
  }

  return found ? result : null;
}

async function resolveImageSource(
  fields: Record<string, unknown>,
  request: NextRequest,
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

  const wpImageMeta = collectBracketNamespace(fields, "image");
  const wordpressBaseUrl = getWordPressMediaBaseUrl(request);

  if (wpImageMeta && wordpressBaseUrl) {
    const resolved = await resolveWordPressBracketImage(
      wpImageMeta,
      wordpressBaseUrl,
    );
    if (resolved) {
      if (!ALLOWED_IMAGE_TYPES.has(resolved.mimeType)) {
        throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      }

      return resolved;
    }
  }

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
    if (!trimmed) return null;

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

  const candidateObjects = [imageObject, wpImageMeta].filter(isRecord) as Array<
    Record<string, unknown>
  >;

  for (const object of candidateObjects) {
    const objectMimeType = getStringField(object, [
      "mimeType",
      "mime_type",
      "mime",
      "contentType",
      "content_type",
      "type",
    ]);

    const objectCandidates: Array<unknown> = [
      object.url,
      object.src,
      object.source_url,
      object.data,
      object.base64,
      object.content,
      object.image,
      object.file,
      object.name,
      object.filename,
      object.fileName,
      object.postname,
      object.slug,
    ];

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

    if (wordpressBaseUrl) {
      const resolved = await resolveWordPressBracketImage(object, wordpressBaseUrl);
      if (resolved) return resolved;
    }
  }

  throw new Error(
    "Field 'image' must be a file, a data URL, an image URL, or WordPress media metadata that can be resolved to a public URL.",
  );
}

async function readRequestFields(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
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

    console.info("[generate-card] Incoming fields", {
      keys: Object.keys(fields),
      contentType: request.headers.get("content-type"),
      userAgent: request.headers.get("user-agent"),
    });

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

    const { buffer: imageBuffer, mimeType } = await resolveImageSource(
      fields,
      request,
    );

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
