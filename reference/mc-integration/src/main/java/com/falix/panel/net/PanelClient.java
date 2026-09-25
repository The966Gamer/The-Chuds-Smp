package com.falix.panel.net;

import com.falix.panel.config.ModConfig;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Sends events to the panel's /api/integration/events endpoint.
 * Events that cannot be delivered are queued and retried on a timer so a
 * temporarily offline panel never loses in-game events.
 */
public final class PanelClient {
    private static final Gson GSON = new Gson();
    private static final Duration TIMEOUT = Duration.ofSeconds(6);

    private final ModConfig config;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();
    private final ConcurrentLinkedQueue<JsonObject> queue = new ConcurrentLinkedQueue<>();
    private volatile java.util.function.BiConsumer<Long, Boolean> graveSettingsListener;

    public PanelClient(ModConfig config) {
        this.config = config;
        Thread flusher = new Thread(this::flushLoop, "falixpanel-flusher");
        flusher.setDaemon(true);
        flusher.start();
        Thread cfgPoller = new Thread(this::configLoop, "falixpanel-config");
        cfgPoller.setDaemon(true);
        cfgPoller.start();
    }

    /** Registers a callback that receives grave settings polled from the panel. */
    public void onGraveSettings(java.util.function.BiConsumer<Long, Boolean> listener) {
        this.graveSettingsListener = listener;
    }

    /** Polls /api/integration/config every 30s so admin changes reach the game. */
    private void configLoop() {
        while (true) {
            try {
                Thread.sleep(30_000);
                pollConfig();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void pollConfig() {
        if (config.panelUrl().isBlank() || config.integrationSecret().isBlank()) return;
        try {
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(config.panelUrl() + "/api/integration/config"))
                .timeout(TIMEOUT)
                .header("X-Integration-Key", config.integrationSecret())
                .GET()
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() / 100 != 2) return;
            JsonObject root = GSON.fromJson(resp.body(), JsonObject.class);
            if (root == null || !root.has("grave")) return;
            JsonObject grave = root.getAsJsonObject("grave");
            long minutes = grave.has("despawnMinutes") ? grave.get("despawnMinutes").getAsLong() : 60L;
            boolean protection = !grave.has("protection") || grave.get("protection").getAsBoolean();
            java.util.function.BiConsumer<Long, Boolean> l = graveSettingsListener;
            if (l != null) l.accept(minutes, protection);
        } catch (Exception ignored) {
            // Panel offline — keep the last known settings.
        }
    }

    public void sendEvent(String type, String playerName, String message, Map<String, Object> data) {
        JsonObject ev = new JsonObject();
        ev.addProperty("type", type);
        if (playerName != null) ev.addProperty("playerName", playerName);
        if (message != null) ev.addProperty("message", message);
        if (data != null && !data.isEmpty()) ev.add("data", GSON.toJsonTree(data));
        ev.addProperty("occurredAt", java.time.Instant.now().toString());
        queue.add(ev);
    }

    public void sendServerEvent(String type, String message) {
        sendEvent(type, null, message, null);
    }

    private void flushLoop() {
        while (true) {
            try {
                Thread.sleep(2000);
                flush();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /** Sends all queued events in one batch. Safe to call from anywhere. */
    public void flush() {
        if (queue.isEmpty() || config.panelUrl().isBlank() || config.integrationSecret().isBlank()) return;
        List<JsonObject> batch = new ArrayList<>();
        JsonObject drained;
        while ((drained = queue.poll()) != null && batch.size() < 100) {
            batch.add(drained);
        }
        if (batch.isEmpty()) return;

        JsonObject body = new JsonObject();
        com.google.gson.JsonArray arr = new com.google.gson.JsonArray();
        batch.forEach(arr::add);
        body.add("events", arr);

        try {
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(config.panelUrl() + "/api/integration/events"))
                .timeout(TIMEOUT)
                .header("Content-Type", "application/json")
                .header("X-Integration-Key", config.integrationSecret())
                .POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body)))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() / 100 != 2) {
                com.falix.panel.FalixPanelMod.LOGGER.warn("panel returned {} — requeueing {} events", resp.statusCode(), batch.size());
                for (int i = batch.size() - 1; i >= 0; i--) queue.addFirst(batch.get(i));
            }
        } catch (Exception e) {
            for (int i = batch.size() - 1; i >= 0; i--) queue.addFirst(batch.get(i));
            com.falix.panel.FalixPanelMod.LOGGER.warn("panel unreachable ({} events buffered): {}", batch.size(), e.toString());
        }
    }
}
