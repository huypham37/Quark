# User Tools

Atom loads tools from `~/.config/atom/tools/` based on your active profile.

## Setup (one time)

```bash
mkdir -p ~/.config/atom/tools
cd ~/.config/atom/tools
cat > package.json << 'JSON'
{
  "name": "atom-user-tools",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "zod": "^3.22.0"
  }
}
JSON
npm install
```

## Adding a tool

Create a `.ts` file in `~/.config/atom/tools/`:

**Example: `~/.config/atom/tools/bash.ts`**
```typescript
import { z } from "zod"
import { defineTool } from "atom/tool"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export default defineTool({
  id: "bash",
  description: "Execute shell commands",
  parameters: z.object({
    command: z.string(),
    cwd: z.string().optional(),
  }),
  async execute(args, ctx) {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: args.cwd || process.cwd(),
      timeout: 30000,
    })
    
    return {
      title: `bash: ${args.command}`,
      output: stdout + stderr,
      metadata: { command: args.command },
    }
  },
})
```

## Enabling a tool

Add the tool to your profile in `~/.config/atom/config.yaml`:

```yaml
profiles:
  coder:
    tools: [read, skill, bash]  # Add your tool here
```

## Tool structure

Every tool must export a `ToolDef`:

```typescript
{
  id: "tool-name",              // Unique identifier
  description: "What it does",  // Shown to the LLM
  parameters: z.object({...}),  // Zod schema for validation
  execute: async (args, ctx) => {
    return {
      title: "Result title",
      output: "Content shown to LLM",
      metadata: {}  // Optional metadata
    }
  }
}
```

## Examples

See `examples/tools/` for more examples:
- `bash.ts` — Run shell commands
- `write.ts` — Write files
- `edit.ts` — Edit files with find/replace
- `grep.ts` — Search file contents
- `glob.ts` — Find files by pattern
- `todo.ts` — Task management
- `websearch.ts` — Web search

Copy these to `~/.config/atom/tools/` to use them.

## Troubleshooting

**Tool not loading?**
- Check for notifications in the top-right corner when Atom starts
- Ensure `zod` is installed in `~/.config/atom/tools/node_modules/`
- Verify the tool exports a default export with all required fields
- Tool ID must match the filename (e.g., `bash.ts` → `id: "bash"`)

**Import errors?**
- Run `cd ~/.config/atom/tools && npm install` to ensure dependencies are installed
- Use `import { z } from "zod"` (not `import zod from "zod"`)
