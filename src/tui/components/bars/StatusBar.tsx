// StatusBar — thin separator between message area and input
//
// Matches Amp's style:
//   ─10% of 168k · $0.37 (free)─────────────────────────smart──1 skill─

import React from "react"
import { Box, Text, useStdout } from "ink"
import { colors } from "../../theme"

interface StatusBarProps {
  tokensUsed: number
  tokenLimit: number
  cost: number
  modelName: string
  skillCount: number
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatPercent(used: number, limit: number): string {
  if (limit <= 0) return "0%"
  return `${Math.round((used / limit) * 100)}%`
}

export function StatusBar({ tokensUsed, tokenLimit, cost, modelName, skillCount }: StatusBarProps) {
  const { stdout } = useStdout()
  const width = stdout?.columns ?? 80

  const leftText = `${formatPercent(tokensUsed, tokenLimit)} of ${formatTokens(tokenLimit)} · $${cost.toFixed(2)} (free)`
  const rightText = `${modelName}──${skillCount} skill${skillCount !== 1 ? "s" : ""}`

  // Calculate fill length
  const usedWidth = leftText.length + rightText.length + 2 // 2 for ─ on each side
  const fillLen = Math.max(0, width - usedWidth)
  const fill = "─".repeat(fillLen)

  return (
    <Box>
      <Text color={colors.statusLine}>─{leftText}{fill}</Text>
      <Text color={colors.statusModel}>{modelName}</Text>
      <Text color={colors.statusLine}>──</Text>
      <Text color={colors.statusSkills}>{skillCount} skill{skillCount !== 1 ? "s" : ""}</Text>
      <Text color={colors.statusLine}>─</Text>
    </Box>
  )
}
