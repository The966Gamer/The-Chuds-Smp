package com.falix.panel;

import com.falix.panel.command.PanelCommands;
import com.falix.panel.config.ModConfig;
import com.falix.panel.event.ChatListener;
import com.falix.panel.event.ConnectionListener;
import com.falix.panel.event.DeathListener;
import com.falix.panel.event.StatisticsListener;
import com.falix.panel.grave.GraveManager;
import com.falix.panel.net.PanelClient;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class FalixPanelMod implements ModInitializer {
    public static final String MOD_ID = "falixpanel";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private static PanelClient panelClient;
    private static GraveManager graveManager;

    @Override
    public void onInitialize() {
        ModConfig config = ModConfig.load();

        if (config.panelUrl().isBlank() || config.integrationSecret().isBlank()) {
            LOGGER.warn("[falixpanel] PANEL_URL / INTEGRATION_SECRET_KEY not configured; events will be queued until configured");
        }

        panelClient = new PanelClient(config);
        graveManager = new GraveManager(panelClient);

        // Admin changes made in the panel (grave despawn/protection) reach the
        // game through the client's config poller.
        panelClient.onGraveSettings((despawnMinutes, protection) ->
            graveManager.applySettings(despawnMinutes, protection));

        ConnectionListener.register(panelClient);
        DeathListener.register(panelClient, graveManager);
        ChatListener.register(panelClient);
        StatisticsListener.register(panelClient);
        PanelCommands.register(graveManager, panelClient);

        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            panelClient.sendServerEvent("server_start", "Server started (" + server.getServerPort() + ")");
        });
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
            panelClient.flush();
            panelClient.sendServerEvent("server_stop", "Server stopping");
        });
        ServerLifecycleEvents.SERVER_CRASHED.register(server -> {
            panelClient.sendServerEvent("server_crash", "Server crashed");
        });

        LOGGER.info("[falixpanel] initialized; panel url = {}", config.panelUrl());
    }

    public static PanelClient panel() {
        return panelClient;
    }

    public static GraveManager graves() {
        return graveManager;
    }
}
