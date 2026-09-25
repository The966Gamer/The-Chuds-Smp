package com.falix.panel.event;

import com.falix.panel.net.PanelClient;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.stat.Stat;
import net.minecraft.stat.StatType;
import net.minecraft.util.Identifier;

import java.util.HashMap;
import java.util.Map;

/**
 * Every 5 minutes (6000 ticks), pushes each online player's non-zero
 * statistics to the panel using the server's real StatHandler.
 */
public final class StatisticsListener {
    private static final int INTERVAL_TICKS = 20 * 300;
    private static final int MAX_STATS_PER_PUSH = 400;

    private StatisticsListener() {}

    public static void register(PanelClient panel) {
        ServerTickEvents.END_SERVER_TICK.register(server -> {
            if (server.getTicks() % INTERVAL_TICKS != 0) return;
            for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
                pushStats(panel, player);
            }
        });
    }

    private static void pushStats(PanelClient panel, ServerPlayerEntity player) {
        Map<String, Integer> stats = new HashMap<>();
        var statHandler = player.getStatHandler();
        int count = 0;
        for (Stat<?> stat : statHandler.getStatMap().keySet()) {
            if (count >= MAX_STATS_PER_PUSH) break;
            int value = statHandler.getStat(stat);
            if (value <= 0) continue;
            String key = keyFor(stat);
            if (key != null) {
                stats.put(key, value);
                count++;
            }
        }
        if (!stats.isEmpty()) {
            panel.sendEvent("player_statistics", player.getGameProfile().getName(), null, Map.of("stats", stats));
        }
    }

    private static String keyFor(Stat<?> stat) {
        StatType<?> type = stat.getType();
        Identifier typeId = type.getRegistry().getId(stat.getValue());
        Identifier statId = type.getRegistry().getId(type);
        if (typeId == null || statId == null) return null;
        return "minecraft:" + statId.getPath() + ":" + typeId.getPath();
    }
}
