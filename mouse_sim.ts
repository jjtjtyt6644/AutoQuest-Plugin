import { FluxDispatcher } from "@webpack/common";
import settings from "./settings";

// Simple pseudo-random coherent noise for micro-tremors
class SimpleNoise {
    private seed: number;
    constructor(seed?: number) {
        this.seed = seed ?? Math.random();
    }
    
    private random(x: number) {
        let n = Math.sin(x * this.seed * 12.9898) * 43758.5453;
        return n - Math.floor(n);
    }
    
    public noise(x: number) {
        let i = Math.floor(x);
        let f = x - i;
        let u = f * f * (3.0 - 2.0 * f); // smoothstep
        return this.random(i) * (1.0 - u) + this.random(i + 1) * u;
    }
}

const noiseGen = new SimpleNoise();

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Cubic Bezier interpolation
function bezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    let p = uuu * p0;
    p += 3 * uu * t * p1;
    p += 3 * u * tt * p2;
    p += ttt * p3;

    return p;
}

import { dispatchScienceEvent } from "./telemetry_spoof";

export async function simulateMouseMove(startX: number, startY: number, endX: number, endY: number) {
    // Generate Bezier control points with random offset to simulate overshoot
    const overshootX = endX + (Math.random() - 0.5) * 40;
    const overshootY = endY + (Math.random() - 0.5) * 40;
    
    const cp1x = startX + (endX - startX) / 3 + (Math.random() - 0.5) * 20;
    const cp1y = startY + (endY - startY) / 3 + (Math.random() - 0.5) * 20;
    
    const cp2x = overshootX;
    const cp2y = overshootY;

    const steps = 30; // 30 points along the curve
    const interval = 10; // ms between points
    
    // Configurable perlin intensity from settings if available, else default to low intensity
    const intensity = (settings.store as any).perlinIntensity ?? 2; 

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        
        let bx = bezier(t, startX, cp1x, cp2x, endX);
        let by = bezier(t, startY, cp1y, cp2y, endY);
        
        // Apply Perlin noise micro-tremors
        bx += (noiseGen.noise(t * 10) - 0.5) * intensity;
        by += (noiseGen.noise(t * 10 + 5) - 0.5) * intensity; // offset phase for Y

        // Send telemetry for mouse move every few steps to avoid spamming 
        if (i % 5 === 0) {
            await dispatchScienceEvent("MOUSE_MOVE", { x: Math.round(bx), y: Math.round(by) });
        }
        await sleep(interval);
    }
    
    // Correction loop to snap exactly to target if we overshot, simulating human adjustment
    let correctionSteps = 5;
    for (let i = 1; i <= correctionSteps; i++) {
        if (i === correctionSteps) {
            await dispatchScienceEvent("MOUSE_MOVE", { x: Math.round(endX), y: Math.round(endY) });
        }
        await sleep(15);
    }
}

export async function simulateSingleClick(x: number, y: number) {
    // MOUSE_DOWN
    await dispatchScienceEvent("MOUSE_DOWN", { x, y });
    
    // Wait random delay between 30ms and 120ms
    const delay = Math.floor(Math.random() * (120 - 30 + 1)) + 30;
    await sleep(delay);
    
    // MOUSE_UP
    await dispatchScienceEvent("MOUSE_UP", { x, y });
}

export async function performHumanizedAction(actionName: string, startX = 0, startY = 0, endX = 500, endY = 500) {
    await simulateMouseMove(startX, startY, endX, endY);
    await simulateSingleClick(endX, endY);
    console.log(`[MouseSim] Humanized action completed: ${actionName}`);
}
