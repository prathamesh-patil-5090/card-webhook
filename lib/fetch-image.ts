export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function fetchImageFromUrl(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Unable to fetch image from URL. Received ${response.status} ${response.statusText}.`,
    );
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0].trim() || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());

  return { buffer, mimeType };
}

export function assertAllowedImageType(mimeType: string): void {
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
  }
}
