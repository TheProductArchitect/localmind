"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Lazy-loaded markdown renderer so the chat chrome hydrates without this chunk. */
export function MarkdownBody({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
