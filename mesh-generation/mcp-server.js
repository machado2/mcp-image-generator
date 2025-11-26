#!/usr/bin/env node

import axios from "axios";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment Variables
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;

if (!REPLICATE_API_TOKEN) {
  console.error("Error: REPLICATE_API_TOKEN is required for mesh generation.");
  process.exit(1);
}

console.error(`[System] Mesh Generation Server Started`);

// --- Shap-E / Replicate Implementation ---

// Cache for model version
let modelVersion = null;

async function getModelVersion() {
  if (modelVersion) return modelVersion;

  try {
    const url = "https://api.replicate.com/v1/models/cjwbw/shap-e";
    const response = await axios.get(url, {
      headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
    });

    if (response.data && response.data.latest_version && response.data.latest_version.id) {
      modelVersion = response.data.latest_version.id;
      return modelVersion;
    }
  } catch (error) {
    console.error("Error fetching Shap-E model version:", error.message);
  }

  // Fallback to a known version hash if lookup fails
  modelVersion = "0d348e32f723509b8cd6d20be8c774a2fb6cfe6f442fed892005e327a6f06649";
  return modelVersion;
}

async function generateMeshReplicate(prompt, params = {}) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error("Replicate API Token is required for mesh generation.");
  }

  const version = await getModelVersion();
  const url = "https://api.replicate.com/v1/predictions";

  const input = {
    prompt,
    guidance_scale: params.guidance_scale ?? 15,
    batch_size: params.batch_size ?? 1,
    render_mode: params.render_mode ?? "nerf",
    render_size: params.render_size ?? 128,
    save_mesh: params.save_mesh !== undefined ? params.save_mesh : true,
  };

  console.error(`[Mesh] Generating 3D asset using Shap-E:${version}`);

  const response = await axios.post(
    url,
    { version, input },
    {
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        "Prefer": "wait",
      },
      timeout: 600000, // 10 minutes max for initial request
    }
  );

  let prediction = response.data;

  // Poll with timeout (max ~10 minutes: 120 attempts × 5 seconds)
  let attempts = 0;
  const maxAttempts = 120;

  while (prediction.status !== "succeeded" && prediction.status !== "failed" && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    attempts++;
    const statusUrl = prediction.urls.get;
    const statusResponse = await axios.get(statusUrl, {
      headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` },
    });
    prediction = statusResponse.data;
    console.error(`[Mesh] Status: ${prediction.status} (attempt ${attempts}/${maxAttempts})`);
  }

  if (prediction.status === "failed") {
    throw new Error("Mesh generation failed: " + prediction.error);
  }

  if (prediction.status !== "succeeded") {
    throw new Error(`Mesh generation timeout after ${maxAttempts * 5} seconds. The model may be overloaded.`);
  }

  const output = prediction.output;
  let meshUrl = null;

  if (Array.isArray(output) && output.length > 0) {
    const stringUrls = output.filter((u) => typeof u === "string");
    meshUrl =
      stringUrls.find((u) => u.toLowerCase().endsWith(".obj")) ||
      stringUrls.find((u) => !u.toLowerCase().endsWith(".gif")) ||
      stringUrls[0];
  } else if (typeof output === "string") {
    meshUrl = output;
  } else if (output && typeof output === "object") {
    if (typeof output.mesh === "string") {
      meshUrl = output.mesh;
    } else if (Array.isArray(output.mesh) && output.mesh.length > 0) {
      const meshArray = output.mesh.filter((u) => typeof u === "string");
      meshUrl =
        meshArray.find((u) => u.toLowerCase().endsWith(".obj")) ||
        meshArray[0];
    }
  }

  if (!meshUrl) {
    throw new Error("No mesh output URL received from Shap-E prediction.");
  }

  console.error(`[Mesh] Downloading mesh from: ${meshUrl}`);

  const meshResponse = await axios.get(meshUrl, { responseType: "arraybuffer" });
  const contentType = meshResponse.headers["content-type"] || "";
  const buffer = Buffer.from(meshResponse.data);

  return { buffer, contentType, meshUrl };
}

async function generateMesh(prompt, outputPath, params = {}) {
  try {
    const { buffer, contentType } = await generateMeshReplicate(prompt, params);

    const ext = ".obj";

    if (!outputPath) {
      outputPath = `output_mesh_${Date.now()}${ext}`;
    }

    const resolvedOutputPath = path.resolve(outputPath);
    const dir = path.dirname(resolvedOutputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedOutputPath, buffer);

    return {
      success: true,
      output_path: resolvedOutputPath,
      content_type: contentType,
      format: "obj",
      message: "3D mesh generated successfully using Shap-E",
    };
  } catch (error) {
    console.error("Error generating mesh:", error.message);
    throw error;
  }
}

// --- Main Tool Logic ---

const tools = [
  {
    name: "generate_3d_mesh",
    description: "Generate a 3D mesh in OBJ format from a text description using Shap-E on Replicate.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Description of the 3D object to generate." },
        output_path: {
          type: "string",
          description: "Path to save the OBJ mesh file (e.g., my_mesh.obj). If omitted, a .obj file will be created automatically.",
        },
        guidance_scale: {
          type: "number",
          description: "Guidance scale for Shap-E (higher = more adherence to prompt). Default 15.",
        },
        batch_size: {
          type: "number",
          description: "Number of samples to generate. Default 1.",
        },
        render_mode: {
          type: "string",
          description: "Render mode for Shap-E (e.g., 'nerf'). Default 'nerf'.",
        },
        render_size: {
          type: "number",
          description: "Render resolution; also affects mesh quality. Default 128.",
        },
        save_mesh: {
          type: "boolean",
          description: "Whether to save mesh data instead of only GIF renders. Default true.",
        },
      },
      required: ["prompt"],
    },
  },
];

// --- MCP Server Boilerplate ---

async function processToolCall(toolName, toolInput) {
  if (toolName === "generate_3d_mesh") {
    return await generateMesh(toolInput.prompt, toolInput.output_path, {
      guidance_scale: toolInput.guidance_scale,
      batch_size: toolInput.batch_size,
      render_mode: toolInput.render_mode,
      render_size: toolInput.render_size,
      save_mesh: toolInput.save_mesh,
    });
  }
  throw new Error(`Unknown tool: ${toolName}`);
}

function sendMessage(message) {
  console.log(JSON.stringify(message));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on("line", async (line) => {
    try {
      const request = JSON.parse(line);
      if (request.jsonrpc !== "2.0") return;

      if (request.method === "initialize") {
        sendMessage({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: { name: "mesh-generation-server", version: "1.0.0" },
          },
        });
      } else if (request.method === "tools/list") {
        sendMessage({ jsonrpc: "2.0", id: request.id, result: { tools } });
      } else if (request.method === "tools/call") {
        try {
          const result = await processToolCall(request.params.name, request.params.arguments);
          sendMessage({
            jsonrpc: "2.0",
            id: request.id,
            result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
          });
        } catch (error) {
          sendMessage({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32603, message: error.message },
          });
        }
      }
    } catch (error) {
      // Ignore malformed lines
    }
  });
}

main().catch(console.error);
