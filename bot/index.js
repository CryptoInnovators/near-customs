import { createHandler } from "./handler.js";
import { pathToFileURL } from "node:url";

export async function startBot(token) {
  const handle = createHandler();
  let offset = 0;
  while (true) {
    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${offset}`);
      if (!response.ok) throw new Error("poll failed");
      const { result } = await response.json();
      for (const update of result || []) {
        const message = update.message;
        if (message?.text) {
          const text = await handle(message.text);
          const sent = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: message.chat.id, text }),
          });
          if (!sent.ok) throw new Error("send failed");
        }
        offset = update.update_id + 1;
      }
    } catch {
      console.error("Telegram polling failed; retrying.");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is required.");
    process.exit(1);
  }
  startBot(token);
}
