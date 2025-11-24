# Image Generation MCP Server

## Commands
- **Run Server**: `npm start` (runs `server.js`) or `node mcp-server.js` (CLI/MCP entry point).
- **Install**: `npm install`
- **Test**: No test suite configured. Manually verify using MCP inspector or CLI.
- **Lint**: No linter configured. Follow existing style.

## Architecture
- **Type**: Model Context Protocol (MCP) Server for image generation/editing.
- **Entry Points**: `mcp-server.js` (CLI/Bin) and `server.js` (Alternative).
- **Providers**: Gemini (default), Replicate, Hugging Face.
- **Configuration**: Environment variables (`GEMINI_API_KEY`, `REPLICATE_API_TOKEN`).

## Code Style & Conventions
- **Format**: ES Modules (`import`/`export`), semi-colons, double quotes.
- **Async**: Use `async`/`await`. Wrap API calls in `try/catch` with `console.error`.
- **Typing**: Plain JavaScript (no TypeScript). Ensure input validation.
- **Logic**: Isolate provider logic (e.g., `generateImageGemini`).
- **Path Handling**: Use `fileURLToPath` and `path.dirname` for ES module path resolution.
