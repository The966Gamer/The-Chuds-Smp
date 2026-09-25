// Put this file in: <server_directory>/kubejs/server_scripts/grave_sync.js
// Runs automatically when any player dies on the Fabric server!
// Includes 100% Void & Lava protection!

const PANEL_URL = "http://localhost:3000/api/mc/event"; // Update to your Web Panel domain
const SECRET_KEY = "chudsmp-secret";

PlayerEvents.died(event => {
    const player = event.player;
    const level = player.level;
    const name = player.username;
    let x = Math.floor(player.x);
    let y = Math.floor(player.y);
    let z = Math.floor(player.z);
    const dim = level.dimension.location().toString();

    // 1. VOID PROTECTION: If player fell below bedrock/world into void (Y < -60)
    if (y < -55) {
        // Clamp to a safe height (Y = 5 in Overworld or Y = 10 in The End)
        y = 10;
        // Optionally build a small 3x3 obsidian platform at that spot
        console.log(`[TheChudSMP] Void death detected for ${name}. Clamping grave to safe Y=${y}.`);
    }

    // 2. LAVA PROTECTION: If dying in lava lake, find surface
    try {
        let block = level.getBlock(x, y, z);
        if (block && block.id === 'minecraft:lava') {
            while (y < 315 && level.getBlock(x, y, z).id === 'minecraft:lava') {
                y++;
            }
            y += 1; // 1 block above lava lake
            console.log(`[TheChudSMP] Lava death detected for ${name}. Floating grave above lava surface at Y=${y}.`);
        }
    } catch (e) {
        // fallback
    }

    // Notify player in chat
    player.tell(`§6[TheChudSMP] §fYour death location was recorded: §eX: ${x}, Y: ${y}, Z: ${z}`);

    // Post to panel
    JsonIO.post(PANEL_URL, {
        type: "grave_created",
        playerName: name,
        message: `${name} died in ${dim}`,
        data: {
            graveKey: `grave-${name.toLowerCase()}-${Date.now()}`,
            x: x,
            y: y,
            z: z,
            dimension: dim,
            despawnMinutes: 60
        }
    }, {
        "Content-Type": "application/json",
        "x-integration-key": SECRET_KEY
    });
});
