// src/lib/pusher-server.ts
import Pusher from "pusher";

export const pusher = new Pusher({
  appId:  "2028930",
  key:    "6f9adcf7a6b2d8780aa9",
  secret: "3ae274686e4b9c65828e",
  cluster:"eu",
  useTLS: true,
});
