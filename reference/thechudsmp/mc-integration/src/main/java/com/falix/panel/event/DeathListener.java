package com.falix.panel.event;

import com.falix.panel.FalixPanelMod;
import com.falix.panel.grave.GraveManager;
import com.falix.panel.net.PanelClient;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.LivingEntity;
import net.minecraft.server.network.ServerPlayerEntity;

import java.util.Map;

public final class DeathListener {
    private DeathListener() {}

    public static void register(PanelClient panel, GraveManager graves) {
        ServerLivingEntityEvents.AFTER_DEATH.register((LivingEntity entity, DamageSource source) -> {
            if (!(entity instanceof ServerPlayerEntity player)) return;
            String name = player.getGameProfile().getName();
            String message = source.getDeathMessage(player).getString();

            panel.sendEvent("player_death", name, message, Map.of(
                "dimension", player.getWorld().getRegistryKey().getValue().toString(),
                "x", player.getBlockX(),
                "y", player.getBlockY(),
                "z", player.getBlockZ()
            ));

            try {
                graves.createGrave(player, source);
            } catch (Exception e) {
                FalixPanelMod.LOGGER.error("failed to create grave for {}", name, e);
            }
        });
    }
}
