import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

/** Mirrors NestJS MailerModule.forRootAsync Brevo transport + defaults. */
export function getMailerConfig() {
  const user = process.env.BREVO_USER;
  const pass = process.env.BREVO_SMTP_KEY;
  const fromEmail = process.env.FROM_EMAIL;
  const fromName = process.env.FROM_NAME ?? "Creator's Event Pass";

  if (!user || !pass || !fromEmail) {
    throw new Error(
      "Missing email configuration. Set FROM_EMAIL, BREVO_USER, and BREVO_SMTP_KEY in .env",
    );
  }

  return {
    transport: {
      host: process.env.BREVO_SMTP_HOST ?? "smtp-relay.brevo.com",
      port: Number(process.env.BREVO_SMTP_PORT ?? "587"),
      secure: false,
      auth: { user, pass },
    },
    defaults: {
      from: { name: fromName, address: fromEmail },
    },
  };
}

let transporter: nodemailer.Transporter | null = null;

export function getMailerTransporter(): nodemailer.Transporter {
  if (!transporter) {
    const { transport } = getMailerConfig();
    transporter = nodemailer.createTransport(transport);
  }
  return transporter;
}

export async function sendMail(
  options: Mail.Options,
): Promise<nodemailer.SentMessageInfo> {
  const { defaults } = getMailerConfig();
  const mailer = getMailerTransporter();

  return mailer.sendMail({
    from: defaults.from,
    ...options,
  });
}
