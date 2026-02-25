# PostHog IDE Companion

PostHog, but in your editor. Errors, analytics, feature flags, surveys, alerts, all of it, without opening a browser tab.

---

## How this started

I was integrating PostHog into a project and discovered the [Wizard](https://github.com/PostHog/wizard), a CLI tool that uses Claude to instrument your codebase. Cool idea. Then I hit a 401 on the LLM gateway and the whole thing just stopped.

So I cloned the repo, dug around, and figured out the issue was with PostHog's internal gateway. I added a `--anthropic-key` flag that lets you bring your own API key and skip the gateway entirely. That became my [first PR](https://github.com/PostHog/wizard/pull/271).

While I was poking around in there, something else bugged me. The wizard doesn't ask for your opinion. It scans your codebase and just starts adding event captures wherever it wants. No "hey, here's what I'm about to do, cool?" So I built an interactive mode where you actually see the plan, what files get touched, what functions, what lines, and you approve, modify, or reject before anything happens. [Second PR](https://github.com/PostHog/wizard/pull/275).

The PostHog team reached out after that, said they appreciated the work, and even hooked me up with a discount on their merch store (thanks for that 🦔). We went back and forth over email a bit.

But then I couldn't stop thinking about the bigger picture.

The wizard handles onboarding. The [MCP server](https://mcp.posthog.com) lets AI tools query your data. But once a developer has PostHog set up... what keeps them coming back to it every day?

Here's the problem: PostHog is a **pull** experience right now. You have to remember to open a tab, navigate to some dashboard, and check on things. That takes discipline and context-switching, and honestly? It just doesn't happen often enough. The data ends up being something PMs and ops people look at. The developers who actually write the features almost never see how users interact with what they built.

This extension flips that to **push**. Errors, stale flags, concluded experiments, alerts firing. They just show up where you already are. No special tab to remember. No Slack notification to scroll past.

So yeah. The wizard gets you integrated. The MCP lets you query. This extension makes PostHog a **continuous companion** that just lives in your editor and does useful stuff in the background.

---

## What it does

Basically two things.

First, it watches your PostHog project in the background and tells you when stuff needs attention. Errors popping up, alerts firing, experiments that concluded, feature flags that have been sitting at 100% for way too long. You don't have to go looking for any of it.

Second, there's a full AI chat built in. You can query your data, spin up dashboards, create and manage alerts, toggle feature flags, set up surveys, investigate errors, search your codebase, and get code fix suggestions. All through natural language, all without leaving your editor.

### Integration

Same thing the wizard does on the CLI, but with visual diffs and approval flows right in VS Code. The companion looks at your codebase, figures out the right SDK and config, and shows you exactly what it wants to do. You approve before anything changes.

[Watch demo →](placeholder-integration-video)

### Custom event tracking

The wizard does this during onboarding as a one-shot pass. The companion makes it ongoing. It can scan your codebase for places where captures make sense, but you approve or tweak every single one. You can also just highlight a function and say "add captures here." And when you create new files, it watches for those too and suggests captures if they make sense.

[Watch demo →](placeholder-custom-events-video)

### Dashboards

Okay so if you can capture events and query your data in plain english, you can probably guess where this goes. Ask something like "how many users signed up this week?" and the AI queries PostHog, builds insights on the fly, and can put together a full dashboard you can share with your team.

[Watch demo →](placeholder-dashboard-video)

### Alerts

Create, update, and manage PostHog alerts without leaving VS Code. When one fires, you get notified, investigate the cause, and fix it in the same flow.

[Watch demo →](placeholder-alerts-video)

### Errors

Active errors from PostHog show up in your sidebar. Click one, the AI pulls the stack trace, searches your codebase for the relevant code, and proposes a fix. All in one conversation, no tab switching.

[Watch demo →](placeholder-errors-video)

### Feature flags

Create flags, spot stale ones that have been sitting at 100% rollout for over 30 days, catch rollbacks you might've missed. You can highlight some code and ask the companion to wrap it in a flag, and it'll do that and even help you toggle it on and off from the chat.

[Watch demo →](placeholder-flags-video)

### Surveys

Describe the survey you want in plain english and the AI sets it up in PostHog. Need it tied to a specific button or user action? It creates the survey on PostHog's side *and* proposes the code changes to wire it up in your codebase.

[Watch demo →](placeholder-survey-video)

---

## How it works

![Product Flow](docs/product-flow.png)

### Some technical decisions worth talking about

**Single-loop agent, not a multi-agent graph.** The AI runs one iterative loop with access to a bunch of tools (internal ones, MCP, and REST). It keeps full conversation context, self-corrects when things go sideways, and decides what to do next on its own. I tried the multi-agent approach early on and kept running into context getting lost at handoffs between agents. One loop turned out to be way more reliable.

**MCP for live PostHog data.** I actually started by building custom tools against PostHog's REST API because my initial OAuth scopes only gave me access to like 8 MCP tools. After expanding the scopes, I realized the MCP server covers most of what I needed. So I swapped out my custom tools for MCP equivalents and only kept the ones MCP doesn't provide yet, like alert management. Less code to maintain and the tools stay current as PostHog updates their server.

**Tool tiering with consent.** Not all tools are created equal. Reading a file? Safe. Editing your code or deleting an alert? Not so much. So tools are organized into tiers, and anything that mutates your codebase or PostHog data requires you to explicitly approve it before it runs. There's also a practical reason for this: loading every single tool into the prompt at once was watering down the context and causing hallucinations. So I split them into core tools (always loaded) and dynamic ones (the LLM just knows their names and requests the full definition when it actually needs one). Keeps things focused.

**Proactive polling.** Five pollers running on 5-minute intervals, each watching for something different: active errors, firing alerts, concluded experiments, stale feature flags, and flag rollbacks. Results show up in the sidebar with badge counts. The architecture is designed so adding a new discovery type is just dropping in another poller.

**OAuth with PKCE and Dynamic Client Registration.** PostHog supports DCR and PKCE, which meant I could build the auth flow without needing a hardcoded client ID. The extension registers itself as a client each session via DCR, generates PKCE challenges with S256, and spins up a localhost callback on whatever port the OS gives it. Works across PostHog's US and EU cloud regions without any pre-configuration needed.

**Agentic workspace detection.** Instead of depending on PostHog's hosted LLM proxy or the context-mill pipeline, I just gave the AI file and search tools and let it explore the codebase on its own. It reports back structured JSON with frameworks, project structure, and any PostHog setup issues, with actual file paths as evidence. This means it adapts to whatever project you throw at it. And if the agent hits the iteration limit before it's done, a fallback forces it to output whatever it found so far. Partial detection beats no detection.

**Context compaction.** When conversations get long, older messages get summarized while the last 4 exchanges stay intact. There's a fun edge case where the summarizer LLM sometimes tries to call tools during compaction, so there's a fallback that just extracts user messages instead. Prevents infinite recursion and keeps conversations going without blowing up context limits.

---

## Path to production

Everything above works end-to-end today with BYOK (bring your own key) for Anthropic or OpenAI. Here's what would make it fully production-ready:

**PostHog LLM gateway integration.** This is the big one. Right now users need their own API keys. Hooking into PostHog's native gateway means zero extra cost for users. PostHog handles the AI infra, users just use the extension.

**Cross-framework testing.** Built and tested against JavaScript/TypeScript projects so far. Needs proper validation across Python, Ruby, Go, and the other frameworks PostHog supports.

**Prompt eval pipeline.** The prompts work, but I haven't put them through any systematic evaluation yet. Building an eval pipeline with real-world scenarios to measure accuracy, hallucination rate, and task completion would make the AI a lot more reliable.

**More LLM providers.** Currently Anthropic and OpenAI. Adding more models means more people can use it.

**Verified OAuth client.** The DCR flow works but isn't verified by PostHog yet. Getting it verified means a smoother auth experience without security warnings.

**Polish.** Better icons, marketplace listing copy, a proper first-run experience. The stuff that makes it feel like a real product and not a side project.

**Docs.** Setup guides, configuration options, what commands are available. Clear enough that someone can get going without reading source code.

**E2E QA.** Testing across VS Code versions, different OSes, and all the edge cases. Network failures, huge workspaces, rate limits, etc.

---

## Getting started

### You'll need

- VS Code 1.85+
- A [PostHog](https://posthog.com) account
- An API key from [Anthropic](https://console.anthropic.com) or [OpenAI](https://platform.openai.com)

### Setup

```bash
git clone https://github.com/tobiokedeji/ph-companion.git
cd ph-companion
pnpm install
pnpm compile
```

Then hit `F5` in VS Code to launch the extension in a dev host. Sign in to PostHog from the sidebar, pick your project, configure your AI provider, and you're good.

The extension starts polling your project right away and surfaces discoveries as they come in.

---

## Stack

TypeScript (strict mode), Anthropic SDK + OpenAI SDK, MCP SDK, Zod for runtime schema validation, esbuild for bundling, Jest for testing (42 test files), VS Code Extension API for sidebar views, webview panels, auth provider, and code lenses.

---

*Built by [Tobi Okedeji](https://github.com/tobiokedeji). Started from a bug, ended up here.*