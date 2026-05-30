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
      text: `Dear Creator,

Thank you for registering for the Unovative Creators Event 2026

We're truly excited to host you and bring together an amazing community of creators, innovators, and professionals under one roof. This event is designed to create meaningful discussions around opportunities, collaborations, networking, creativity, and of course, a lot of fun.

As Palghar's first exclusive event dedicated to creators, this gathering is going to be a special milestone for the local creator ecosystem, and we're excited to have you as a part of it.

Event Timing Reminder:
Please make sure to arrive on time at 4:00 PM for a smooth entry experience. Entry gates will close at 5:00 PM, and due to limited capacity and a high number of registrations, entries will be managed on a first come, first serve basis.

We hope you have already received your entry pass on your registered email ID. In case you haven't received it yet, please reply to this email and our team will assist you immediately. Also, kindly check your Spam or Promotions folder once.

Get ready for an evening full of connections, conversations, creativity, and memorable experiences.

Date & Time: 31st May 2026 (Tomorrow @4pm) 
Location: Eera's Resort Shirgaon, Palghar 

Cheers in advance,
Team Unovative`,
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
