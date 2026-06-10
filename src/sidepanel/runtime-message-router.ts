import type { TrulyMessage } from "../lib/messages";
import type { DashboardPostEvent, UserSettings } from "../lib/types";

export interface SidepanelRuntimeMessageHandlers {
  settingsUpdated(settings: UserSettings): void;
  postClassified(event: DashboardPostEvent): void;
  dashboardReplay(events: DashboardPostEvent[]): void;
  openDashboardForPost(id: string): void;
  currentViewPost(id: string | null): void;
  manualViewPost(id: string): void;
}

export function handleSidepanelRuntimeMessage(
  message: TrulyMessage,
  handlers: SidepanelRuntimeMessageHandlers,
): false {
  switch (message.type) {
    case "SETTINGS_UPDATED":
      handlers.settingsUpdated(message.settings);
      break;
    case "POST_CLASSIFIED":
      handlers.postClassified(message.event);
      break;
    case "DASHBOARD_REPLAY":
      handlers.dashboardReplay(message.events);
      break;
    case "OPEN_DASHBOARD_FOR_POST":
      handlers.openDashboardForPost(message.id);
      break;
    case "CURRENT_VIEW_POST":
      handlers.currentViewPost(message.id);
      break;
    case "MANUAL_VIEW_POST":
      handlers.manualViewPost(message.id);
      break;
  }
  return false;
}
