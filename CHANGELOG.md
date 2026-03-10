# Changelog

## [0.2.0] - 2026-03-10

### Added
- Region-aware MCP endpoint (US and EU PostHog Cloud support)
- Marketplace icon and metadata for VS Code Marketplace publishing
- Gallery banner configuration
- CHANGELOG for tracking version history

### Changed
- README rewritten for marketplace audience with install instructions and known limitations
- Replaced `Math.random()` nonce generation with `crypto.getRandomValues()` for CSP security
- Updated package.json with keywords, author, and better categories
- Tightened `.vscodeignore` to reduce package size

## [0.1.0] - 2025-12-01

### Added
- Initial release
- OAuth authentication with PKCE and Dynamic Client Registration
- AI-powered chat with Anthropic (Claude) and OpenAI (GPT) support
- Proactive discovery system with five pollers: errors, alerts, experiments, stale flags, file analysis
- PostHog MCP integration for feature flags, experiments, dashboards, insights, surveys, and error tracking
- Tool consent system for mutation operations
- Workspace detection and PostHog SDK integration suggestions
- Custom event tracking with codebase scanning
- Alert management (create, update, delete)
- Chat history persistence
- Context compaction for long conversations
- Code lens for sending selections to chat
