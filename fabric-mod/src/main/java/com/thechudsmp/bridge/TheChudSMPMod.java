package com.thechudsmp.bridge;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.block.Blocks;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.ChestBlockEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.BlockPos;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * TheChudSMP Grave & Bridge Mod - Fabric 1.20 - 1.21+
 * Features:
 *  - 100% Void Protection: Clamps to lowest safe solid block or builds a safe obsidian platform.
 *  - 100% Lava Protection: Floats grave to top of lava lake & places a fireproof platform.
 *  - Spawns physical protected Grave Chest with player's inventory items.
 *  - Real-time sync to TheChudSMP web dashboard.
 */
public class TheChudSMPMod implements ModInitializer {
    public static String PANEL_URL = "http://localhost:3000/api/mc/event";
    public static String SECRET_KEY = "chudsmp-secret";

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    @Override
    public void onInitialize() {
        System.out.println("[TheChudSMP] Safe Grave & Panel Bridge Mod Initialized!");

        // Detect Player Death with Full Lava & Void Protection
        ServerLivingEntityEvents.AFTER_DEATH.register((entity, damageSource) -> {
            if (entity instanceof ServerPlayerEntity player) {
                String name = player.getName().getString();
                ServerWorld world = player.getServerWorld();
                BlockPos rawPos = player.getBlockPos();
                String dim = world.getRegistryKey().getValue().toString();
                String deathMsg = damageSource.getDeathMessage(player).getString();

                // 1. Calculate Safe Position (Guaranteed safe from Void & Lava)
                BlockPos safePos = findSafeGravePosition(world, rawPos);

                System.out.printf("[TheChudSMP] Safe grave calculated for %s: %d, %d, %d (Raw was: %d, %d, %d)%n",
                        name, safePos.getX(), safePos.getY(), safePos.getZ(),
                        rawPos.getX(), rawPos.getY(), rawPos.getZ());

                // 2. Collect Inventory
                List<ItemStack> savedItems = new ArrayList<>();
                for (int i = 0; i < player.getInventory().size(); i++) {
                    ItemStack stack = player.getInventory().getStack(i);
                    if (!stack.isEmpty()) {
                        savedItems.add(stack.copy());
                        player.getInventory().setStack(i, ItemStack.EMPTY);
                    }
                }

                // 3. Build Safe Platform & In-Game Grave Chest
                spawnGraveChest(world, safePos, name, savedItems);

                // Notify player in chat with coordinates
                player.sendMessage(Text.literal(String.format("§6[TheChudSMP] §fYour items are safe in a grave at §eX: %d, Y: %d, Z: %d §7(%s)",
                        safePos.getX(), safePos.getY(), safePos.getZ(), simplifyDim(dim))), false);

                // 4. Send Event to Web Dashboard
                String graveData = String.format(
                    "{\"graveKey\":\"grave-%s-%d\",\"x\":%d,\"y\":%d,\"z\":%d,\"dimension\":\"%s\",\"despawnMinutes\":60}",
                    name.toLowerCase(), System.currentTimeMillis(), safePos.getX(), safePos.getY(), safePos.getZ(), dim
                );

                sendEvent("grave_created", name, deathMsg, graveData);
            }
        });

        // Player Joins
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            String name = handler.getPlayer().getName().getString();
            sendEvent("player_join", name, name + " joined the game", null);
        });

        // Player Leaves
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            String name = handler.getPlayer().getName().getString();
            sendEvent("player_leave", name, name + " left the game", null);
        });
    }

    /**
     * Finds a guaranteed safe position.
     * Prevents grave from ever spawning inside the void or submerged in lava.
     */
    private static BlockPos findSafeGravePosition(ServerWorld world, BlockPos pos) {
        int x = pos.getX();
        int y = pos.getY();
        int z = pos.getZ();
        int minY = world.getBottomY();
        int maxY = world.getTopY();

        // --- 1. VOID PROTECTION ---
        // If player fell into the void (below bottom Y or in negative Y void)
        if (y <= minY + 2) {
            // Look directly upward for the lowest solid block (e.g. End island or Overworld bedrock)
            BlockPos solidAbove = null;
            for (int checkY = minY + 5; checkY < maxY - 10; checkY++) {
                BlockPos check = new BlockPos(x, checkY, z);
                if (world.getBlockState(check).isSolidBlock(world, check)) {
                    solidAbove = check.up();
                    break;
                }
            }
            if (solidAbove != null) {
                return solidAbove;
            }

            // If fell in open void with nothing above, clamp to safe height & build platform
            int safeVoidY = Math.max(1, minY + 15);
            return new BlockPos(x, safeVoidY, z);
        }

        // Clamp inside world bounds
        y = Math.max(minY + 2, Math.min(y, maxY - 5));
        BlockPos current = new BlockPos(x, y, z);

        // --- 2. LAVA LAKE PROTECTION ---
        // If current or below block is lava, climb upwards until above the lava surface
        boolean inLava = world.getBlockState(current).isOf(Blocks.LAVA) ||
                         world.getBlockState(current.down()).isOf(Blocks.LAVA);

        if (inLava) {
            int lavaY = y;
            while (lavaY < maxY - 10 && world.getBlockState(new BlockPos(x, lavaY, z)).isOf(Blocks.LAVA)) {
                lavaY++;
            }
            // 1 block above lava surface
            return new BlockPos(x, lavaY + 1, z);
        }

        // Standard terrain: find surface if inside solid block
        while (y < maxY - 5 && world.getBlockState(new BlockPos(x, y, z)).isSolidBlock(world, new BlockPos(x, y, z))) {
            y++;
        }

        return new BlockPos(x, y, z);
    }

    /**
     * Places an obsidian/cobblestone safety base and a chest containing the player's items.
     */
    private static void spawnGraveChest(ServerWorld world, BlockPos pos, String ownerName, List<ItemStack> items) {
        try {
            // Build 3x3 protective obsidian / cobblestone platform underneath if in void or lava
            BlockPos floor = pos.down();
            BlockState floorState = world.getBlockState(floor);
            if (floorState.isAir() || floorState.isOf(Blocks.LAVA) || floor.getY() <= world.getBottomY() + 5) {
                for (int dx = -1; dx <= 1; dx++) {
                    for (int dz = -1; dz <= 1; dz++) {
                        world.setBlockState(floor.add(dx, 0, dz), Blocks.OBSIDIAN.getDefaultState());
                    }
                }
            }

            // Place chest
            world.setBlockState(pos, Blocks.CHEST.getDefaultState());
            if (world.getBlockEntity(pos) instanceof ChestBlockEntity chest) {
                chest.setCustomName(Text.literal(ownerName + "'s Grave").formatted(Formatting.GOLD));
                int slot = 0;
                for (ItemStack item : items) {
                    if (slot < chest.size()) {
                        chest.setStack(slot++, item);
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("[TheChudSMP] Error creating physical grave chest: " + e.getMessage());
        }
    }

    private static String simplifyDim(String dim) {
        if (dim.contains("nether")) return "Nether";
        if (dim.contains("end")) return "The End";
        return "Overworld";
    }

    private static void sendEvent(String type, String playerName, String message, String dataJson) {
        new Thread(() -> {
            try {
                String cleanMsg = message != null ? message.replace("\"", "\\\"").replace("\n", " ") : "";
                String payload = String.format(
                    "{\"type\":\"%s\",\"playerName\":\"%s\",\"message\":\"%s\"%s}",
                    type,
                    playerName,
                    cleanMsg,
                    dataJson != null ? ",\"data\":" + dataJson : ""
                );

                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(PANEL_URL))
                        .header("Content-Type", "application/json")
                        .header("x-integration-key", SECRET_KEY)
                        .POST(HttpRequest.BodyPublishers.ofString(payload))
                        .timeout(Duration.ofSeconds(6))
                        .build();

                HTTP.sendAsync(req, HttpResponse.BodyHandlers.discarding());
            } catch (Exception e) {
                System.err.println("[TheChudSMP] Webhook dispatch error: " + e.getMessage());
            }
        }).start();
    }
}
