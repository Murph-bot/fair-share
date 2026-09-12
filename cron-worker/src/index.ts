/**
 * Daily cron: expires photos older than the retention window.
 * Pages does not support scheduled functions, so this tiny Worker posts to
 * the protected /api/admin/expire-photos endpoint using CRON_SECRET.
 */
export default {
  async scheduled(
    _event: unknown,
    env: { CRON_TARGET_URL?: string; CRON_SECRET?: string },
    _ctx: unknown,
  ): Promise<void> {
    const target = env.CRON_TARGET_URL;
    const secret = env.CRON_SECRET;
    if (!target || !secret) {
      console.error("cron: missing CRON_TARGET_URL or CRON_SECRET");
      return;
    }
    const response = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) {
      console.error(`cron: expiry request failed with ${response.status}`);
    }
  },
};
