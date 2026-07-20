import { redirect } from "next/navigation";

// Legacy /memory URL — Memory now lives as a tab inside /knowledge.
// Keep this redirect so rail matches, bookmarks, and older links still resolve.
export default function MemoryRedirectPage() {
  redirect("/knowledge?tab=memory");
}
