# Atom SDK Example

This demonstrates using Atom as an SDK in your own project.

## Installation

```bash
npm install @atom/sdk
# or
bun add @atom/sdk
```

## Usage Example

```typescript
import { 
  bootstrap, 
  createSession, 
  prompt, 
  register, 
  defineTool,
  bus,
  type ToolContext 
} from '@atom/sdk'
import { z } from 'zod'

// 1. Initialize Atom
await bootstrap()

// 2. Register a custom tool
register(defineTool({
  id: 'greet',
  description: 'Greet someone by name',
  parameters: z.object({
    name: z.string().describe('The name to greet')
  }),
  execute: async (args, ctx: ToolContext) => {
    return {
      title: 'Greeting',
      output: `Hello, ${args.name}!`,
      metadata: { greeted: args.name }
    }
  }
}))

// 3. Listen to events (streaming)
bus.on('text-delta', (event) => {
  process.stdout.write(event.text)
})

bus.on('tool-start', (event) => {
  console.log(`\\n[Tool]: ${event.tool.name}`)
})

// 4. Create session and run
const session = createSession()

await prompt({
  sessionId: session.id,
  parts: [{ 
    type: 'text', 
    text: 'Please greet Alice using the greet tool' 
  }]
})

console.log('\\nDone!')
```

## TypeScript Support

Full type definitions included:

```typescript
import type { 
  ToolDef, 
  ToolContext, 
  ToolResult,
  Session, 
  AgentConfig,
  ProfileDef 
} from '@atom/sdk'
```

## API Reference

### Core Functions

- `bootstrap()` - Initialize Atom
- `createSession(opts?)` - Create a new session
- `prompt(options)` - Run the agent loop
- `cancel(sessionId)` - Cancel a running session

### Tool System

- `register(tool)` - Register a tool
- `defineTool(def)` - Define a tool with types
- `listTools()` - List registered tools

### Events

- `bus.on(event, handler)` - Listen to agent events
  - Events: `text-delta`, `tool-start`, `tool-end`, `message-start`, etc.

## Requirements

- Node.js 18+ or Bun runtime
- For database operations, Bun runtime is required (uses `bun:sqlite`)
