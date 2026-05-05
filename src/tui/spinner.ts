// Randomized search spinner for the "agent running" animation
//
// Two braille characters encode a 4×4 grid (each braille cell = 2 cols × 4 rows
// of dots). Dots light up in randomized frontier-expansion order starting from
// the bottom-left cell, resembling a stochastic search algorithm:
//
//   Braille dot → grid cell mapping:
//   Char 1 (cols 0-1):  dot1=cell0  dot2=cell4  dot3=cell8  dot7=cell12
//                        dot4=cell1  dot5=cell5  dot6=cell9  dot8=cell13
//   Char 2 (cols 2-3):  dot1=cell2  dot2=cell6  dot3=cell10 dot7=cell14
//                        dot4=cell3  dot5=cell7  dot6=cell11 dot8=cell15
//
// Visit order: 12→13→14→9→10→8→4→6→0→5→15→1→7→2→11→3

export const SPINNER_FRAMES = [
  "\u2800\u2800",  // (empty start)
  "\u2840\u2800",  // cell 12
  "\u28C0\u2800",  // cell 13
  "\u28C0\u2840",  // cell 14
  "\u28E0\u2840",  // cell 9
  "\u28E0\u2844",  // cell 10
  "\u28E4\u2844",  // cell 8
  "\u28E6\u2844",  // cell 4
  "\u28E6\u2846",  // cell 6
  "\u28E7\u2846",  // cell 0
  "\u28F7\u2846",  // cell 5
  "\u28F7\u28C6",  // cell 15
  "\u28FF\u28C6",  // cell 1
  "\u28FF\u28D6",  // cell 7
  "\u28FF\u28D7",  // cell 2
  "\u28FF\u28F7",  // cell 11
  "\u28FF\u28FF",  // cell 3
] as const

export const SPINNER_INTERVAL_MS = 80

export const STREAMING_LABELS = [
  "Streaming",
  "Conjuring…",
  "Brewing…",
  "Channelling…",
  "Weaving…",
  "Casting…",
  "Summoning…",
  "Hatching…",
] as const

export const LABEL_CYCLE_INTERVAL_MS = 4_000

export const BRAILLE_CYCLE_FRAMES = [
  "\u280B", // ⠋
  "\u2819", // ⠙
  "\u2839", // ⠹
  "\u2838", // ⠸
  "\u283C", // ⠼
  "\u2834", // ⠴
  "\u2826", // ⠦
  "\u2827", // ⠧
  "\u2807", // ⠇
  "\u280F", // ⠏
] as const

export const BRAILLE_CYCLE_INTERVAL_MS = 80
