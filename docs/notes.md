# Motivation of building Quark

I am a big fan of coding agent, I want to push the limits of these coding agent as far as possible.
I tried different coding agent from Codex, Claude Code or Opencode and Amp. They are the great tools, but different tools were build differently with each agent has its own secret sauce which annoying me when switching agents. Opencode is fine, I just dont like its UI and the complex config files in json (which I hate changing manually, that why Quark support yaml config) . Ampcode is the best coding agent harness I found, you give it a task, and the system autonomously explore, discover the way to solve the problem, minimal hand-holding from coders, but Amp is expensive, and closed-source, they dont allow user to switch models mid-session and we have to stick to their opiniated take on the selection of models.

So I make Quark:

The goal is deadly simple, I want Quark solving my problem of good tool is close-sourced, strictly tied to the providers, cannot easily to switch between model. Opensourced tool like opencode is not fun to use and not easily hackable, I want an agent that be able to plug to my research pipeline at work with minimal change on the existing codebase. So I made QUark. 

  - Quark is my experiment on agent harness, the harness that I believe can push LLM's performance far without needing to retrain the models.
  - Quark is feature-riched, full-packaged coding agent that allows remote control, cli tools if I need just a quick spinup to ask a random question or when I forget cli-command, quark ship with beautiful TUI and desktop environment, if we need.
  - with Quark, I owns my conversation, my conversation data which later on I can use for fine-tuning small-model, or RL to get better result from small-model. I dont like Ampcode approach where they store my conversation on their infrastrcuture, same as Anthropic and OpenAI. 

And finally, it is just a toy that I have a lot of fun building with, make it become more powerful, apdapt well to my workflow and learning more about agent harness. 

Well come to Quark.
