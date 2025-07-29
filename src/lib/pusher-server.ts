// src/lib/pusher-server.ts
import Pusher from "pusher";
// only needed if you're not on Next.js (which auto‑loads .env* for you)
// import dotenv from "dotenv";
// dotenv.config();

export const pusher = new Pusher({
  appId:    process.env.PUSHER_APP_ID!,
  key:      process.env.PUSHER_KEY!,
  secret:   process.env.PUSHER_SECRET!,
  cluster:  process.env.PUSHER_CLUSTER!,
  useTLS:   true,
});
