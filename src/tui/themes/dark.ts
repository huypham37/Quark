// Dark theme — original Quark "Amp dark" palette + VSCode-dark syntax tokens.

import { RGBA } from "@opentui/core"
import type { Theme } from "./types"

export const darkTheme: Theme = {
  name: "dark",
  colors: {
    primary: RGBA.fromHex("#00d7d7"),
    success: RGBA.fromHex("#00d75f"),
    error: RGBA.fromHex("#ff5f5f"),
    warning: RGBA.fromHex("#d7d700"),
    muted: RGBA.fromHex("#808080"),

    text: RGBA.fromHex("#e4e4e4"),
    textDim: RGBA.fromHex("#808080"),
    textBold: RGBA.fromHex("#ffffff"),

    border: RGBA.fromHex("#808080"),
    outline: RGBA.fromHex("#ffffff"),
    borderActive: RGBA.fromHex("#00d7d7"),
    borderSuccess: RGBA.fromHex("#00d75f"),

    userBar: RGBA.fromHex("#00d7d7"),
    toolPath: RGBA.fromHex("#5f87ff"),
    toolIcon: RGBA.fromHex("#00d75f"),
    thinkingIcon: RGBA.fromHex("#00d75f"),

    statusLine: RGBA.fromHex("#808080"),
    statusModel: RGBA.fromHex("#d7d700"),
    statusSkills: RGBA.fromHex("#00d7d7"),

    footerKey: RGBA.fromHex("#00d75f"),

    dropdownBg: RGBA.fromHex("#21252A"),
    commandCardBg: RGBA.fromHex("#21252A"),
    notificationBg: RGBA.fromHex("#1c1c1c"),

    mentionChipBg: RGBA.fromHex("#3a3a3a"),
    mentionChipFg: RGBA.fromHex("#00d7d7"),

    scrollbarTrack: RGBA.fromHex("#3a3a3a"),
    scrollbarThumb: RGBA.fromHex("#666666"),

    cursorColor: RGBA.fromHex("#00d7d7"),
  },
  syntax: [
    { scope: ["default", "text"], style: { foreground: "#e4e4e4" } },
    { scope: ["markup.raw", "markup.inline.raw", "text.literal"], style: { foreground: "#98c379" } },
    { scope: ["markup.bold", "markup.strong", "text.strong"], style: { foreground: "#E5C07B", bold: true } },
    { scope: ["markup.italic", "text.emphasis"], style: { foreground: "#c678dd", italic: true } },
    { scope: ["markup.link", "markup.link.url", "text.uri"], style: { foreground: "#56b6c2" } },
    { scope: ["markup.link.label", "text.reference"], style: { foreground: "#61afef" } },
    { scope: ["markup.heading", "text.title"], style: { foreground: "#e06c75", bold: true } },
    { scope: ["comment", "punctuation.definition.comment"], style: { foreground: "#6A9955", italic: true } },
    {
      scope: ["keyword", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      style: { foreground: "#C586C0" },
    },
    { scope: ["string", "string.quoted", "string.template"], style: { foreground: "#CE9178" } },
    { scope: ["constant.numeric"], style: { foreground: "#B5CEA8" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], style: { foreground: "#DCDCAA" } },
    {
      scope: ["entity.name.type", "entity.name.class", "support.class", "support.type"],
      style: { foreground: "#4EC9B0" },
    },
    {
      scope: ["variable", "variable.other", "variable.parameter", "meta.definition.variable"],
      style: { foreground: "#9CDCFE" },
    },
    { scope: ["constant", "constant.language", "variable.language.this"], style: { foreground: "#569CD6" } },
    { scope: ["keyword.operator"], style: { foreground: "#D4D4D4" } },
    { scope: ["punctuation"], style: { foreground: "#D4D4D4" } },
    { scope: ["entity.name.tag", "meta.tag"], style: { foreground: "#569CD6" } },
    { scope: ["entity.other.attribute-name"], style: { foreground: "#9CDCFE" } },
    { scope: ["string.regexp"], style: { foreground: "#D16969" } },
    // Markdown — Atom One Dark palette.
    { scope: ["markup.heading.2"], style: { foreground: "#c678dd", bold: true } },
    { scope: ["markup.heading.3"], style: { foreground: "#d19a66", bold: true } },
    { scope: ["markup.heading.4"], style: { foreground: "#61afef", bold: true } },
    { scope: ["markup.heading.5"], style: { foreground: "#56b6c2", bold: true } },
    { scope: ["markup.heading.6"], style: { foreground: "#98c379", bold: true } },
    { scope: ["markup.strikethrough"], style: { foreground: "#e06c75" } },
    { scope: ["markup.quote"], style: { foreground: "#5c6370", italic: true } },
    { scope: ["markup.list", "markup.list.checked", "markup.list.unchecked"], style: { foreground: "#e06c75" } },
    { scope: ["support.type.property-name"], style: { foreground: "#9CDCFE" } },
  ],
}
