# Direction

As we discussed, from now on, I will work full-time at PMI, working on my thesis.
Topic: Can AI (LLM) find more threats + attack vectors than human engineers?

Constraints:
- Commercial hardware 
-> smaller models than the frontier models from commercial AI provider like Microsoft, OpenAI or Anthropic 
-> a difficult problem but great oppoturnities for engineering & optimisation.



Solutions (Directions):


In order to answer the questions above, I propose 2 solutions:
In all solutions, the following configuration will be applied:
- PMI projects meta data, architecture, authentication method, DFD, deployment method,... but no threat model to avoid contaminate the results with existing threats.
- Human instructions: Rules and instructions such as (return the results in a json format, ), prioritisation (prioritise on software security, less on network security, etc..)
- Tool: Read, Write, Bash tool so AI can read and write plan by its own





- Fully autonomous AI Agent (LLM with access to tool such as file reading, file writing, writing todo list and executing task by following step by step): AI will make decision on its own without human intervention.



- AI workflow: It is better to understanding using the following example:



To do threat modeling, couple of general steps usually implemented.
1. Define the exposed assets, authentication method, deployment method, understand the architecture, boundaries, etc.
2. Attacker Profiling: Who could be the attackers? Can the IT admin be an attacker? or a random patients? 
3. From the attacker profiles and their intent, what should we protect? in the situation of PMI, we must protect the pattients identity, their data such as medical image
4. From all of the information above create threats which includes attack vectors. Threats consist of: STRIDE, attack-vectors: name::description::preconditions::target::attack_point::method::severity::priority(high,medium,low)



Issue: 
1. At each the step in the workflow, LLM can make up attacks that not related to the system 
Example: It is like the company hires a security company to do threat modeling but spend 2 hours talking about the system without showing the actual webapp, so if the app has search box, if the app using this technologies, that protocols, the experts can only assume about the system 
-> solution: 
* Giving these models access to the web or at least give them some screenshot.
* Having validation after each step



# Plan sketch: 
This project will take 9 weeks of full-time working including writing thesis and presentation
- Quickly build prototype for two architecture. Estimating: 1 weeks
- Running experiments and engineering: 1-3 days
  - Key challenges: This requires access to more projects in PMI to see if we can find more threats than human
- Cross-validation by engineer: 
  - Key challenges: this requires human validation on AI results to see if AI results is actual valid to the system at-test. This can take 1-2 weeks depends on how busy they are
- Analysis: 1 week 
- Writing papers: 2 weeks.



## Risk:
- Human validation could take more due to their work load and availability -> Mitigation: the planning giving some buffers for this, in the worse case, this will be documented as limitation.
- Access to other projects in PMI is restricted -> mitigation: Unknown
 
