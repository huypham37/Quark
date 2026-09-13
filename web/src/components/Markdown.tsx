import { For, Show } from "solid-js"

type InlinePart = { type: "text" | "code" | "strong"; value: string }
type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string }

function inline(text: string): InlinePart[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map((value) => {
    if (value.startsWith("`") && value.endsWith("`")) return { type: "code", value: value.slice(1, -1) }
    if (value.startsWith("**") && value.endsWith("**")) return { type: "strong", value: value.slice(2, -2) }
    return { type: "text", value }
  })
}

function prose(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: Extract<Block, { type: "list" }> | null = null

  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") })
    if (list) blocks.push(list)
    paragraph = []
    list = null
  }

  for (const line of text.split("\n")) {
    const value = line.trim()
    if (!value) {
      flush()
      continue
    }
    const heading = value.match(/^(#{1,4})\s+(.+)/)
    const unordered = value.match(/^[-*]\s+(.+)/)
    const ordered = value.match(/^\d+\.\s+(.+)/)
    if (heading) {
      flush()
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! })
    } else if (unordered || ordered) {
      if (paragraph.length) flush()
      const isOrdered = Boolean(ordered)
      if (!list || list.ordered !== isOrdered) {
        if (list) blocks.push(list)
        list = { type: "list", ordered: isOrdered, items: [] }
      }
      list.items.push((unordered ?? ordered)![1]!)
    } else {
      if (list) flush()
      paragraph.push(value)
    }
  }
  flush()
  return blocks
}

function parse(text: string): Block[] {
  const blocks: Block[] = []
  text.split(/```/).forEach((fragment, index) => {
    if (!fragment.trim()) return
    if (index % 2 === 1) {
      blocks.push({ type: "code", text: fragment.replace(/^\w+\n/, "").trim() })
    } else {
      blocks.push(...prose(fragment))
    }
  })
  return blocks
}

function Inline(props: { text: string }) {
  return <For each={inline(props.text)}>{(part) => (
    <Show when={part.type === "code"} fallback={
      <Show when={part.type === "strong"} fallback={part.value}><strong>{part.value}</strong></Show>
    }><code>{part.value}</code></Show>
  )}</For>
}

export function Markdown(props: { text: string }) {
  return <For each={parse(props.text)}>{(block) => (
    <Show when={block.type === "paragraph"} fallback={
      <Show when={block.type === "heading"} fallback={
        <Show when={block.type === "list"} fallback={
          <pre><code>{block.type === "code" ? block.text : ""}</code></pre>
        }>
          {block.type === "list" && (block.ordered
            ? <ol><For each={block.items}>{(item) => <li><Inline text={item} /></li>}</For></ol>
            : <ul><For each={block.items}>{(item) => <li><Inline text={item} /></li>}</For></ul>)}
        </Show>
      }>
        {block.type === "heading" && (block.level < 3 ? <h2><Inline text={block.text} /></h2> : <h3><Inline text={block.text} /></h3>)}
      </Show>
    }><p><Inline text={block.type === "paragraph" ? block.text : ""} /></p></Show>
  )}</For>
}
