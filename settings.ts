/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export default definePluginSettings({
    stealthLevel: {
        type: OptionType.SELECT,
        description: "Stealth & Humanization Level",
        options: [
            { label: "Safe (Slow & High Randomness)", value: "safe" },
            { label: "Balanced (Moderate Randomness)", value: "balanced" },
            { label: "Aggressive", value: "aggressive" },
            { label: "Stealth(AI Bypass)", value: "elite" }
        ],
        default: "elite"
    },
    perlinIntensity: {
        type: OptionType.SLIDER,
        description: "Mouse Tremor Simulator",
        markers: [1, 2, 3, 4, 5],
        default: 2 // Low intensity gamer mouse
    },
    maxQuestsSession: {
        type: OptionType.NUMBER,
        description: "Max Quests to Complete Per Session (Greed Limiter)",
        default: 2
    },
    acceptQuestsAutomatically: {
        type: OptionType.BOOLEAN,
        description: "Whether to accept available quests automatically.",
        default: false
    },
    showQuestsButtonTopBar: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the quests button in the top bar.",
        default: true,
        restartNeeded: true
    },
    showQuestsButtonSettingsBar: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the quests button in the settings bar.",
        default: false,
        restartNeeded: true
    },
    showQuestsButtonBadges: {
        type: OptionType.BOOLEAN,
        description: "Whether to show badges on the quests button.",
        default: true
    },
    farmVideos: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm video quests automatically.",
        default: true
    },
    farmPlayOnDesktop: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm play on desktop quests automatically.",
        default: true
    },
    farmStreamOnDesktop: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm stream on desktop quests automatically.",
        default: true
    },
    farmPlayActivity: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm play activity quests automatically.",
        default: true
    },
    farmAchievement: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm achievement (in-activity) quests automatically. Requires desktop client.",
        default: true
    },
    farmRewardCodes: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm reward code quests automatically.",
        default: true
    },
    farmInGame: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm in-game quests automatically.",
        default: true
    },
    farmCollectibles: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm collectible quests automatically.",
        default: true
    },
    farmVirtualCurrency: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm virtual currency quests automatically.",
        default: true
    },
    farmFractionalPremium: {
        type: OptionType.BOOLEAN,
        description: "Whether to farm fractional premium quests automatically.",
        default: true
    },
});
