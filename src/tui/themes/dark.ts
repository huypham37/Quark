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

    dropdownBg: RGBA.fromHex("#61AFEF"),
    commandCardBg: RGBA.fromHex("#21252A"),
    notificationBg: RGBA.fromHex("#1c1c1c"),

    mentionChipBg: RGBA.fromHex("#3a3a3a"),
    mentionChipFg: RGBA.fromHex("#00d7d7"),

    scrollbarTrack: RGBA.fromHex("#3a3a3a"),
    scrollbarThumb: RGBA.fromHex("#666666"),

    cursorColor: RGBA.fromHex("#00d7d7"),
  },
  syntax: [
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
    { scope: ["markup.heading", "entity.name.section"], style: { foreground: "#569CD6", bold: true } },
    { scope: ["markup.bold", "markup.strong"], style: { foreground: "#D7D700", bold: true } },
    { scope: ["markup.italic"], style: { italic: true } },
    { scope: ["markup.inline.raw"], style: { foreground: "#CE9178" } },
    { scope: ["support.type.property-name"], style: { foreground: "#9CDCFE" } },
  ],
}
