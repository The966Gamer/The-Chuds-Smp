package com.falix.panel.event;

import com.falix.panel.net.PanelClient;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;

import java.util.Map;

public final class ChatListener {
    private ChatListener() {}

    public static void register(PanelClient panel) {
        // ALL = game chat (ignores /say and plugin messages on purpose).
        ServerMessageEvents.ALLOW_CHAT_MESSAGE.register((message, sender, params) -> {
            panel.sendEvent("chat_message", sender.getGameProfile().getName(),
                message.getSignedContent().plain(), Map.of());
            return true; // never block real chat
        });
    }
}
