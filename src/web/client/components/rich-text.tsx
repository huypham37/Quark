import { useState, useMemo } from 'react'
import { Marked } from 'marked'
import { T } from '../tokens'

const marked = new Marked({
  breaks: true,
  gfm: true,
})

// Custom renderer to add copy buttons to code blocks
const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<div class="md-code-block" data-code="${encodeURIComponent(text)}">
      <div class="md-code-header">
        <span>${lang || 'code'}</span>
        <button class="md-copy-btn" onclick="(function(b){navigator.clipboard.writeText(decodeURIComponent(b.parentElement.parentElement.dataset.code));b.textContent='Copied!';setTimeout(function(){b.textContent='Copy'},2000)})(this)">Copy</button>
      </div>
      <pre><code class="language-${lang || ''}">${escaped}</code></pre>
    </div>`
  },
}

marked.use({ renderer })

export function RichText({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      return marked.parse(text) as string
    } catch {
      return text
    }
  }, [text])

  return (
    <div
      className="md-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
