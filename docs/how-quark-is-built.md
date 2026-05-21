Quark starts with couple user-stories in my mind:

- It starts with the most minimal agent loop.
- Quark supports multiple providers, but openaiAPI-compatible is first class
- Quark must support CLI mode/headless mode so I could plug this in my research pipeline.
- Quark must support agent profiles: which is the config of the agent isolated it from other agent such as: system-prompt, tools, agent skills, permissions. -> profile is isolated between agent, no leaking, no context contamination. The high level philosophy is the agent only tools that it need to solve the problem. If we look at it programmatically, agent is the function with the signature task -> output, and it should only have the amount of information it needs to solve the problem, the research agent dont need bash tool, the tester agent dont need websearch, similar to skills...

- Quark supports multiple tools starting with bash, read, write, edit, web search, web fetch.
- Quark support good UI and UX, I care about this -> intuitive TUI

medium priority:
- quark web: for remote working, I dont work remote but this one is good idea to look into.
- quark desktop tool: I care a lot of UI and UX and I want a tool which is not a heavy, thick curtain between me and the things that I am working on: writing, code, tex, web content, etc. Quark desktop is a rich-feature, brings my idea of future of working where human-agent has the same view on the tasks. not blurry view. Current work of Claude design/artifacts doing the same idea, but it is not there yet.
