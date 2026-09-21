/**
 * Browser-side keystroke collector.
 *
 * Captures typing patterns (hold time, flight time) from DOM events
 * and packages them for verification via DeepCheck.verifyKeystroke().
 *
 * @example
 * ```typescript
 * import { KeystrokeCollector } from "@deep-check/sdk";
 *
 * const collector = new KeystrokeCollector();
 *
 * // Attach to an input field
 * collector.attach(document.getElementById("email-input")!);
 *
 * // Later, verify the collected keystrokes
 * const keystrokes = collector.getKeystrokes();
 * const result = await dc.verifyKeystroke(keystrokes, "user-123");
 *
 * // Clean up
 * collector.detach();
 * ```
 */

import type { KeystrokeEntry } from "./types";

const KEY_CATEGORIES: Record<string, number> = {
  letter: 0,
  digit: 1,
  special: 2,
  space: 3,
  backspace: 4,
  enter: 5,
  modifier: 6,
  arrow: 7,
};

function categorizeKey(key: string): number {
  if (key.length === 1 && /[a-zA-Z]/.test(key)) return KEY_CATEGORIES.letter;
  if (key.length === 1 && /[0-9]/.test(key)) return KEY_CATEGORIES.digit;
  if (key === " ") return KEY_CATEGORIES.space;
  if (key === "Backspace" || key === "Delete") return KEY_CATEGORIES.backspace;
  if (key === "Enter") return KEY_CATEGORIES.enter;
  if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(key)) return KEY_CATEGORIES.modifier;
  if (key.startsWith("Arrow")) return KEY_CATEGORIES.arrow;
  return KEY_CATEGORIES.special;
}

interface PendingKey {
  key: string;
  downTime: number;
  category: number;
}

export class KeystrokeCollector {
  private keystrokes: KeystrokeEntry[] = [];
  private pending = new Map<string, PendingKey>();
  private lastUpTime = 0;
  private element: EventTarget | null = null;

  private onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.repeat) return;

    const key = ke.key;
    if (!this.pending.has(key)) {
      this.pending.set(key, {
        key,
        downTime: performance.now(),
        category: categorizeKey(key),
      });
    }
  };

  private onKeyUp = (e: Event) => {
    const ke = e as KeyboardEvent;
    const key = ke.key;
    const p = this.pending.get(key);
    if (!p) return;

    const upTime = performance.now();
    const holdTimeMs = upTime - p.downTime;
    const flightTimeMs = this.lastUpTime > 0 ? p.downTime - this.lastUpTime : 0;

    this.keystrokes.push({
      key: p.key,
      holdTimeMs: Math.round(holdTimeMs * 100) / 100,
      flightTimeMs: Math.max(0, Math.round(flightTimeMs * 100) / 100),
      keyCategory: p.category,
    });

    this.lastUpTime = upTime;
    this.pending.delete(key);
  };

  /** Attach keyboard listeners to a DOM element. */
  attach(element: EventTarget): void {
    this.detach();
    this.element = element;
    element.addEventListener("keydown", this.onKeyDown);
    element.addEventListener("keyup", this.onKeyUp);
  }

  /** Remove keyboard listeners. */
  detach(): void {
    if (this.element) {
      this.element.removeEventListener("keydown", this.onKeyDown);
      this.element.removeEventListener("keyup", this.onKeyUp);
      this.element = null;
    }
  }

  /** Get collected keystrokes and optionally clear the buffer. */
  getKeystrokes(clear = false): KeystrokeEntry[] {
    const result = [...this.keystrokes];
    if (clear) this.reset();
    return result;
  }

  /** Number of keystrokes collected. */
  get count(): number {
    return this.keystrokes.length;
  }

  /** Whether enough keystrokes have been collected for verification (min 10). */
  get ready(): boolean {
    return this.keystrokes.length >= 10;
  }

  /** Whether enough keystrokes have been collected for enrollment (min 20). */
  get readyForEnroll(): boolean {
    return this.keystrokes.length >= 20;
  }

  /** Clear all collected keystrokes. */
  reset(): void {
    this.keystrokes = [];
    this.pending.clear();
    this.lastUpTime = 0;
  }
}
