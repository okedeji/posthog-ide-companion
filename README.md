# IDE Companion for PostHog

> **Community project** - not officially maintained by or affiliated with PostHog.

Bring PostHog into your editor. Monitor your product, investigate errors, manage feature flags, and query analytics without leaving VS Code.

## Features

### Proactive Discoveries

The extension polls your PostHog project every 5 minutes and surfaces what needs attention in the sidebar: active errors, firing alerts, concluded experiments, stale feature flags, and rollbacks.

### AI-Powered Chat

A built-in chat backed by Claude or GPT with full access to your PostHog data and codebase. Ask questions, take action, and get code suggestions in one place. All code changes and data mutations require your explicit approval before executing.

### Integration

Analyzes your codebase, figures out the right PostHog SDK and config, and shows you visual diffs for approval before changing anything. [Watch demo](https://github.com/user-attachments/assets/2bc4daa6-e2d1-4210-9922-bfb3f8c648ee)

### Custom Event Tracking

Scans your codebase for places where event captures make sense. Highlight a function and say "add captures here." Watches new files and suggests captures automatically. [Watch demo](https://github.com/user-attachments/assets/029405a8-1f64-4894-8838-b7dd5fa2bff6)

### Error Investigation

Active errors show up in the Discoveries sidebar. Click one and the AI pulls the stack trace, searches your codebase, and proposes a fix. [Watch demo](https://github.com/user-attachments/assets/ad655fc6-ad33-4ea0-b6f3-9961f56afcc2)

### Alert Management

Create, update, and manage PostHog alerts from VS Code. When one fires, investigate and fix in the same flow. [Watch demo](https://github.com/user-attachments/assets/93adc9dc-9473-4abc-8636-c4804f5a3e88)

### Feature Flags

Create flags, spot stale ones at 100% rollout for over 30 days, and catch rollbacks. Highlight code to wrap it in a flag, toggle flags on/off from chat. [Watch demo](https://github.com/user-attachments/assets/6752c6c1-991b-4ebf-93ca-4ad55c22ac37)

### Dashboards

Ask "how many users signed up this week?" and the AI queries PostHog, builds insights, and assembles dashboards you can share with your team. [Watch demo](https://github.com/user-attachments/assets/ce199c05-7abf-4a42-af49-28f52496aa62)

### Surveys

Describe a survey in plain English and the AI creates it in PostHog and proposes code changes to wire it into your app. [Watch demo](https://github.com/user-attachments/assets/eed48843-3080-4c5d-b49b-d5bcc6911543)

## Getting Started

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=tobiokedeji.posthog-ide-companion)
2. Open the PostHog sidebar and sign in to your PostHog account
3. Select your project
4. Configure your AI provider (Anthropic recommended)

The extension starts polling your project immediately and surfaces discoveries as they come in.

### Requirements

- VS Code 1.85+
- A [PostHog Cloud](https://posthog.com) account (US or EU region)
- An API key from [Anthropic](https://console.anthropic.com) or [OpenAI](https://platform.openai.com)

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/okedeji/posthog-ide-companion/issues) on GitHub.

## License

MIT
