// /home/zodx/Desktop/trapigram/src/lib/send-announcements.ts
import cron from "node-cron";
import { pool } from "./db";

// Schedule to run every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  try {
    const query = `
      UPDATE announcements
      SET sent = true, "updatedAt" = NOW()
      WHERE "deliveryDate" <= NOW() AND sent = false
    `;
    await pool.query(query);
    console.log("Checked and updated sent announcements");
  } catch (error) {
    console.error("Error in cron job:", error);
  }
});