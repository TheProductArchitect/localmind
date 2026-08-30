"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Lazy-loaded markdown renderer so the chat chrome hydrates without this chunk.
 * Links never navigate the current view: in the desktop shell Electron turns
 * them into browser tabs, and in a normal browser they open a new tab.
 */
export function MarkdownBody({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children: label, ...rest }) => (
          <a {...rest} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
