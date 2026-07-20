import { redirect } from "next/navigation";

// The User Context Graph now lives as the "About you" tab inside /knowledge
// ("what Sora knows" + "what Sora knows about you" on one page). Keep this
// route as a redirect so existing links and ⌘K entries still resolve.
export default function ContextPage() {
  redirect("/knowledge?tab=context");
}
