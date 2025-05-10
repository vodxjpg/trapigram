// src/lib/sanitize-html.ts
import sanitizeHtml from "sanitize-html";

export const sanitizeSectionHtml = (dirty: string): string =>
  sanitizeHtml(dirty, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "strong",
      "em",
      "u",
      "ul",
      "ol",
      "li",
      "br",
      "a",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https"],
    // Keep emojis (they're just unicode)
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
    },
  });
