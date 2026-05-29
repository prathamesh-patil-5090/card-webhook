import { sendConfirmationEmail } from "./send-confirmation-email";

export type EmailEntry = {
  row: number;
  name: string;
  email: string;
};

export type ProcessResult = {
  row: number;
  email: string;
  name: string;
  success: boolean;
  messageId?: string;
  brevoQueuedId?: string | null;
  error?: string;
};

export async function processConfirmationEmails(
  entries: EmailEntry[]
): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];

  for (const entry of entries) {
    try {
      console.info(`[send-confirmation-emails] Processing ${entry.email}`);
      const result = await sendConfirmationEmail(entry.email, entry.name);

      results.push({
        row: entry.row,
        email: entry.email,
        name: entry.name,
        success: true,
        messageId: result.messageId,
        brevoQueuedId: result.brevoQueuedId,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      console.error(
        `[send-confirmation-emails] Failed for ${entry.email}:`,
        errorMessage
      );

      results.push({
        row: entry.row,
        email: entry.email,
        name: entry.name,
        success: false,
        error: errorMessage,
      });
    }
  }

  return results;
}
