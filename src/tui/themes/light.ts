// Light theme — readable on white/cream terminal backgrounds.
// Palette mirrors the dark theme's semantic roles but with darker accents
// (lower foreground luminance) so contrast holds against light backgrounds.
// Syntax tokens follow VSCode Light+.

import { RGBA } from "@opentui/core"
import type { Theme } from "./types"

export const lightTheme: Theme = {
  name: "light",
  colors: {
    primary: RGBA.fromHex("#0087af"),
    success: RGBA.fromHex("#008833"),
    error: RGBA.fromHex("#cc0000"),
    warning: RGBA.fromHex("#996600"),
    muted: RGBA.fromHex("#6c6c6c"),

    text: RGBA.fromHex("#1c1c1c"),
    textDim: RGBA.fromHex("#6c6c6c"),
    textBold: RGBA.fromHex("#000000"),

    border: RGBA.fromHex("#9e9e9e"),
    outline: RGBA.fromHex("#000000"),
    borderActive: RGBA.fromHex("#0087af"),
    borderSuccess: RGBA.fromHex("#008833"),

    userBar: RGBA.fromHex("#0087af"),
    toolPath: RGBA.fromHex("#0044cc"),
    toolIcon: RGBA.fromHex("#008833"),
    thinkingIcon: RGBA.fromHex("#008833"),

    statusLine: RGBA.fromHex("#6c6c6c"),
    statusModel: RGBA.fromHex("#996600"),
    statusSkills: RGBA.fromHex("#0087af"),

    footerKey: RGBA.fromHex("#008833"),

    dropdownBg: RGBA.fromHex("#e8e8e8"),
    commandCardBg: RGBA.fromHex("#ebebeb"),
    notificationBg: RGBA.fromHex("#f0f0f0"),

    mentionChipBg: RGBA.fromHex("#e0e0e0"),
    mentionChipFg: RGBA.fromHex("#0087af"),

    scrollbarTrack: RGBA.fromHex("#d0d0d0"),
    scrollbarThumb: RGBA.fromHex("#a0a0a0"),

    cursorColor: RGBA.fromHex("#0087af"),
  },
  syntax: [
    { scope: ["comment", "punctuation.definition.comment"], style: { foreground: "#008000", italic: true } },
    {
      scope: ["keyword", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      style: { foreground: "#af00db" },
    },
    { scope: ["string", "string.quoted", "string.template"], style: { foreground: "#a31515" } },
    { scope: ["constant.numeric"], style: { foreground: "#098658" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], style: { foreground: "#795e26" } },
    {
      scope: ["entity.name.type", "entity.name.class", "support.class", "support.type"],
      style: { foreground: "#267f99" },
    },
    {
      scope: ["variable", "variable.other", "variable.parameter", "meta.definition.variable"],
      style: { foreground: "#001080" },
    },
    { scope: ["constant", "constant.language", "variable.language.this"], style: { foreground: "#0000ff" } },
    { scope: ["keyword.operator"], style: { foreground: "#1c1c1c" } },
    { scope: ["punctuation"], style: { foreground: "#1c1c1c" } },
    { scope: ["entity.name.tag", "meta.tag"], style: { foreground: "#800000" } },
    { scope: ["entity.other.attribute-name"], style: { foreground: "#ff0000" } },
    { scope: ["string.regexp"], style: { foreground: "#811f3f" } },
    { scope: ["markup.heading", "entity.name.section"], style: { foreground: "#0000ff", bold: true } },
    { scope: ["markup.bold", "markup.strong"], style: { foreground: "#996600", bold: true } },
    { scope: ["markup.italic"], style: { italic: true } },
    { scope: ["markup.inline.raw"], style: { foreground: "#a31515" } },
    { scope: ["support.type.property-name"], style: { foreground: "#001080" } },
  ],
}
