"use client";

/**
 * Sends the user to /browse when a link they clicked in the app UI was opened
 * as a browser tab by the Electron shell. Without this the tab would load
 * behind whatever page they were on, with nothing on screen to show for it.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/components/toast";

type OpenedTabApi = {
  onOpenedTab?: (cb: (info: { tabId: number; url: string }) => void) => () => void;
};

export function OpenedTabRouter() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const api = (window as unknown as { lmBrowser?: OpenedTabApi }).lmBrowser;
    if (!api?.onOpenedTab) return;
    return api.onOpenedTab(({ url }) => {
      if (pathname !== "/browse") {
        let host = "";
        try {
          host = new URL(url).host;
        } catch {
          host = url;
        }
        toast(host ? `Opening ${host} in Browse` : "Opening link in Browse");
        router.push("/browse");
      }
    });
  }, [pathname, router]);

  return null;
}
