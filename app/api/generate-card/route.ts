import { NextRequest, NextResponse } from "next/server";
import { buildCardHtml } from "@/lib/card-template";
import { captureCardPng } from "@/lib/screenshot";
import { sendEventPassEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const name = formData.get("name");
    const email = formData.get("email");
    const image = formData.get("image");

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Field 'name' is required." },
        { status: 400 },
      );
    }

    if (typeof email !== "string" || !isValidEmail(email.trim())) {
      return NextResponse.json(
        { error: "Field 'email' must be a valid email address." },
        { status: 400 },
      );
    }

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json(
        { error: "Field 'image' must be a non-empty image file." },
        { status: 400 },
      );
    }

    const mimeType = image.type || "image/jpeg";
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          error:
            "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
        },
        { status: 400 },
      );
    }

    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    const html = await buildCardHtml(trimmedName, imageBuffer, mimeType);
    const pngBuffer = await captureCardPng(html);
    const delivery = await sendEventPassEmail(
      trimmedEmail,
      trimmedName,
      pngBuffer,
    );

    return NextResponse.json({
      success: true,
      message: `Event pass handed off to Brevo for ${trimmedEmail}. Check inbox, Spam, and Promotions.`,
      delivery: {
        ...delivery,
        note:
          "SMTP 250 only means Brevo queued the message. Final delivery status appears in Brevo transactional logs.",
      },
    });
  } catch (error) {
    console.error("[generate-card]", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
