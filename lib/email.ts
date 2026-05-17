import { escapeHtml } from "./escape-html";
import { getMailerConfig, sendMail } from "./mailer";

export type EmailSendResult = {
  messageId: string;
  brevoQueuedId: string | null;
  from: string;
  to: string;
  brevoLogsUrl: string;
};

function parseBrevoQueuedId(smtpResponse: string | undefined): string | null {
  if (!smtpResponse) return null;
  const match = smtpResponse.match(/queued as (<[^>]+>)/i);
  return match?.[1] ?? null;
}

function formatSmtpError(error: unknown): string {
  if (!(error instanceof Error)) return "Failed to send email.";

  const nodemailerError = error as Error & {
    code?: string;
    response?: string;
  };

  if (
    nodemailerError.code === "EAUTH" &&
    nodemailerError.response?.includes("Unauthorized IP")
  ) {
    return [
      "Brevo rejected the connection: unauthorized IP address.",
      "In Brevo go to Settings → SMTP & API → SMTP → Security and either disable IP restriction or add your current public IP.",
    ].join(" ");
  }

  if (
    nodemailerError.response?.includes("sender") ||
    nodemailerError.response?.includes("Sender")
  ) {
    return [
      "Brevo rejected the sender address.",
      `Verify "${process.env.FROM_EMAIL}" under Senders, Domains & Dedicated IPs → Senders in Brevo.`,
    ].join(" ");
  }

  return nodemailerError.message;
}

function buildEventPassHtml(name: string): string {
  const greeting = escapeHtml(name);

  return `
    <div style="background:#eef0f6; padding:32px 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <div style="max-width:560px; margin:0 auto;">
        <div style="text-align:center; margin-bottom:16px; font-size:11px; color:#6b7280; letter-spacing:0.08em; text-transform:uppercase;">
          Creator's Event
        </div>
        <div style="background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e2e5ee; box-shadow:0 4px 24px rgba(15,23,42,0.06);">
          <div style="background:linear-gradient(135deg,#f97b3c 0%,#f96b2f 55%,#e85d04 100%); padding:28px 32px;">
            <div style="font-size:11px; font-weight:600; letter-spacing:0.12em; color:#ffedd5; text-transform:uppercase; margin-bottom:8px;">Your pass</div>
            <div style="font-size:22px; font-weight:700; color:#ffffff; line-height:1.35;">Entry Recieved!</div>
            <div style="font-size:14px; color:#ffedd5; margin-top:10px; line-height:1.5;">Your event pass is attached to this email. Show it at the venue.</div>
          </div>
          <div style="padding:28px 32px;">
            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0 0 16px;">
              Hi <strong>${greeting}</strong>,
            </p>
            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0;">
              See you at Palghar's first exclusive creator event — <strong>31st May</strong>.
            </p>
          </div>
          <div style="padding:16px 32px 24px; background:#f9fafb; border-top:1px solid #e8eaf0;">
            <p style="font-size:12px; color:#9ca3af; margin:0; line-height:1.6; text-align:center;">
              © ${new Date().getFullYear()} Creator's Event
            </p>
            <p style="font-size:12px; color:#9ca3af; margin:8px 0 0; line-height:1.6; text-align:center;">
              <a href="https://www.instagram.com/unovative.media?igsh=anlmYWIyenZrbnow" style="color:#f97b3c; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:8px;">
                <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original" alt="Instagram" style="width:20px; height:20px; vertical-align:middle; border:0; display:inline-block;" />
                <span style="color:#f97b3c; text-decoration:none;">Follow us on Instagram</span>
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>`;
}

export async function sendEventPassEmail(
  to: string,
  name: string,
  pngBuffer: Buffer,
): Promise<EmailSendResult> {
  const { defaults } = getMailerConfig();
  const fromAddress = defaults.from.address;

  try {
    const info = await sendMail({
      to,
      subject: "Your Creator's Event Pass",
      text: `Hi ${name},\n\nYour event pass is attached. See you at the event!\n`,
      html: buildEventPassHtml(name),
      attachments: [
        {
          filename: "event-pass.png",
          content: pngBuffer,
          contentType: "image/png",
        },
      ],
    });

    const smtpResponse =
      typeof info.response === "string" ? info.response : undefined;

    return {
      messageId: info.messageId ?? "",
      brevoQueuedId: parseBrevoQueuedId(smtpResponse),
      from: fromAddress,
      to,
      brevoLogsUrl: "https://app-smtp.brevo.com/log",
    };
  } catch (error) {
    throw new Error(formatSmtpError(error), { cause: error });
  }
}
