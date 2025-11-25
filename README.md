# MCP Image, Sound & Mesh Generator

This monorepo contains three distinct Model Context Protocol (MCP) servers: one for image generation/editing, another for sound generation, and another for 3D mesh generation.

## Structure

- **[image-generation/](./image-generation/)**: MCP server providing tools for generating, editing, converting, and resizing images using Gemini, Replicate, and Hugging Face.
- **[sound-generation/](./sound-generation/)**: MCP server providing tools for generating sound effects, ambient sounds, and loops using Replicate.
 - **[mesh-generation/](./mesh-generation/)**: MCP server providing tools for generating 3D meshes for games using Shap-E on Replicate.

## Installation & Usage

### Image Generation Server

Navigate to `image-generation/`:
```bash
cd image-generation
npm install
```

Setup your `.env` file based on `.env.example`.

Start the server:
```bash
npm start
# or using the MCP CLI wrapper
node mcp-server.js
```

### Mesh Generation Server

Navigate to `mesh-generation/`:
```bash
cd mesh-generation
npm install
```

Setup your `.env` file based on `.env.example` (Requires `REPLICATE_API_TOKEN`).

Start the server:
```bash
npm start
# or using the MCP CLI wrapper
node mcp-server.js
```

### Sound Generation Server

Navigate to `sound-generation/`:
```bash
cd sound-generation
npm install
```

Setup your `.env` file based on `.env.example` (Requires `REPLICATE_API_TOKEN`).

Start the server:
```bash
npm start
# or using the MCP CLI wrapper
node mcp-server.js
```

## Configuration in MCP Client

You can configure these servers in your MCP client (like Claude Desktop, Amp, or Windsurf) by using the published npm packages via `npx`.

**Image Generation:**
```json
{
  "command": "npx",
  "args": ["-y", "image-generation-mcp-server"],
  "env": {
    "GEMINI_API_KEY": "...",
    "REPLICATE_API_TOKEN": "optional-replicate-token",
    "HUGGING_FACE_TOKEN": "optional-hf-token"
  }
}
```

**Sound Generation:**
```json
{
  "command": "npx",
  "args": ["-y", "sound-generation-mcp-server"],
  "env": {
    "REPLICATE_API_TOKEN": "..."
  }
}
```

**Mesh Generation:**
```json
{
  "command": "npx",
  "args": ["-y", "mesh-generation-mcp-server"],
  "env": {
    "REPLICATE_API_TOKEN": "..."
  }
}
```
