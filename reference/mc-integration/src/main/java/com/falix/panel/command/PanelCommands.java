package com.falix.panel.command;

import com.falix.panel.FalixPanelMod;
import com.falix.panel.grave.GraveManager;
import com.falix.panel.net.PanelClient;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.text.Text;

import static net.minecraft.server.command.CommandManager.literal;

/**
 * The /panel command tree. Minecraft-side permission checks use the vanilla
 * permission level system; panel-side permissions are enforced by the web API.
 */
public final class PanelCommands {
    private PanelCommands() {}

    public static void register(GraveManager graves, PanelClient panel) {
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
            registerAll((CommandDispatcher<ServerCommandSource>) dispatcher, graves, panel));
    }

    private static void registerAll(CommandDispatcher<ServerCommandSource> dispatcher, GraveManager graves, PanelClient panel) {
        var root = literal("panel");

        root.then(literal("help").executes(ctx -> {
            ctx.getSource().sendFeedback(() -> Text.literal(
                """
                /panel status          — server status
                /panel graves          — your active graves
                /panel chat            — chat relay is always on; use the web panel to read it
                /panel notifications   — recent panel notifications
                /panel server restart  — admins: restart via the panel
                """), false);
            return 1;
        }));

        root.executes(ctx -> {
            ctx.getSource().sendFeedback(() -> Text.literal(
                "Falix Panel linked. Try /panel help"), false);
            return 1;
        });

        root.then(literal("status").executes(ctx -> {
            var server = ctx.getSource().getServer();
            long mspt = Math.round(server.getAverageNanosPerTick() / 1_000_000.0);
            ctx.getSource().sendFeedback(() -> Text.literal(
                String.format("TPS: %.1f | MSPT: %d | Players: %d/%d | Uptime: %d min",
                    Math.min(20.0, 1000.0 / Math.max(1, mspt)), mspt,
                    server.getCurrentPlayerCount(), server.getMaxPlayerCount(),
                    (int) (server.getTicks() / 20 / 60))), false);
            return 1;
        }));

        root.then(literal("graves").executes(ctx -> {
            var player = ctx.getSource().getPlayer();
            if (player == null) return 0;
            var list = graves.listFor(player.getUuid());
            if (list.isEmpty()) {
                ctx.getSource().sendFeedback(() -> Text.literal("You have no active graves."), false);
            } else {
                ctx.getSource().sendFeedback(() -> Text.literal("Your graves:"), false);
                for (var g : list) {
                    ctx.getSource().sendFeedback(() -> Text.literal(
                        String.format(" • %s %d %d %d", g.dimension, g.pos.getX(), g.pos.getY(), g.pos.getZ())), false);
                }
            }
            return 1;
        }));

        root.then(literal("chat").executes(ctx -> {
            ctx.getSource().sendFeedback(() -> Text.literal(
                "Chat relay is active — read it in the web panel's Chat tab."), false);
            return 1;
        }));

        root.then(literal("notifications").executes(ctx -> {
            ctx.getSource().sendFeedback(() -> Text.literal(
                "Panel notifications live in the web panel (bell icon)."), false);
            return 1;
        }));

        // Admin subtree — vanilla permission level 3+ required IN GAME.
        var serverAdmin = literal("server")
            .requires(src -> src.hasPermissionLevel(3));
        serverAdmin.then(literal("restart").executes(ctx -> {
            panel.sendServerEvent("server_restart", "Restart requested in-game by " +
                (ctx.getSource().getName() == null ? "console" : ctx.getSource().getName()));
            panel.flush();
            ctx.getSource().getServer().getCommandManager().executeWithPrefix(
                ctx.getSource().getServer().getCommandSource(),
                "restart");
            return 1;
        }));
        root.then(serverAdmin);

        dispatcher.register(root);
    }
}
