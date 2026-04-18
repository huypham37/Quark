import { questionTool, respondQuestion } from "../src/tool/question"
import { bus } from "../src/session/events"

async function main() {
  const ctx = {
    sessionId: "example-session",
    messageId: "msg-1",
    callId: "call-1",
    abort: new AbortController().signal,
    messages: [],
    async ask() {},
  }

  // Listen for the question-request and simulate a user reply after 500ms
  bus.on("question-request", (data: any) => {
    console.log("[example] question-request received:", JSON.stringify(data, null, 2))

    setTimeout(() => {
      const answers = data.questions.map((q: any) => [q.options[0].label])
      console.log("[example] responding with:", answers)
      respondQuestion({ requestId: data.requestId, answers })
    }, 500)
  })

  const result = await questionTool.execute(
    {
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [
            { label: "React", description: "React library" },
            { label: "Vue", description: "Vue library" },
          ],
        },
        {
          question: "Which language?",
          header: "Language",
          options: [
            { label: "TypeScript", description: "TypeScript" },
            { label: "JavaScript", description: "JavaScript" },
          ],
        },
      ],
    },
    ctx as any,
  )

  console.log("[example] questionTool result:", result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
