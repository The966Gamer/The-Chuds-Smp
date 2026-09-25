import { getConfig } from "./config";
import { q, memDb } from "./db";

export interface DiscordDelivery {
  id: number;
  event_type: string;
  status: "sent" | "failed" | "skipped" | "pending";
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

const EVENT_COLORS: Record<string, number> = {
  player_join: 0x6abe30,
  player_leave: 0x9aa88c,
  player_death: 0xe0564f,
  grave_created: 0xe0a83c,
  grave_expiring: 0xe0564f,
  chat_message: 0x4f9fd8,
  server_start: 0x8be050,
  server_stop: 0xe0564f,
  server_restart: 0xe0a83c,
  server_crash: 0xa83a35,
};

export async function queueDiscordNotification(
  eventType: string,
  payload: {
    playerName?: string;
    message?: string;
    data?: Record<string, unknown>;
  },
) {
  const cfg = getConfig();
  const webhookUrl = cfg.DISCORD_WEBHOOK_URL;
  const createdAt = new Date().toISOString();

  const delivery: DiscordDelivery = {
    id: Date.now(),
    event_type: eventType,
    status: "pending",
    error: null,
    created_at: createdAt,
    sent_at: null,
  };

  memDb.discord_events.unshift(delivery);
  if (memDb.discord_events.length > 50) memDb.discord_events.pop();

  if (!webhookUrl) {
    delivery.status = "skipped";
    delivery.error = "Webhook not configured";
    return;
  }

  // Format Discord Embed
  const color = EVENT_COLORS[eventType] || 0x7cbd45;
  const title = eventType.replace(/_/g, " ").toUpperCase();
  let description = payload.message || "";
  if (payload.playerName) {
    description = `**${payload.playerName}** ${description}`;
  }

  // Mentions
  const discordNames = (memDb.panel_settings.get("discordNames") as Record<string, string>) || {};
  let content: string | undefined = undefined;
  if (payload.playerName && discordNames[payload.playerName]) {
    const mentionId = discordNames[payload.playerName].replace(/[<@!>]/g, "");
    content = `<@${mentionId}>`;
  }

  const embed: Record<string, unknown> = {
    title,
    description: description || "Server notification",
    color,
    timestamp: new Date().toISOString(),
    footer: { text: "TheChudSmp Control Panel" },
  };

  if (payload.playerName) {
    embed.thumbnail = {
      url: `https://mc-heads.net/avatar/${encodeURIComponent(payload.playerName)}/64`,
    };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        embeds: [embed],
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok || res.status === 204) {
      delivery.status = "sent";
      delivery.sent_at = new Date().toISOString();
    } else {
      const errText = await res.text().catch(() => "");
      delivery.status = "failed";
      delivery.error = `HTTP ${res.status}: ${errText.slice(0, 100)}`;
    }
  } catch (err) {
    delivery.status = "failed";
    delivery.error = (err as Error).message;
  }

  try {
    await q(
      `insert into discord_events (event_type, status, payload, error, created_at, sent_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        eventType,
        delivery.status,
        JSON.stringify(payload),
        delivery.error,
        createdAt,
        delivery.sent_at || null,
      ],
    );
  } catch {
    // non-fatal
  }
}
