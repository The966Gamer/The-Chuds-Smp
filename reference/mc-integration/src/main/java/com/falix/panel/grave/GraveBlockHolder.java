package com.falix.panel.grave;

import net.minecraft.block.entity.BlockEntityType;
import net.minecraft.block.Block;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

/** Holds the registered grave block + block entity type. */
public final class GraveBlockHolder {
    public static final Block GRAVE_BLOCK = Registry.register(
        Registries.BLOCK,
        Identifier.of("falixpanel", "grave"),
        new GraveBlock(GraveBlock.settings())
    );

    public static final BlockEntityType<GraveBlockEntity> GRAVE_BLOCK_ENTITY = Registry.register(
        Registries.BLOCK_ENTITY_TYPE,
        Identifier.of("falixpanel", "grave"),
        BlockEntityType.Builder.create(GraveBlockEntity::new, GRAVE_BLOCK).build()
    );

    private GraveBlockHolder() {}
}
