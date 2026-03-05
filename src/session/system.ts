// System prompt builder

import * as os from "os"

export function buildSystem(agent: { prompt: string }): string[] {
  return [agent.prompt, environmentBlock()]
}

function environmentBlock(): string {
  return [
    `Working directory: ${process.cwd()}`,
    `OS: ${os.platform()} (${os.release()}) on ${os.arch()}`,
    `Today's date: ${new Date().toDateString()}`,
  ].join("\n")
}
