package com.falix.panel.config;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * Mod configuration. Values are read from (in order):
 *   1. environment variables PANEL_URL / INTEGRATION_SECRET_KEY
 *   2. config/falixpanel.properties inside the server directory
 */
public final class ModConfig {
    private final String panelUrl;
    private final String integrationSecret;

    private ModConfig(String panelUrl, String integrationSecret) {
        this.panelUrl = panelUrl;
        this.integrationSecret = integrationSecret;
    }

    public static ModConfig load() {
        Properties props = new Properties();
        Path cfg = Path.of("config", "falixpanel.properties");
        if (Files.isRegularFile(cfg)) {
            try (InputStream in = Files.newInputStream(cfg)) {
                props.load(in);
            } catch (IOException e) {
                FalixPanelModAccess.log("could not read " + cfg + ": " + e.getMessage());
            }
        }
        String url = firstNonBlank(
            System.getenv("PANEL_URL"),
            props.getProperty("panelUrl"),
            "http://localhost:3000"
        );
        String secret = firstNonBlank(
            System.getenv("INTEGRATION_SECRET_KEY"),
            props.getProperty("integrationSecret"),
            ""
        );
        return new ModConfig(url.replaceAll("/+$", ""), secret);
    }

    public String panelUrl() {
        return panelUrl;
    }

    public String integrationSecret() {
        return integrationSecret;
    }

    private static String firstNonBlank(String a, String b, String fallback) {
        if (a != null && !a.isBlank()) return a;
        if (b != null && !b.isBlank()) return b;
        return fallback;
    }

    /** Helper indirection so load() can log without circular init. */
    static final class FalixPanelModAccess {
        static void log(String msg) {
            com.falix.panel.FalixPanelMod.LOGGER.warn(msg);
        }
    }
}
