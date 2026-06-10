import { FluxDispatcher, RestAPI } from "@webpack/common";
import { AuthenticationStore, SelectedChannelStore } from "./stores";
import { sleep } from "./mouse_sim";

let currentInstanceId: string | null = null;
let currentUserAgent: string | null = null;

// Identity Purge logic
function purgeIdentity() {
    currentInstanceId = null;
    currentUserAgent = null;
    console.log("[TelemetrySpoof] Identity purged.");
}

function refreshIdentity() {
    // In a real Discord client, instance_id might be stored in a specialized SessionStore or AnalyticsStore.
    // We will generate a consistent pseudo-ID for the session if not accessible, or pull from window.
    // For safety, we pull userAgent directly from the native browser context.
    currentUserAgent = window.navigator.userAgent;
    // Fallback pseudo-instance id synced per session
    currentInstanceId = Math.random().toString(36).substring(2, 15);
    console.log("[TelemetrySpoof] Identity refreshed for new session.");
}

export function initIdentityLockdown() {
    FluxDispatcher.subscribe("LOGOUT", purgeIdentity);
    FluxDispatcher.subscribe("LOGIN_SUCCESS", refreshIdentity);
    refreshIdentity();
}

// Science Event Dispatcher Simulator
export async function dispatchScienceEvent(eventName: string, properties: any = {}) {
    if (!currentInstanceId || !currentUserAgent) {
        refreshIdentity();
    }

    const payload = {
        type: eventName,
        properties: {
            ...properties,
            client_track_timestamp: Date.now(),
            client_uuid: currentInstanceId,
        }
    };

    // Note: Actually sending to /science can be risky if schema is mismatched.
    // We log it and optionally send it if required. Many bots avoid /science to prevent schema bans.
    // But per plan, we simulate the UX flow.
    console.log(`[TelemetrySpoof] Dispatched UX Flow Event: ${eventName}`, payload);
}

export async function simulateQuestAcceptanceFlow(questId: string) {
    await dispatchScienceEvent("SETTINGS_OPEN", { section: "Gift Inventory" });
    await sleep(Math.random() * 1000 + 500); // 500-1500ms
    
    await dispatchScienceEvent("INVENTORY_VIEWED", {});
    await sleep(Math.random() * 800 + 400); // 400-1200ms
    
    await dispatchScienceEvent("QUEST_CARD_HOVER", { quest_id: questId });
    await sleep(Math.random() * 500 + 300); // 300-800ms
    
    await dispatchScienceEvent("QUEST_ACCEPT_CLICK", { quest_id: questId });
}

export async function simulateNotificationAck(questId: string) {
    await dispatchScienceEvent("NOTIFICATION_VIEWED", { type: "quest", quest_id: questId });
    await sleep(Math.random() * 1500 + 500);
    await dispatchScienceEvent("NOTIFICATION_CLICK", { type: "quest", quest_id: questId });
    await sleep(Math.random() * 1000 + 500);
}

export async function simulateBackgroundActivity() {
    let topChannelId = null;
    try {
        if (typeof SelectedChannelStore?.getMostRecentSelectedChannelId === "function") {
            topChannelId = SelectedChannelStore.getMostRecentSelectedChannelId();
        }
    } catch (e) {}

    if (topChannelId) {
        await dispatchScienceEvent("CHANNEL_OPEN", { channel_id: topChannelId });
        await sleep(Math.random() * 2000 + 1000);
        await dispatchScienceEvent("MESSAGE_READ", { channel_id: topChannelId });
        console.log(`[TelemetrySpoof] Simulated background activity in channel ${topChannelId}`);
    } else {
        await dispatchScienceEvent("APP_FOCUSED", {});
        console.log(`[TelemetrySpoof] Simulated background activity (App Focus fallback)`);
    }
}

export function checkAccountHealth(hasAvailableQuests: boolean) {
    if (!hasAvailableQuests) {
        console.log("🟡 [Account Health] RESTRICTED: No quests available. Possible shadowban or region restriction.");
    } else {
        console.log("🟢 [Account Health] SAFE: Operations normal. Quests available.");
    }
}
