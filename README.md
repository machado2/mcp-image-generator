# Image Generation MCP Server

An MCP (Model Context Protocol) server for image generation and editing using multiple providers (Gemini, Replicate, Hugging Face).

## Installation

### Option 1: Global Installation via npm

```bash
npm install -g image-generation-mcp-server
```

### Option 2: Local Installation

```bash
npm install image-generation-mcp-server
```

## Configuration

You can configure the provider through environment variables. The server will automatically select the provider based on configuration or API key availability.

### Supported Providers

#### 1. Google Gemini (Default)
- **Model**: `gemini-3-pro-image-preview`
- **Environment Variable**: `GEMINI_API_KEY`
- **Cost**: Free (currently in preview)

#### 2. Replicate
- **Generation**: `sdxl-lightning` (Fast and low cost)
- **Editing**: `instruct-pix2pix`
- **Environment Variable**: `REPLICATE_API_TOKEN`
- **Explicit Configuration**: `IMAGE_GENERATION_PROVIDER=replicate`

#### 3. Hugging Face
- **Generation**: `stable-diffusion-xl-base-1.0`
- **Editing**: *Not supported in current version*
- **Environment Variable**: `HUGGING_FACE_TOKEN`
- **Explicit Configuration**: `IMAGE_GENERATION_PROVIDER=huggingface`

### `.env` Example

```bash
# Gemini
GEMINI_API_KEY=your-gemini-api-key

# Replicate
REPLICATE_API_TOKEN=your-replicate-api-token

# Hugging Face
HUGGING_FACE_TOKEN=your-hugging-face-token

# Force provider selection (optional)
IMAGE_GENERATION_PROVIDER=replicate
```

## MCP Client Configuration

### Claude Desktop / Amp / Others

Configure as an MCP "command" or "stdio" server.

#### Option 1: Using npx (Recommended)

```bash
npx image-generation-mcp-server
```

#### Option 2: Using Node directly

```bash
node path/to/mcp-server.js
```

#### Option 3: Using global installation

If installed globally with `npm install -g image-generation-mcp-server`:

```bash
image-generation-mcp-server
```

**Environment Variables**:
Make sure to pass the required environment variables (`GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `HUGGING_FACE_TOKEN`) in your client configuration.

## Available Tools

### `generate_image_from_text`
Generates a new image from a text description.

**Parameters:**
- `prompt`: Detailed description of the image.
- `output_path` (optional): Path where the generated image will be saved.

### `edit_image`
Edits an existing image based on instructions.

**Parameters:**
- `image_path`: Path to the original image.
- `prompt`: Editing instructions.
- `output_path` (optional): Path where the result will be saved.

## Requirements

- Node.js 18+
- API key from at least one of the supported providers.
