// Syntax highlighting theme for code blocks in markdown
// Based on a dark theme similar to Monokai/OneDark

import { SyntaxStyle, type ThemeTokenStyle } from "@opentui/core"
import { colors } from "./theme"

// Define syntax highlighting colors based on TextMate scopes
const syntaxTheme: ThemeTokenStyle[] = [
  // Comments
  {
    scope: ["comment", "punctuation.definition.comment"],
    style: { foreground: "#6A9955", italic: true }
  },
  
  // Keywords (if, else, function, const, let, etc.)
  {
    scope: [
      "keyword",
      "storage.type",
      "storage.modifier",
      "keyword.control",
      "keyword.operator.new"
    ],
    style: { foreground: "#C586C0" }
  },
  
  // Strings
  {
    scope: [
      "string",
      "string.quoted",
      "string.template"
    ],
    style: { foreground: "#CE9178" }
  },
  
  // Numbers
  {
    scope: ["constant.numeric"],
    style: { foreground: "#B5CEA8" }
  },
  
  // Functions
  {
    scope: [
      "entity.name.function",
      "support.function",
      "meta.function-call"
    ],
    style: { foreground: "#DCDCAA" }
  },
  
  // Classes and types
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "support.class",
      "support.type"
    ],
    style: { foreground: "#4EC9B0" }
  },
  
  // Variables and properties
  {
    scope: [
      "variable",
      "variable.other",
      "variable.parameter",
      "meta.definition.variable"
    ],
    style: { foreground: "#9CDCFE" }
  },
  
  // Constants
  {
    scope: [
      "constant",
      "constant.language",
      "variable.language.this"
    ],
    style: { foreground: "#569CD6" }
  },
  
  // Operators
  {
    scope: ["keyword.operator"],
    style: { foreground: "#D4D4D4" }
  },
  
  // Punctuation
  {
    scope: ["punctuation"],
    style: { foreground: "#D4D4D4" }
  },
  
  // HTML/JSX tags
  {
    scope: [
      "entity.name.tag",
      "meta.tag"
    ],
    style: { foreground: "#569CD6" }
  },
  
  // HTML/JSX attributes
  {
    scope: [
      "entity.other.attribute-name"
    ],
    style: { foreground: "#9CDCFE" }
  },
  
  // RegExp
  {
    scope: ["string.regexp"],
    style: { foreground: "#D16969" }
  },
  
  // Markdown specific
  {
    scope: [
      "markup.heading",
      "entity.name.section"
    ],
    style: { foreground: "#569CD6", bold: true }
  },
  {
    scope: ["markup.bold", "markup.strong"],
    style: { bold: true }
  },
  {
    scope: ["markup.italic"],
    style: { italic: true }
  },
  {
    scope: ["markup.inline.raw"],
    style: { foreground: "#CE9178" }
  },
  
  // JSON keys
  {
    scope: ["support.type.property-name"],
    style: { foreground: "#9CDCFE" }
  }
]

// Create and export the syntax style singleton
export const syntaxStyle = SyntaxStyle.fromTheme(syntaxTheme)
