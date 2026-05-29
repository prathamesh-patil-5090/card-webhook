import { escapeHtml } from "./escape-html";
import { getMailerConfig, sendMail } from "./mailer";

export type EmailSendResult = {
  messageId: string;
  brevoQueuedId: string | null;
  from: string;
  to: string;
  brevoLogsUrl: string;
  success: boolean;
  error?: string;
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

function buildConfirmationEmailHtml(name: string): string {
  const greeting = escapeHtml(name);

  return `
    <div style="background:#eef0f6; padding:32px 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <div style="max-width:560px; margin:0 auto;">
        <div style="text-align:center; margin-bottom:16px; font-size:11px; color:#6b7280; letter-spacing:0.08em; text-transform:uppercase;">
          Unovative Creator Event
        </div>
        <div style="background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e2e5ee; box-shadow:0 4px 24px rgba(15,23,42,0.06);">
          <div style="background:linear-gradient(135deg,#f97b3c 0%,#f96b2f 55%,#e85d04 100%); padding:28px 32px;">
            <div style="font-size:11px; font-weight:600; letter-spacing:0.12em; color:#ffedd5; text-transform:uppercase; margin-bottom:8px;">Registration Confirmed</div>
            <div style="font-size:22px; font-weight:700; color:#ffffff; line-height:1.35;">Welcome to Unovative!</div>
            <div style="font-size:14px; color:#ffedd5; margin-top:10px; line-height:1.5;">Your registration has been confirmed.</div>
          </div>
          <div style="padding:28px 32px;">
            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0 0 16px;">
              Dear <strong>${greeting}</strong>,
            </p>
            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0 0 16px;">
              Thank you for registering for the <strong>Unovative Creator Event</strong>!
            </p>
            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0 0 16px;">
              We're truly excited to host you and bring together an amazing community of creators, innovators, and professionals under one roof. This event is designed to create meaningful discussions around opportunities, collaborations, networking, creativity, and of course, a lot of fun.
            </p>
            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0 0 16px;">
              As Palghar's first exclusive event dedicated to creators, this gathering is going to be a special milestone for the local creator ecosystem, and we're excited to have you as a part of it.
            </p>

            <div style="background:#f0fdf4; border-left:4px solid #22c55e; padding:16px; margin:24px 0; border-radius:4px;">
              <div style="font-size:14px; font-weight:600; color:#166534; margin-bottom:8px;">📅 Event Timing Reminder (31st May 2026)</div>
              <p style="font-size:14px; color:#166534; line-height:1.6; margin:0 0 8px;">
                Please make sure to <strong>arrive on time at 4:00 PM</strong> for a smooth entry experience.
              </p>
              <p style="font-size:14px; color:#166534; line-height:1.6; margin:0;">
                Entry gates will <strong>close at 5:00 PM</strong>. Due to limited capacity and a high number of registrations, entries will be managed on a first come, first serve basis.
              </p>
            </div>

            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0 0 16px;">
              We hope you have already received your entry pass on your registered email ID. In case you haven't received it yet, please reply to this email and our team will assist you immediately. Also, kindly check your <strong>Spam or Promotions folder</strong> once.
            </p>

            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0 0 16px;">
              Get ready for an evening full of connections, conversations, creativity, and memorable experiences.
            </p>

            <p style="font-size:15px; color:#374151; line-height:1.65; margin:0;">
              <strong>Cheers in advance,</strong><br>
              Team Unovative
            </p>
          </div>
          <div style="padding:16px 32px 24px; background:#f9fafb; border-top:1px solid #e8eaf0;">
            <p style="font-size:12px; color:#9ca3af; margin:0; line-height:1.6; text-align:center;">
              © ${new Date().getFullYear()} Unovative Creator Event
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

export async function sendConfirmationEmail(
  to: string,
  name: string,
): Promise<EmailSendResult> {
  const { defaults } = getMailerConfig();
  const fromAddress = defaults.from.address;

  try {
    const info = await sendMail({
      to,
      subject: "Thank You for Registering for the Unovative Creator Event!",
      text: `Dear ${name},

Thank you for registering for the Unovative Creator Event!

We're truly excited to host you and bring together an amazing community of creators, innovators, and professionals under one roof. This event is designed to create meaningful discussions around opportunities, collaborations, networking, creativity, and of course, a lot of fun.

As Palghar's first exclusive event dedicated to creators, this gathering is going to be a special milestone for the local creator ecosystem, and we're excited to have you as a part of it.

31st May 2026, Event Timing Reminder:
Please make sure to arrive on time at 4:00 PM for a smooth entry experience. Entry gates will close at 5:00 PM, and due to limited capacity and a high number of registrations, entries will be managed on a first come, first serve basis.

We hope you have already received your entry pass on your registered email ID. In case you haven't received it yet, please reply to this email and our team will assist you immediately. Also, kindly check your Spam or Promotions folder once.

Get ready for an evening full of connections, conversations, creativity, and memorable experiences.

Cheers in advance,
Team Unovative`,
      html: buildConfirmationEmailHtml(name),
    });

    const smtpResponse =
      typeof info.response === "string" ? info.response : undefined;

    return {
      messageId: info.messageId ?? "",
      brevoQueuedId: parseBrevoQueuedId(smtpResponse),
      from: fromAddress,
      to,
      brevoLogsUrl: "https://app-smtp.brevo.com/log",
      success: true,
    };
  } catch (error) {
    const errorMessage = formatSmtpError(error);
    throw new Error(errorMessage, { cause: error });
  }
}
