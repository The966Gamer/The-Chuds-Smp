# TheChudSMP Panel Bridge (Fabric 1.20 - 1.21+)

Connects your Minecraft Fabric Server to your TheChudSMP Dashboard panel to automatically sync:
- **Player Deaths & Grave Coordinates (X, Y, Z, Dimension)**
- **Player Joins and Leaves**
- **In-game Chat Messages**

---

### Option A: 1-File Script with KubeJS (Zero Compilation Required)
If your Fabric server has **KubeJS** installed:
1. Copy `kubejs_grave_sync.js` into your server's `kubejs/server_scripts/` folder.
2. Open the file and update `PANEL_URL` to your live website URL (e.g. `https://your-panel.netlify.app/api/mc/event`).
3. Type `/reload` in your server console. Done!

---

### Option B: Compile the Standalone Fabric Mod (.jar)
If you want a compiled `.jar` to drop into `/mods`:
1. Make sure you have **JDK 21** installed.
2. In this `fabric-mod` directory, run:
   ```bash
   ./gradlew build
   ```
3. Find your compiled mod in `build/libs/thechudsmp-bridge-1.0.0.jar`.
4. Upload it to your FalixNodes `/mods` directory and restart the server!
