package com.falix.panel.grave;

import net.minecraft.block.Block;
import net.minecraft.block.BlockRenderType;
import net.minecraft.block.BlockState;
import net.minecraft.block.BlockEntityType;
import net.minecraft.block.BlockWithEntity;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.piston.PistonBehavior;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;
import net.minecraft.world.explosion.Explosion;

/**
 * A grave block. Protection rules enforced HERE (game-side authority):
 *  - only the owner (or an operator) may open it (when protection is enabled
 *    by the admin in the panel — GraveBlockEntity reads the live flag)
 *  - cannot be moved by pistons
 *  - resists explosions
 */
public class GraveBlock extends BlockWithEntity {
    public static net.minecraft.block.AbstractBlock.Settings settings() {
        return net.minecraft.block.AbstractBlock.Settings.create()
            .strength(2.0f, 1200.0f)      // blast resistant like obsidian-ish
            .pistonBehavior(PistonBehavior.BLOCK)
            .nonOpaque();
    }

    public GraveBlock(net.minecraft.block.AbstractBlock.Settings settings) {
        super(settings);
    }

    @Override
    public BlockEntity createBlockEntity(BlockPos pos, BlockState state) {
        return new GraveBlockEntity(pos, state);
    }

    @Override
    public BlockRenderType getRenderType(BlockState state) {
        return BlockRenderType.MODEL;
    }

    @Override
    public ActionResult onUse(BlockState state, World world, BlockPos pos, PlayerEntity player, BlockHitResult hit) {
        if (world.getBlockEntity(pos) instanceof GraveBlockEntity grave) {
            boolean isOwner = player.getUuid().equals(grave.owner());
            boolean isOp = player.hasPermissionLevel(2);
            boolean protectionOn = com.falix.panel.FalixPanelMod.graves() == null
                || com.falix.panel.FalixPanelMod.graves().isProtectionEnabled();
            if (protectionOn && !isOwner && !isOp) {
                if (player instanceof ServerPlayerEntity sp) {
                    sp.sendMessage(Text.literal("This grave is protected."), true);
                }
                return ActionResult.SUCCESS;
            }
            // Give contents to the opener, then remove the grave.
            for (ItemStack stack : grave.inventory()) {
                if (!stack.isEmpty() && player.getInventory() != null) {
                    if (!player.getInventory().insertStack(stack)) {
                        player.dropItem(stack, false);
                    }
                }
            }
            if (!world.isClient) {
                FalixPanelBridge.recovered(world, pos, grave);
                world.removeBlock(pos, false);
            }
            return ActionResult.SUCCESS;
        }
        return ActionResult.PASS;
    }

    @Override
    public void onDestroyedOnExplosion(World world, BlockPos pos, Explosion explosion) {
        // Graves survive explosions.
    }

    /** Indirection so the block can report recovery without a circular dependency. */
    static final class FalixPanelBridge {
        static void recovered(World world, BlockPos pos, GraveBlockEntity grave) {
            var server = world.getServer();
            if (server == null) return;
            var manager = com.falix.panel.FalixPanelMod.graves();
            if (manager != null) manager.recover(grave.graveKey());
        }
    }
}
