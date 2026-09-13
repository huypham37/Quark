import type { JSX } from "solid-js"

export function PlusIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
}

export function SearchIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9 3a6 6 0 1 0 3.75 10.7L17 18" /></svg>
}

export function CommandIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9 3a6 6 0 1 0 3.75 10.7L17 18m-3-9a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z" /></svg>
}

export function ChevronIcon(props: { class?: string } = {}): JSX.Element {
  return <svg class={props.class ?? "chevron"} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
}

export function SendIcon(): JSX.Element {
  return <svg class="send-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 5-5 5 5m-5-5v11" /></svg>
}

export function PanelIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2.5" /><path d="M7.5 4v12" /></svg>
}

export function FolderIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.2l1.4 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7.2A1.5 1.5 0 0 1 16 17.5H4a1.5 1.5 0 0 1-1.5-1.5Z" /></svg>
}

export function BranchIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="15" r="2" /><circle cx="14" cy="8" r="2" /><path d="M6 7v6M14 10c0 2.5-2 3.5-4.5 3.5H6" /></svg>
}

export function CloseIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" /></svg>
}
