package com.falix.panel.grave;

import com.falix.panel.net.PanelClient;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Creates, tracks and despawns graves. The grave block itself (GraveBlock)
 * enforces protection in-game; this class is the bookkeeper.
 *
 * The despawn timer and protection flag are admin-editable in the panel; the
 * net config poller pushes updates here via {@link #applySettings}.
 */
public final class GraveManager {
    /** fallback despawn: 1 hour of game time (admin override via panel). */
    private static final long DESPAWN_TICKS_DEFAULT = 20L * 60 * 60;

    private final PanelClient panel;
    private final Map<String, GraveEntry> active = new ConcurrentHashMap<>();
    private volatile long despawnTicks = DESPAWN_TICKS_DEFAULT;
    private volatile boolean protection = true;

    public GraveManager(PanelClient panel) {
        this.panel = panel;
    }

    /** Applies admin settings polled from the panel (minutes + protection). */
    public void applySettings(long despawnMinutes, boolean protectionEnabled) {
        long minutes = Math.max(5, Math.min(7L * 24 * 60, despawnMinutes));
        this.despawnTicks = 20L * 60 * Math.max(1, minutes);
        this.protection = protectionEnabled;
        // Reschedule graves created under an older timer (tick ≈ 50 ms).
        long now = System.currentTimeMillis() / 50L;
        for (GraveEntry e : active.values()) {
            e.despawnAtTick = Math.max(now + 1, e.createdAtTick + despawnTicks);
        }
    }

    public boolean isProtectionEnabled() {
        return protection;
    }

    public void createGrave(ServerPlayerEntity player, DamageSource source) {
        ServerWorld world = player.getServerWorld();
        BlockPos pos = player.getBlockPos();
        String graveKey = UUID.randomUUID().toString();

        BlockState state = world.getBlockState(pos);
        boolean replaced = state.isAir() || state.getFluidState().isEmpty() && !state.isLiquid();
        if (!state.isAir() && !state.isReplaceable()) {
            pos = pos.up();
        }

        try {
            world.setBlockState(pos, GraveBlockHolder.GRAVE_BLOCK.getDefaultState(), Block.NOTIFY_ALL);
        } catch (Exception e) {
            // Grave block unavailable (wrong position, protected land, ...) — still report the death.
            return;
        }

        GraveEntry entry = new GraveEntry(graveKey, player.getUuid(), player.getGameProfile().getName(),
            pos.toImmutable(), world.getRegistryKey().getValue().toString(),
            world.getTime() + despawnTicks);
        active.put(graveKey, entry);

        Map<String, Object> data = Map.of(
            "graveKey", graveKey,
            "x", pos.getX(),
            "y", pos.getY(),
            "z", pos.getZ(),
            "dimension", entry.dimension,
            "deathTime", Instant.now().toString(),
            "despawnAt", Instant.now().plusSeconds(despawnTicks / 20).toString(),
            "status", "active",
            "protected", true
        );
        panel.sendEvent("grave_created", entry.playerName, "Grave created at " +
            pos.getX() + " " + pos.getY() + " " + pos.getZ(), data);
    }

    /** Called when a player recovers their grave (GraveBlock#onUse). */
    public void recover(String graveKey) {
        GraveEntry e = active.remove(graveKey);
        if (e == null) return;
        panel.sendEvent("grave_removed", e.playerName, "Grave recovered",
            Map.of("graveKey", graveKey, "status", "recovered"));
    }

    public java.util.List<GraveEntry> listFor(java.util.UUID owner) {
        java.util.List<GraveEntry> out = new java.util.ArrayList<>();
        for (GraveEntry e : active.values()) {
            if (e.owner.equals(owner)) out.add(e);
        }
        return out;
    }

    public void tick(ServerWorld world) {
        long now = world.getTime();
        for (GraveEntry e : active.values()) {
            if (now >= e.despawnAtTick) {
                BlockPos pos = e.pos;
                if (world.getBlockState(pos).getBlock() == GraveBlockHolder.GRAVE_BLOCK) {
                    world.removeBlock(pos, false);
                }
                active.remove(e.graveKey);
                panel.sendEvent("grave_removed", e.playerName, "Grave expired",
                    Map.of("graveKey", e.graveKey, "status", "despawned"));
            }
        }
    }

    public static final class GraveEntry {
        public final String graveKey;
        public final UUID owner;
        public final String playerName;
        public final BlockPos pos;
        public final String dimension;
        public final long createdAtTick;
        public volatile long despawnAtTick;

        GraveEntry(String graveKey, UUID owner, String playerName, BlockPos pos, String dimension, long despawnAtTick) {
            this.graveKey = graveKey;
            this.owner = owner;
            this.playerName = playerName;
            this.pos = pos;
            this.dimension = dimension;
            this.createdAtTick = despawnAtTick - despawnTicks;
            this.despawnAtTick = despawnAtTick;
        }
    }
}
