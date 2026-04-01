import { DEFAULT_REMINDER_RULES } from "@/lib/types";
import { enqueueReminder } from "@/lib/queue";

export async function scheduleMissingPhotoReminders(orderId: string, createdAt: Date) {
  const now = Date.now();

  await Promise.all(
    DEFAULT_REMINDER_RULES.map(async (rule) => {
      const scheduledFor = createdAt.getTime() + rule.hoursAfterOrder * 60 * 60 * 1000;
      const delayMs = Math.max(scheduledFor - now, 0);
      await enqueueReminder(orderId, rule.label, delayMs);
    })
  );
}
