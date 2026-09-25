package com.falix.panel.grave;

import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtList;
import net.minecraft.registry.RegistryWrapper;
import net.minecraft.util.math.BlockPos;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class GraveBlockEntity extends BlockEntity {
    private UUID owner;
    private String graveKey = "";
    private final List<ItemStack> inventory = new ArrayList<>();

    public GraveBlockEntity(BlockPos pos, BlockState state) {
        super(GraveBlockHolder.GRAVE_BLOCK_ENTITY, pos, state);
    }

    public UUID owner() {
        return owner;
    }

    public String graveKey() {
        return graveKey;
    }

    public List<ItemStack> inventory() {
        return inventory;
    }

    public void setOwner(UUID owner) {
        this.owner = owner;
        this.markDirty();
    }

    public void setGraveKey(String key) {
        this.graveKey = key;
        this.markDirty();
    }

    public void storeInventory(List<ItemStack> stacks) {
        inventory.clear();
        for (ItemStack s : stacks) {
            if (s != null && !s.isEmpty()) inventory.add(s.copy());
        }
        this.markDirty();
    }

    @Override
    protected void readNbt(NbtCompound nbt, RegistryWrapper.WrapperLookup lookup) {
        super.readNbt(nbt, lookup);
        if (nbt.containsUuid("owner")) owner = nbt.getUuid("owner");
        graveKey = nbt.getString("graveKey");
        inventory.clear();
        NbtList list = nbt.getList("items");
        for (int i = 0; i < list.size(); i++) {
            ItemStack.fromNbt(lookup, list.getCompound(i)).ifPresent(inventory::add);
        }
    }

    @Override
    protected void writeNbt(NbtCompound nbt, RegistryWrapper.WrapperLookup lookup) {
        super.writeNbt(nbt, lookup);
        if (owner != null) nbt.putUuid("owner", owner);
        nbt.putString("graveKey", graveKey);
        NbtList list = new NbtList();
        for (ItemStack s : inventory) {
            list.add(s.encode(lookup));
        }
        nbt.put("items", list);
    }
}
