import { createSignal, type Accessor } from "solid-js"
import type { QuestionRequest } from "./state"

export interface QuestionKeyHandler {
  tab: Accessor<number>
  selected: Accessor<number>
  answers: Accessor<string[][]>
  customMode: Accessor<boolean>
  customText: Accessor<string>
  setCustomText: (text: string) => void
  submitCustom: (text?: string) => void
  handleKey: (name: string) => boolean
  reset: () => void
  isConfirm: () => boolean
  single: () => boolean
}

export function createQuestionKeyHandler(props: {
  request: () => QuestionRequest | undefined
  onReply: (answers: string[][]) => void
  onReject: () => void
}): QuestionKeyHandler {
  const [tab, setTab] = createSignal(0)
  const [selected, setSelected] = createSignal(0)
  const [answers, setAnswers] = createSignal<string[][]>([])
  const [customMode, setCustomMode] = createSignal(false)
  const [customText, setCustomText] = createSignal("")

  const questions = () => props.request()?.questions ?? []
  const single = () => questions().length === 1 && questions()[0]?.multiple !== true
  const question = () => questions()[tab()]
  const options = () => question()?.options ?? []
  const hasCustom = () => question()?.custom === true
  const isMulti = () => question()?.multiple === true
  const isConfirm = () => !single() && tab() === questions().length
  const totalOptions = () => options().length + (hasCustom() ? 1 : 0)

  function finishCustomAnswer(text?: string) {
    const value = (text ?? customText()).trim()
    if (!value) return

    const a = [...answers()]
    const existing = isMulti() ? [...(a[tab()] ?? []), value] : [value]
    a[tab()] = existing
    setAnswers(a)
    setCustomMode(false)
    setCustomText("")

    if (single()) {
      props.onReply(a)
      return
    }

    setTab(tab() + 1)
    setSelected(0)
  }

  function pick(label: string) {
    const a = [...answers()]
    a[tab()] = [label]
    setAnswers(a)

    if (single()) {
      props.onReply([[label]])
      return
    }
    setTab(tab() + 1)
    setSelected(0)
  }

  function toggle(label: string) {
    const a = [...answers()]
    const existing = a[tab()] ?? []
    const next = [...existing]
    const idx = next.indexOf(label)
    if (idx === -1) next.push(label)
    else next.splice(idx, 1)
    a[tab()] = next
    setAnswers(a)
  }

  function reset() {
    setTab(0)
    setSelected(0)
    setAnswers([])
    setCustomMode(false)
    setCustomText("")
  }

  /** Returns true if key was consumed. */
  function handleKey(name: string): boolean {
    if (!props.request()) return false

    if (customMode()) {
      if (name === "escape") {
        props.onReject()
        reset()
        return true
      }
      if (name === "return") {
        finishCustomAnswer()
        return true
      }
      if (name === "backspace" || name === "delete") {
        setCustomText((text) => text.slice(0, -1))
        return true
      }
      if (name === "space" || name === " ") {
        setCustomText((text) => `${text} `)
        return true
      }
      if (name.length === 1) {
        setCustomText((text) => `${text}${name}`)
        return true
      }
      return false
    }

    if (name === "escape") {
      props.onReject()
      reset()
      return true
    }

    if (isConfirm()) {
      if (name === "return") {
        const finalAnswers = questions().map((_, i) => answers()[i] ?? [])
        props.onReply(finalAnswers)
        reset()
        return true
      }
      if (name === "left" || name === "h") {
        setTab(Math.max(0, tab() - 1))
        setSelected(0)
        return true
      }
      return false
    }

    const opts = options()
    const total = totalOptions()

    if (total === 0) return false

    // Number keys for quick select, including the virtual custom option.
    const digit = Number(name)
    if (!Number.isNaN(digit) && digit >= 1 && digit <= Math.min(total, 9)) {
      const index = digit - 1
      setSelected(index)
      if (hasCustom() && index === opts.length) {
        setCustomMode(true)
        setCustomText("")
      } else {
        const opt = opts[index]
        if (opt) {
          if (isMulti()) toggle(opt.label)
          else pick(opt.label)
        }
      }
      return true
    }

    if (name === "up" || name === "k") {
      setSelected((selected() - 1 + total) % total)
      return true
    }

    if (name === "down" || name === "j") {
      setSelected((selected() + 1) % total)
      return true
    }

    if (name === "return") {
      if (hasCustom() && selected() === opts.length) {
        setCustomMode(true)
        setCustomText("")
      } else {
        const opt = opts[selected()]
        if (opt) {
          if (isMulti()) toggle(opt.label)
          else pick(opt.label)
        }
      }
      return true
    }

    // Tab/left/right for multi-question navigation
    if (name === "tab" || name === "right" || name === "l") {
      if (!single() && tab() < questions().length) {
        setTab(tab() + 1)
        setSelected(0)
        return true
      }
    }
    if (name === "left" || name === "h") {
      if (!single() && tab() > 0) {
        setTab(tab() - 1)
        setSelected(0)
        return true
      }
    }

    return false
  }

  return {
    tab,
    selected,
    answers,
    customMode,
    customText,
    setCustomText,
    submitCustom: finishCustomAnswer,
    handleKey,
    reset,
    isConfirm,
    single,
  }
}
