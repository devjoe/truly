import type { DashboardPostEvent } from "../lib/types";
import type { Lang } from "../lib/types";
import type { MarkdownDownloadMode } from "../lib/types";
import { t } from "../lib/i18n";

interface MarkdownWritableFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface MarkdownFileHandle {
  createWritable(): Promise<MarkdownWritableFile>;
}

interface MarkdownDirectoryHandle {
  getFileHandle(name: string, options: { create: boolean }): Promise<MarkdownFileHandle>;
}

type DirectoryPicker = (options: { mode: "readwrite"; id: string }) => Promise<MarkdownDirectoryHandle>;

interface DirectoryPickerHost {
  showDirectoryPicker?: DirectoryPicker;
}

export type MarkdownSaveOutcome = "directory" | "fallback-download" | "cancelled";

export interface MarkdownSaveDeps {
  mode?: MarkdownDownloadMode;
  directoryPickerHost?: DirectoryPickerHost;
  fallbackDownload?: typeof downloadTextFile;
}

const MARKDOWN_DIRECTORY_PICKER_ID = "truly-markdown-notes";

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("copy_failed");
}

export function safeFilenamePart(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").normalize("NFKC").trim();
  if (!normalized) return fallback;
  const cleaned = normalized
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

export function buildInvestigationMarkdownFilename(event: DashboardPostEvent): string {
  const date = new Date(event.timestamp ?? Date.now());
  const datePart = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
  const author = safeFilenamePart(event.authorName, "unknown");
  const postId = safeFilenamePart(event.id, "post").slice(0, 36);
  return `truly-${datePart}-${author}-${postId}.md`;
}

export function downloadTextFile(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function writeTextFileToDirectory(
  handle: MarkdownDirectoryHandle,
  text: string,
  filename: string,
  type: string,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([text], { type }));
  await writable.close();
}

export async function saveMarkdownTextFile(
  text: string,
  filename: string,
  type: string,
  deps: MarkdownSaveDeps = {},
): Promise<MarkdownSaveOutcome> {
  const pickerHost = deps.directoryPickerHost ?? (globalThis as DirectoryPickerHost);
  const picker = pickerHost.showDirectoryPicker;
  const fallbackDownload = deps.fallbackDownload ?? downloadTextFile;
  if (deps.mode === "browser-download" || !picker) {
    fallbackDownload(text, filename, type);
    return "fallback-download";
  }

  let directory: MarkdownDirectoryHandle;
  try {
    directory = await picker.call(pickerHost, {
      mode: "readwrite",
      id: MARKDOWN_DIRECTORY_PICKER_ID,
    });
  } catch (err) {
    if (isAbortError(err)) return "cancelled";
    throw err;
  }

  await writeTextFileToDirectory(directory, text, filename, type);
  return "directory";
}

export function openExternalToolUrl(url: string): boolean {
  const opened = window.open(url, "_blank");
  if (!opened) return false;
  try {
    opened.opener = null;
  } catch {
    // Some browser contexts expose a read-only opener. Opening still succeeded.
  }
  return true;
}

export function copyReadingBriefQuestion(button: HTMLButtonElement, text: string, lang: Lang = "zh-TW"): void {
  const original = button.textContent || t("sidepanel.dynamic.actions.copy", lang);
  const done = () => {
    button.textContent = t("sidepanel.dynamic.actions.copied", lang);
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  };
  const failed = () => {
    button.textContent = t("sidepanel.dynamic.actions.copyFailed", lang);
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  };
  if (!navigator.clipboard?.writeText) {
    failed();
    return;
  }
  navigator.clipboard.writeText(text).then(done, failed);
}
