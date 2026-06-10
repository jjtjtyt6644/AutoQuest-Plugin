/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Native (main-process) IPC handlers for CompleteDiscordQuest.
 * Discord's renderer CSP blocks connect-src to *.discordsays.com.
 * ACHIEVEMENT_IN_ACTIVITY quests need to POST to discordsays endpoints
 * for the OAuth2 authorize flow. This module runs those requests in
 * Electron's main process where CSP doesn't apply.
 *
 * Vencord automatically exposes exported functions here as
 * VencordNative.pluginHelpers.CompleteDiscordQuest.<functionName>
 */

import { IpcMainInvokeEvent } from "electron";

export interface DiscordSaysResponse {
    ok: boolean;
    status: number;
    body: string;
}

/**
 * Make a POST request to a discordsays.com endpoint from the main process,
 * bypassing the renderer's Content Security Policy restrictions.
 */
export async function discordsaysPost(
    _: IpcMainInvokeEvent,
    url: string,
    headers: Record<string, string>,
    body: string
): Promise<DiscordSaysResponse> {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...headers
            },
            body
        });
        return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (e: any) {
        return { ok: false, status: 0, body: e?.message ?? "Unknown fetch error in main process" };
    }
}

/**
 * Make a GET request to a discordsays.com endpoint from the main process.
 * Used for fetching activity session info during achievement bypass.
 */
export async function discordsaysGet(
    _: IpcMainInvokeEvent,
    url: string,
    headers: Record<string, string>
): Promise<DiscordSaysResponse> {
    try {
        const res = await fetch(url, {
            method: "GET",
            headers
        });
        return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (e: any) {
        return { ok: false, status: 0, body: e?.message ?? "Unknown fetch error in main process" };
    }
}
