/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import type { PluginNative } from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { FluxDispatcher, RestAPI } from "@webpack/common";

import { QuestButton, QuestsCount } from "./components/QuestButton";
import settings from "./settings";
import { ChannelStore, GuildChannelStore, QuestsStore, RunningGameStore } from "./stores";
import { initIdentityLockdown, simulateQuestAcceptanceFlow, simulateNotificationAck, simulateBackgroundActivity, checkAccountHealth } from "./telemetry_spoof";
import { performHumanizedAction, sleep } from "./mouse_sim";

// Native module for CSP-exempt discordsays requests (achievement quests)
const Native = VencordNative.pluginHelpers.CompleteDiscordQuest as PluginNative<typeof import("./native")>;

const QuestApplyAction = findByCodeLazy("type:\"QUESTS_ENROLL_BEGIN\"") as (questId: string, action: QuestAction) => Promise<any>;
const QuestLocationMap = findByPropsLazy("QUEST_HOME_DESKTOP", "11") as Record<string, any>;

let availableQuests: QuestValue[] = [];
let acceptableQuests: QuestValue[] = [];
let completableQuests: QuestValue[] = [];

const completingQuest = new Map();
const fakeGames = new Map();
const fakeApplications = new Map();

export default definePlugin({
    name: "CompleteDiscordQuest",
    description: "A plugin that completes multiple discord quests in background simultaneously.",
    authors: [{
        name: "jjtjtyt6644",
        id: 833611503181627433n
    }],
    settings,
    patches: [
        {
            find: ".PlatformTypes.WEB",
            replacement: {
                match: /(\((\i)\){)(let{leading)/,
                replace: "$1$2?.trailing?.props?.children?.unshift($self.renderQuestButtonTopBar());$3"
            }
        },
        {
            find: "accountContainerRef:",
            replacement: {
                match: /className:\i\.Uo,style:\i,children:\[/,
                replace: "$&$self.renderQuestButtonSettingsBar(),"
            }
        },
        { // PTB Experimental
            find: "\"innerRef\",\"navigate\",\"onClick\"",
            replacement: {
                match: /(\i).createElement\("a",(\i)\)/,
                replace: "$1.createElement(\"a\",$self.renderQuestButtonBadges($2))"
            }
        },
        {
            find: "\"RunningGameStore\"",
            group: true,
            replacement: [
                {
                    match: /}getRunningGames\(\){return/,
                    replace: "}getRunningGames(){const games=$self.getRunningGames();return games ? games : "
                },
                {
                    match: /}getGameForPID\((\i)\){/,
                    replace: "}getGameForPID($1){const pid=$self.getGameForPID($1);if(pid){return pid;}"
                }
            ]
        },
        {
            find: "ApplicationStreamingStore",
            replacement: {
                match: /}getStreamerActiveStreamMetadata\(\){/,
                replace: "}getStreamerActiveStreamMetadata(){const metadata=$self.getStreamerActiveStreamMetadata();if(metadata){return metadata;}"
            }
        }
    ],
    start: () => {
        initIdentityLockdown();
        QuestsStore.addChangeListener(updateQuestsWrapper);
        updateQuestsWrapper();
    },
    stop: () => {
        QuestsStore.removeChangeListener(updateQuestsWrapper);
        stopCompletingAll();
    },

    renderQuestButtonTopBar() {
        if (settings.store.showQuestsButtonTopBar) {
            return <QuestButton type="top-bar" />;
        }
    },

    renderQuestButtonSettingsBar() {
        if (settings.store.showQuestsButtonSettingsBar) {
            return <QuestButton type="settings-bar" />;
        }
    },

    renderQuestButtonBadges(questButton) {
        if (settings.store.showQuestsButtonBadges && typeof questButton === "string" && questButton === "quests") {
            return (<QuestsCount />);
        }
        // Experiment
        if (settings.store.showQuestsButtonBadges && questButton?.href?.startsWith("/quest-home")
            && Array.isArray(questButton?.children) && questButton.children.findIndex(child => child?.type === QuestsCount) === -1) {
            questButton.children.push(<QuestsCount />);
        }
        return questButton;
    },

    getRunningGames() {
        if (fakeGames.size > 0) {
            return Array.from(fakeGames.values());
        }
    },

    getGameForPID(pid) {
        if (fakeGames.size > 0) {
            return Array.from(fakeGames.values()).find(game => game.pid === pid);
        }
    },

    getStreamerActiveStreamMetadata() {
        if (fakeApplications.size > 0) {
            return Array.from(fakeApplications.values()).at(0);
        }
    }
});

function isQuestEligibleForFarming(quest: QuestValue): boolean {
    const questConfig = quest.config.taskConfig || quest.config.taskConfigV2;
    if (!Object.keys(questConfig.tasks).some(taskName => {
        return (taskName === "WATCH_VIDEO" && settings.store.farmVideos
            || taskName === "WATCH_VIDEO_ON_MOBILE" && settings.store.farmVideos
            || taskName === "PLAY_ON_DESKTOP" && settings.store.farmPlayOnDesktop
            || taskName === "STREAM_ON_DESKTOP" && settings.store.farmStreamOnDesktop
            || taskName === "PLAY_ACTIVITY" && settings.store.farmPlayActivity
            || taskName === "ACHIEVEMENT_IN_ACTIVITY" && settings.store.farmAchievement);
    })) return false;

    const rewards = quest.config?.rewardsConfig?.rewards || [];
    if (!Array.isArray(rewards) || rewards.length === 0) return false;
    return rewards.some(reward => {
        return (reward.type === 1 && settings.store.farmRewardCodes
            || reward.type === 2 && settings.store.farmInGame
            || reward.type === 3 && settings.store.farmCollectibles
            || reward.type === 4 && settings.store.farmVirtualCurrency
            || reward.type === 5 && settings.store.farmFractionalPremium);
    });
}

let questsCompletedThisSession = 0;

async function updateQuestsWrapper() {
    availableQuests = [...QuestsStore.quests.values()];
    
    // Check Health
    checkAccountHealth(availableQuests.length > 0);

    acceptableQuests = availableQuests.filter(x => x.userStatus?.enrolledAt == null && new Date(x.config.expiresAt).getTime() > Date.now()) || [];
    completableQuests = availableQuests.filter(x => x.userStatus?.enrolledAt && !x.userStatus?.completedAt && new Date(x.config.expiresAt).getTime() > Date.now()) || [];
    
    const maxSession = (settings.store as any).maxQuestsSession ?? 2;
    // Iterate acceptable quests (randomize order to mimic human)
    const shuffledAcceptable = acceptableQuests.sort(() => 0.5 - Math.random());

    for (const quest of shuffledAcceptable) {
        if (questsCompletedThisSession >= maxSession) {
            console.log("[Stealth] Greed Limiter active. Skipping further quest enrollment this session.");
            break;
        }

        if (isQuestEligibleForFarming(quest)) {
            await acceptQuest(quest);
        }
    }
    for (const quest of completableQuests) {
        if (completingQuest.has(quest.id)) {
            if (completingQuest.get(quest.id) === false) {
                completingQuest.delete(quest.id);
            }
        } else {
            completeQuest(quest);
        }
    }
}

async function acceptQuest(quest: QuestValue) {
    if (!settings.store.acceptQuestsAutomatically) return;
    const action: QuestAction = {
        questContent: QuestLocationMap.QUEST_HOME_DESKTOP,
        questContentCTA: "ACCEPT_QUEST",
        sourceQuestContent: 0,
    };
    
    const stealthLevel = (settings.store as any).stealthLevel || "elite";
    if (stealthLevel === "elite") {
        console.log(`[Stealth] Initiating humanized acceptance for ${quest.config.messages.questName}...`);
        await simulateNotificationAck(quest.id);
        await performHumanizedAction("NavigateToSettings", 0, 0, 150, 150);
        await simulateQuestAcceptanceFlow(quest.id);
        await performHumanizedAction("AcceptQuestClick", 150, 150, 400, 300);
    }
    
    QuestApplyAction(quest.id, action).then(() => {
        console.log("Accepted quest:", quest.config.messages.questName);
        questsCompletedThisSession++;
    }).catch(err => {
        console.error("Failed to accept quest:", quest.config.messages.questName, err);
    });
}

function stopCompletingAll() {
    for (const quest of completableQuests) {
        if (completingQuest.has(quest.id)) {
            completingQuest.set(quest.id, false);
        }
    }
    console.log("Stopped completing all quests.");
}

function completeQuest(quest: QuestValue) {
    const isApp = typeof DiscordNative !== "undefined";
    if (!quest) {
        console.log("You don't have any uncompleted quests!");
    } else {
        const pid = Math.floor(Math.random() * 30000) + 1000;

        const applicationId = quest.config.application.id;
        const applicationName = quest.config.application.name;
        const { questName } = quest.config.messages;
        const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
        const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE", "ACHIEVEMENT_IN_ACTIVITY"].find(x => taskConfig.tasks[x] != null);
        if (!taskName) {
            console.log("Unknown task type for quest:", questName);
            return;
        }
        const secondsNeeded = taskConfig.tasks[taskName].target;
        let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

        if (!isApp && taskName !== "WATCH_VIDEO" && taskName !== "WATCH_VIDEO_ON_MOBILE") {
            console.log("This no longer works in browser for non-video quests (" + taskName + "). Use the discord desktop app to complete the", questName, "quest!");
            return;
        }

        completingQuest.set(quest.id, true);

        console.log(`Completing quest ${questName} (${quest.id}) - ${taskName} for ${secondsNeeded} seconds.`);

        switch (taskName) {
            case "WATCH_VIDEO":
            case "WATCH_VIDEO_ON_MOBILE":
                const maxFuture = 10, speed = 7, interval = 1;
                const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
                let completed = false;
                const watchVideo = async () => {
                    while (true) {
                        const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
                        const diff = maxAllowed - secondsDone;
                        const timestamp = secondsDone + speed;

                        if (!completingQuest.get(quest.id)) {
                            console.log("Stopping completing quest:", questName);
                            completingQuest.set(quest.id, false);
                            break;
                        }

                        if (diff >= speed) {
                            const res = await RestAPI.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) } });
                            completed = res.body.completed_at != null;
                            secondsDone = Math.min(secondsNeeded, timestamp);
                        }

                        if (timestamp >= secondsNeeded) {
                            completingQuest.set(quest.id, false);
                            break;
                        }

                        // Background Activity (Stealth)
                        const stealthLevel = (settings.store as any).stealthLevel || "elite";
                        if (stealthLevel === "elite" && Math.random() < 0.05) { // 5% chance every few seconds
                            await simulateBackgroundActivity();
                        }

                        await new Promise(resolve => setTimeout(resolve, interval * 1000));
                    }
                    if (!completed) {
                        await RestAPI.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } });
                    }
                    console.log("Quest completed!");
                };
                watchVideo();
                console.log(`Spoofing video for ${questName}.`);
                break;

            case "PLAY_ON_DESKTOP":
                RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` }).then(res => {
                    const appData = res.body[0];
                    const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">","") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");

                    const fakeGame = {
                        cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                        exeName,
                        exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                        hidden: false,
                        isLauncher: false,
                        id: applicationId,
                        name: appData.name,
                        pid: pid,
                        pidPath: [pid],
                        processName: appData.name,
                        start: Date.now(),
                    };
                    const realGames = fakeGames.size === 0 ? RunningGameStore.getRunningGames() : [];
                    fakeGames.set(quest.id, fakeGame);
                    const fakeGames2 = Array.from(fakeGames.values());
                    FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames2 });

                    const playOnDesktop = event => {
                        if (event.questId !== quest.id) return;
                        const progress = quest.config.configVersion === 1 ? event.userStatus.streamProgressSeconds : Math.floor(event.userStatus.progress.PLAY_ON_DESKTOP.value);
                        console.log(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                        if (!completingQuest.get(quest.id) || progress >= secondsNeeded) {
                            console.log("Stopping completing quest:", questName);

                            fakeGames.delete(quest.id);
                            const games = RunningGameStore.getRunningGames();
                            const added = fakeGames.size === 0 ? games : [];
                            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: added, games: games });
                            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", playOnDesktop);

                            if (progress >= secondsNeeded) {
                                console.log("Quest completed!");
                                completingQuest.set(quest.id, false);
                            }
                        }
                    };
                    FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", playOnDesktop);

                    console.log(`Spoofed your game to ${applicationName}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
                });
                break;

            case "STREAM_ON_DESKTOP":
                const fakeApp = {
                    id: applicationId,
                    name: `FakeApp ${applicationName} (CompleteDiscordQuest)`,
                    pid: pid,
                    sourceName: null,
                };
                fakeApplications.set(quest.id, fakeApp);

                const streamOnDesktop = event => {
                    if (event.questId !== quest.id) return;
                    const progress = quest.config.configVersion === 1 ? event.userStatus.streamProgressSeconds : Math.floor(event.userStatus.progress.STREAM_ON_DESKTOP.value);
                    console.log(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                    if (!completingQuest.get(quest.id) || progress >= secondsNeeded) {
                        console.log("Stopping completing quest:", questName);

                        fakeApplications.delete(quest.id);
                        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", streamOnDesktop);

                        if (progress >= secondsNeeded) {
                            console.log("Quest completed!");
                            completingQuest.set(quest.id, false);
                        }
                    }
                };
                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", streamOnDesktop);

                console.log(`Spoofed your stream to ${applicationName}. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
                console.log("Remember that you need at least 1 other person to be in the vc!");
                break;

            case "PLAY_ACTIVITY":
                const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0).VOCAL[0].channel.id;
                const streamKey = `call:${channelId}:1`;

                const playActivity = async () => {
                    console.log("Completing quest", questName, "-", quest.config.messages.questName);

                    while (true) {
                        const res = await RestAPI.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
                        const progress = res.body.progress.PLAY_ACTIVITY.value;
                        console.log(`Quest progress ${questName}: ${progress}/${secondsNeeded}`);

                        await new Promise(resolve => setTimeout(resolve, 20 * 1000));

                        // Background Activity (Stealth)
                        const stealthLevel = (settings.store as any).stealthLevel || "elite";
                        if (stealthLevel === "elite" && Math.random() < 0.1) {
                            await simulateBackgroundActivity();
                        }

                        if (!completingQuest.get(quest.id) || progress >= secondsNeeded) {
                            console.log("Stopping completing quest:", questName);

                            if (progress >= secondsNeeded) {
                                await RestAPI.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
                                console.log("Quest completed!");
                                completingQuest.set(quest.id, false);
                            }
                            break;
                        }
                    }
                };
                playActivity();
                break;

            case "ACHIEVEMENT_IN_ACTIVITY":
                const achievementHandler = async () => {
                    console.log(`[Achievement] Starting achievement bypass for ${questName}...`);

                    // Step 1: Fetch a proxy ticket from Discord to authorize with the activity
                    let proxyTicket: string | null = null;
                    try {
                        const ticketRes = await RestAPI.post({
                            url: `/quests/${quest.id}/proxy-tickets`,
                            body: {}
                        });
                        proxyTicket = ticketRes.body?.ticket;
                        if (!proxyTicket) {
                            console.error("[Achievement] No proxy ticket returned.");
                            completingQuest.set(quest.id, false);
                            return;
                        }
                        console.log(`[Achievement] Got proxy ticket for ${questName}.`);
                    } catch (err: any) {
                        // HTTP 403 with code 50165 = age-gated or delisted activity
                        if (err?.status === 403 || err?.body?.code === 50165) {
                            console.error(`[Achievement] Age-gated or delisted activity for ${questName}. Cannot bypass. Verify your age in Discord settings first.`);
                        } else {
                            console.error(`[Achievement] Failed to get proxy ticket for ${questName}:`, err);
                        }
                        completingQuest.set(quest.id, false);
                        return;
                    }

                    // Step 2: Use the proxy ticket to authorize with discordsays via native module
                    const activityAppId = applicationId;
                    const authorizeUrl = `https://${activityAppId}.discordsays.com/.proxy/api/authorize`;
                    const authorizeBody = JSON.stringify({ ticket: proxyTicket });

                    let sessionToken: string | null = null;
                    try {
                        const authRes = await Native.discordsaysPost(
                            authorizeUrl,
                            { "Content-Type": "application/json" },
                            authorizeBody
                        );
                        if (!authRes.ok) {
                            console.error(`[Achievement] Authorize failed (${authRes.status}): ${authRes.body}`);
                            completingQuest.set(quest.id, false);
                            return;
                        }
                        const authData = JSON.parse(authRes.body);
                        sessionToken = authData?.token || authData?.session_token || null;
                        if (!sessionToken) {
                            console.error("[Achievement] No session token in authorize response.");
                            completingQuest.set(quest.id, false);
                            return;
                        }
                        console.log(`[Achievement] Authorized with discordsays for ${questName}.`);
                    } catch (err: any) {
                        console.error(`[Achievement] Authorize error for ${questName}:`, err);
                        completingQuest.set(quest.id, false);
                        return;
                    }

                    // Step 3: Send achievement completion pings via the native module
                    // The activity's achievement endpoint varies, but the standard pattern
                    // is to POST to the activity's API with the session token.
                    const achievementUrl = `https://${activityAppId}.discordsays.com/.proxy/api/achievements`;
                    const achievementBody = JSON.stringify({
                        quest_id: quest.id,
                        action: "complete"
                    });

                    try {
                        const achRes = await Native.discordsaysPost(
                            achievementUrl,
                            {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${sessionToken}`
                            },
                            achievementBody
                        );

                        if (achRes.ok) {
                            console.log(`[Achievement] Quest ${questName} achievement completed!`);
                        } else {
                            console.warn(`[Achievement] Achievement POST returned ${achRes.status}: ${achRes.body}`);
                            // Some activities may use a different endpoint structure.
                            // Fall back to heartbeat-based progress if the direct POST fails.
                            console.log(`[Achievement] Falling back to heartbeat spoofing for ${questName}...`);
                            await achievementHeartbeatFallback(quest, secondsNeeded, secondsDone, questName);
                        }
                    } catch (err: any) {
                        console.error(`[Achievement] Achievement POST error for ${questName}:`, err);
                        await achievementHeartbeatFallback(quest, secondsNeeded, secondsDone, questName);
                    }

                    completingQuest.set(quest.id, false);
                    console.log(`[Achievement] Handler finished for ${questName}.`);
                };
                achievementHandler();
                break;

            default:
                console.error("Unknown task type:", taskName);
                completingQuest.set(quest.id, false);
                break;
        }
    }
}

/**
 * Fallback heartbeat-based progress for achievement quests when the direct
 * discordsays achievement POST isn't supported by the specific activity.
 * Uses the same stream_key heartbeat approach as PLAY_ACTIVITY.
 */
async function achievementHeartbeatFallback(
    quest: QuestValue,
    secondsNeeded: number,
    secondsDone: number,
    questName: string
) {
    const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id
        ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0)?.VOCAL[0]?.channel?.id;

    if (!channelId) {
        console.error("[Achievement Fallback] No channel found for heartbeat.");
        return;
    }

    const streamKey = `call:${channelId}:1`;
    let attempts = 0;
    const maxAttempts = Math.ceil((secondsNeeded - secondsDone) / 20) + 5;

    while (attempts < maxAttempts && completingQuest.get(quest.id)) {
        try {
            const res = await RestAPI.post({
                url: `/quests/${quest.id}/heartbeat`,
                body: { stream_key: streamKey, terminal: false }
            });
            const progress = res.body?.progress?.ACHIEVEMENT_IN_ACTIVITY?.value ?? 0;
            console.log(`[Achievement Fallback] Progress ${questName}: ${progress}/${secondsNeeded}`);

            if (progress >= secondsNeeded) {
                await RestAPI.post({
                    url: `/quests/${quest.id}/heartbeat`,
                    body: { stream_key: streamKey, terminal: true }
                });
                console.log(`[Achievement Fallback] Quest ${questName} completed!`);
                completingQuest.set(quest.id, false);
                return;
            }
        } catch (err: any) {
            console.error(`[Achievement Fallback] Heartbeat error:`, err);
        }

        attempts++;
        await new Promise(resolve => setTimeout(resolve, 20 * 1000));
    }
}
