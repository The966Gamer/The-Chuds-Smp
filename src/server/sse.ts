import type { Response } from "express";

const clients = new Set<Response>();

export function registerClient(res: Response) {
  clients.add(res);

  res.on("close", () => {
    clients.delete(res);
  });
}

export function broadcastEvent(type: string, payload: unknown) {
  const data = JSON.stringify({ type, payload });
  const message = `data: ${data}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }
  }
}
