/*
 * Vencord a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./QuestButton.css";
import { Flex } from "@components/Flex";
import { findByCodeLazy, findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { Tooltip, useEffect, useState } from "@webpack/common";
import { QuestsStore } from "../stores";

const QuestIcon = findByCodeLazy("\"M7.5 21.7a8.95");
const { navigateToQuestHome } = findByPropsLazy("navigateToQuestHome");
const TopBarButton = findComponentByCodeLazy("badgePosition", "icon");
const SettingsBarButton = findComponentByCodeLazy("keyboardShortcut", "positionKey");
const CountBadge = findComponentByCodeLazy("renderBadgeCount", "disableColor");

// --- Helpers ---

function getQuestsStatus() {
    const quests = [...QuestsStore.quests.values()];
    const now = Date.now();
    
    return quests.reduce((acc, q) => {
        const { userStatus, config } = q;
        if (new Date(config.expiresAt).getTime() < now) acc.expired++;
        else if (userStatus?.claimedAt) acc.claimed++;
        else if (userStatus?.completedAt) acc.claimable++;
        else if (userStatus?.enrolledAt) acc.enrolled++;
        else acc.enrollable++;
        return acc;
    }, { enrollable: 0, enrolled: 0, claimable: 0, claimed: 0, expired: 0 });
}

/** * Custom Hook to keep quest status in sync across components
 */
function useQuestStatus() {
    const [status, setStatus] = useState(getQuestsStatus());

    useEffect(() => {
        const update = () => setStatus(getQuestsStatus());
        QuestsStore.addChangeListener(update);
        return () => QuestsStore.removeChangeListener(update);
    }, []);

    return status;
}

// --- Components ---

export function QuestsCount() {
    const status = useQuestStatus();

    const badges = [
        { key: "enrollable", label: "Enrollable", color: "var(--status-danger)" },
        { key: "enrolled", label: "Enrolled", color: "var(--status-warning)" },
        { key: "claimable", label: "Claimable", color: "var(--status-positive)" },
        { key: "claimed", label: "Claimed", color: "var(--blurple-50)" },
    ] as const;

    const totalQuests = QuestsStore.quests.size;
    const isSafe = totalQuests > 0;

    return (
        <Flex flexDirection="row" justifyContent="flex-end" className="quest-button-badges" gap="5px">
                {/* Account Health Banner / Indicator */}
                <Tooltip text={isSafe ? "🟢 Account Health: SAFE. Quests are populating normally. Stealth active." : "🟡 Account Health: RESTRICTED. No quests available. Possible shadowban! Stop automation."}>
                    {(props) => (
                        <div {...props} style={{
                            backgroundColor: isSafe ? "var(--status-positive-background)" : "var(--status-warning-background)",
                            color: isSafe ? "var(--status-positive-text)" : "var(--status-warning-text)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center"
                        }}>
                            {isSafe ? "🟢 SAFE" : "🟡 RESTRICTED"}
                        </div>
                    )}
                </Tooltip>

                {badges.map(({ key, label, color }) => (
                    status[key] > 0 && (
                        <Tooltip text={label} key={key}>
                            {(props) => (
                                <CountBadge
                                    {...props}
                                    count={status[key]}
                                    color={color}
                                    style={{ color: "var(--background-base-lowest)" }}
                                />
                            )}
                        </Tooltip>
                    )
                ))}

                {/* Restart Discord Button */}
                <Tooltip text="Restart Discord client. Warning: do NOT use this while quests are completing!">
                    {(props) => (
                        <button
                            {...props}
                            className="quest-restart-button"
                            onClick={() => {
                                if (status.enrolled > 0) {
                                    if (!confirm("⚠️ Quests are currently in progress!\n\nRestarting Discord now may cause errors with reward claims.\n\nAre you sure you want to restart?")) {
                                        return;
                                    }
                                }
                                if (typeof DiscordNative !== "undefined" && DiscordNative?.app?.relaunch) {
                                    DiscordNative.app.relaunch();
                                } else {
                                    alert("Restart is only available on the Discord desktop client.");
                                }
                            }}
                        >
                            🔄 Restart
                        </button>
                    )}
                </Tooltip>
        </Flex>
    );
}

export function QuestButton({ type }: { type: "top-bar" | "settings-bar" }) {
    const status = useQuestStatus();

    const hasActiveQuests = status.enrollable > 0 || status.enrolled > 0 || status.claimable > 0;
    
    const className = status.enrollable ? "quest-button-enrollable" 
                    : status.enrolled ? "quest-button-enrolled" 
                    : status.claimable ? "quest-button-claimable" : "";

    const tooltip = status.enrollable ? `${status.enrollable} Enrollable Quests` 
                  : status.enrolled ? `${status.enrolled} Enrolled Quests` 
                  : status.claimable ? `${status.claimable} Claimable Quests` : "Quests";

    const commonProps = {
        className,
        disabled: !navigateToQuestHome,
        showBadge: hasActiveQuests,
        badgePosition: "bottom" as const,
        icon: QuestIcon,
        iconSize: 20,
        onClick: navigateToQuestHome,
        tooltip,
        tooltipPosition: "bottom" as const,
        hideOnClick: false,
    };

    if (type === "top-bar") {
        return <TopBarButton {...commonProps} />;
    }

    return (
        <SettingsBarButton 
            tooltipText={tooltip} 
            onClick={navigateToQuestHome} 
            disabled={!navigateToQuestHome}
            className="quest-button"
        >
            <TopBarButton {...commonProps} />
        </SettingsBarButton>
    );
}