package com.falix.panel.event;

import com.falix.panel.net.PanelClient;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.server.network.ServerPlayerEntity;

import java.util.Map;

public final class ConnectionListener {
    private ConnectionListener() {}

    public static void register(PanelClient panel) {
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            ServerPlayerEntity p = handler.getPlayer();
            panel.sendEvent("player_join", p.getGameProfile().getName(),
                p.getGameProfile().getName() + " joined",
                Map.of("uuid", p.getUuid().toString()));
        });
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            ServerPlayerEntity p = handler.getPlayer();
            panel.sendEvent("player_leave", p.getGameProfile().getName(),
                p.getGameProfile().getName() + " left",
                Map.of("uuid", p.getUuid().toString()));
        });
    }
}
