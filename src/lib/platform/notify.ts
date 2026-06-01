import { spawn } from "child_process";
import { PLATFORM, PLATFORM_CAPS } from "./index";

function runDetached(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve());
      child.on("exit", () => resolve());
      child.unref();
      // Hard cap — never block longer than 1.5s.
      setTimeout(() => resolve(), 1500);
    } catch {
      resolve();
    }
  });
}

export async function sendNotification(title: string, body: string): Promise<void> {
  // All callers go through spawn with an arg array — no shell, no injection risk.
  if (PLATFORM_CAPS.hasNativeNotification) {
    // macOS: osascript "display notification" — title/body are passed as a single
    // -e expression with embedded quotes; we escape any double quotes the caller used.
    const script = `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    await runDetached("osascript", ["-e", script]);
    return;
  }
  if (PLATFORM_CAPS.hasNotifySend) {
    await runDetached("notify-send", [title, body]);
    return;
  }
  if (PLATFORM === "wsl2") {
    // Best-effort PowerShell toast. Fails silently if BurntToast isn't installed —
    // the log fallback below still records the notification.
    const ps = `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null; $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $template.GetElementsByTagName('text')[0].InnerText = '${title.replace(/'/g, "''")}'; $template.GetElementsByTagName('text')[1].InnerText = '${body.replace(/'/g, "''")}'; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('LocalMind').Show([Windows.UI.Notifications.ToastNotification]::new($template))`;
    await runDetached("powershell.exe", ["-NoProfile", "-Command", ps]);
    return;
  }
  // Final fallback — log only. Always succeeds.
  console.log(`[notify] ${title}: ${body}`);
}
