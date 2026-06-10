import { DEFAULT_SETTINGS } from "../lib/types";
import type { UserSettings } from "../lib/types";
import { defaultEndpointForProvider, defaultModelForProvider } from "../lib/model-source-config";

export const DEFAULT_TIER_A_ENDPOINT = defaultEndpointForProvider("ollama");
export const DEFAULT_TIER_A_MODEL = defaultModelForProvider("ollama", "reading-prompt");

/**
 * Cross-cutting sidepanel runtime state, shared across the render, message
 * handling, and reading-brief subsystems. Replaces a cluster of free-floating
 * module-level `let`s. Mutated in place and read at call time — the same live
 * semantics the module-level bindings had — so existing call sites keep working
 * by reading/writing `panelState.<field>`.
 *
 * Subsystem-private counters/timers (zhtw tab ids, settings control ids,
 * reading-brief timers, tab/status singletons) intentionally stay with their
 * subsystem rather than collecting into this object.
 */
export const panelState = {
  /** Last settings snapshot pushed from storage / SETTINGS_UPDATED broadcasts. */
  cachedSettings: { ...DEFAULT_SETTINGS } as UserSettings,
  /** Tier A endpoint/model mirrored from chrome.storage.local for shared-lane
   *  checks and the Tier B "use Tier A" provider. */
  cachedTierAEndpoint: DEFAULT_TIER_A_ENDPOINT,
  cachedTierAModel: DEFAULT_TIER_A_MODEL,
  /** Post the user is currently viewing on FB, driven by the CURRENT_VIEW_POST
   *  broadcast from the content script. */
  currentViewPostId: null as string | null,
  /** Until this timestamp, explicit Heads-up clicks are not overwritten by the
   *  last viewport broadcast while the sidepanel is opening. */
  manualFocusHoldUntil: 0,
  /** Guards against re-entrant dashboard replay. */
  replayInProgress: false,
};
