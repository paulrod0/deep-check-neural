# Galtea Mock Customer Call Script

**Format:** 2-minute video | Mock discovery call
**Characters:** Pablo (Galtea) and Sarah Chen (VP Engineering, NovaPay)
**Setting:** Video call, both on camera

---

## SECTION 1 -- Introduction (0:00 - 0:15)

[0:00] **Pablo:** Sarah, thanks for making time today. I'm Pablo, co-founder at Galtea. We help engineering teams like yours get visibility into how their AI agents are actually performing in production -- not just whether they run, but whether they're doing a good job. I know you have a lot going on at NovaPay, so I'll keep this tight.

[0:12] **Sarah:** Appreciate that. Yeah, we're scaling fast and things are getting... interesting.

---

## SECTION 2 -- Discovery Questions (0:15 - 0:35)

[0:15] **Pablo:** [leans in slightly] So tell me -- you have twelve agents live right now. When one of them starts drifting, giving inconsistent answers or making a bad call on a fraud review, how long does it typically take your team to notice?

[0:24] **Sarah:** Honestly? Sometimes days. We catch it in customer complaints or when someone manually spot-checks outputs. We built some internal logging, but nobody has time to look at dashboards.

[0:32] **Pablo:** And when you do catch something, is there a clear way to trace it back -- like, which model version, which prompt, what changed?

[0:35] **Sarah:** [shakes head] Not really. That's the gap.

---

## SECTION 3 -- Value Proposition: Outcomes (0:35 - 1:05)

[0:35] **Pablo:** That's exactly the pattern we see with teams at your stage. Here's what changes with Galtea. [pauses briefly]

[0:40] **Pablo:** First -- you stop finding problems from customer escalations. Galtea continuously evaluates your agents against quality criteria you define, so you know within minutes when something degrades, not days.

[0:50] **Pablo:** Second -- your team gets hours back. Right now someone is manually reviewing outputs, building one-off scripts, maintaining evaluation spreadsheets. Galtea replaces all of that with a single system of record for agent quality.

[0:58] **Pablo:** And third -- you ship faster. When your developers can see the impact of a prompt change or a model swap before it hits production, they stop being afraid to iterate. That's the real unlock.

[1:05] **Sarah:** That last part resonates. We've definitely slowed down deployments because people are nervous about breaking things.

---

## SECTION 4 -- Onboarding Demo (1:05 - 1:35)

[1:05] **Pablo:** Let me show you how simple the setup is. [shares screen]

[SCREEN: Galtea dashboard, "Deploy Agent" panel visible]

[1:08] **Pablo:** This is the Deploy Agent tool. You point it at one of your existing agents -- say your fraud review agent. You give it a name, connect your model endpoint, and define what "good" looks like. That can be accuracy thresholds, response format rules, latency bounds, whatever matters to you.

[SCREEN: Agent configuration form with fields populated -- agent name "NovaPay Fraud Review", endpoint URL, evaluation criteria checklist]

[1:20] **Pablo:** Once deployed, Galtea starts running evaluations against live traffic. No code changes on your side, no SDK to integrate into your pipeline. It observes, evaluates, and alerts.

[SCREEN: Dashboard showing a live agent with quality score trending over time, green status indicators]

[1:28] **Pablo:** And everything is versioned. So when your team pushes a new prompt next Tuesday, you'll see exactly how it compares to last week's baseline -- side by side.

[1:35] **Sarah:** And this works with our existing stack? We're on a mix of providers.

[1:37] **Pablo:** Yes, provider-agnostic. Wherever your agents run, Galtea plugs in.

---

## SECTION 5 -- Next Steps (1:37 - 1:50)

[1:37] **Pablo:** [stops screen share, back on camera] Here's what I'd suggest. Let's start small. Pick two of your twelve agents -- ideally one that's high-risk, like fraud, and one that's high-volume, like customer support. We run a one-week pilot, zero commitment. By the end of the week, your team will have a clear picture of how those agents are performing and where the gaps are.

[1:50] **Sarah:** Two agents, one week. I can make that happen. What do you need from our side?

[1:53] **Pablo:** Just an API endpoint for each agent and thirty minutes with whoever owns them. We handle the rest.

---

## SECTION 6 -- Close (1:53 - 2:00)

[1:55] **Sarah:** Alright, let's do it. I'll get you connected with our ML lead this week.

[1:58] **Pablo:** [smiles] Perfect. I'll send over a short onboarding doc after this call so your team knows what to expect. Sarah, thanks again -- looking forward to it.

[2:00] **Sarah:** Same here. Talk soon.

[Call ends]

---

## Production Notes

- **Pablo's energy:** Calm, direct, unhurried. Listens more than he talks in the discovery section. Never oversells.
- **Screen share timing:** Only 30 seconds on screen. The demo supports the conversation, it doesn't dominate it.
- **Key selling moment:** The transition at 0:35 where Pablo reflects back what Sarah said and reframes it as a solvable problem.
- **What to avoid:** Feature lists, technical jargon, pricing discussion. This call is about earning the pilot.
