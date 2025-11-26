#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import axios from "axios";
import fs from "fs";
import path from "path";

// Environment Variables
const REPLICATE_API_TOKEN =
  process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;

if (!REPLICATE_API_TOKEN) {
  console.error(
    "Error: REPLICATE_API_TOKEN is required for mesh generation."
  );
  process.exit(1);
}

console.error(`[System] Mesh Generation MCP Server Started`);

// Cache for model version
let modelVersion: string | null = null;

async function getModelVersion(): Promise<string> {
  if (modelVersion) return modelVersion;

  try {
    const url = "https://api.replicate.com/v1/models/cjwbw/shap-e";
    const response = await axios.get(url, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    });

    if (
      response.data &&
      response.data.latest_version &&
      response.data.latest_version.id
    ) {
      modelVersion = response.data.latest_version.id;
      return modelVersion!;
    }
  } catch (error: any) {
    console.error("Error fetching Shap-E model version:", error.message);
  }

  // Fallback to a known version hash if lookup fails
  modelVersion =
    "0d348e32f723509b8cd6d20be8c774a2fb6cfe6f442fed892005e327a6f06649";
  return modelVersion;
}

interface MeshResult {
  buffer: Buffer;
  contentType: string;
  meshUrl: string;
}

interface GenerateMeshParams {
  guidance_scale?: number;
  batch_size?: number;
  render_mode?: string;
  render_size?: number;
  save_mesh?: boolean;
}

async function generateMeshReplicate(
  prompt: string,
  params: GenerateMeshParams = {}
): Promise<MeshResult> {
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
        Authorization: `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      timeout: 600000, // 10 minutes max for initial request
    }
  );

  let prediction = response.data;

  // Poll with timeout (max ~10 minutes: 120 attempts × 5 seconds)
  let attempts = 0;
  const maxAttempts = 120;

  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    attempts < maxAttempts
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    attempts++;
    const statusUrl = prediction.urls.get;
    const statusResponse = await axios.get(statusUrl, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    });
    prediction = statusResponse.data;
    console.error(
      `[Mesh] Status: ${prediction.status} (attempt ${attempts}/${maxAttempts})`
    );
  }

  if (prediction.status === "failed") {
    throw new Error("Mesh generation failed: " + prediction.error);
  }

  if (prediction.status !== "succeeded") {
    throw new Error(
      `Mesh generation timeout after ${maxAttempts * 5} seconds. The model may be overloaded.`
    );
  }

  const output = prediction.output;
  let meshUrl: string | null = null;

  if (Array.isArray(output) && output.length > 0) {
    const stringUrls = output.filter((u): u is string => typeof u === "string");
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
      const meshArray = output.mesh.filter(
        (u: any): u is string => typeof u === "string"
      );
      meshUrl =
        meshArray.find((u: string) => u.toLowerCase().endsWith(".obj")) ||
        meshArray[0];
    }
  }

  if (!meshUrl) {
    throw new Error("No mesh output URL received from Shap-E prediction.");
  }

  console.error(`[Mesh] Downloading mesh from: ${meshUrl}`);

  const meshResponse = await axios.get(meshUrl, { responseType: "arraybuffer" });
  const contentType = (meshResponse.headers["content-type"] as string) || "";
  const buffer = Buffer.from(meshResponse.data);

  return { buffer, contentType, meshUrl };
}

interface GenerateMeshOutput {
  success: boolean;
  output_path: string;
  content_type: string;
  format: string;
  message: string;
}

async function generateMesh(
  prompt: string,
  outputPath: string | undefined,
  params: GenerateMeshParams = {}
): Promise<GenerateMeshOutput> {
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
}

// --- MCP Server Setup ---

const server = new McpServer({
  name: "mesh-generation-server",
  version: "1.1.4",
});

// Register the generate_3d_mesh tool
server.registerTool(
  "generate_3d_mesh",
  {
    title: "Generate 3D Mesh",
    description:
      "Generate a 3D mesh in OBJ format from a text description using Shap-E on Replicate.",
    inputSchema: {
      prompt: z
        .string()
        .describe("Description of the 3D object to generate."),
      output_path: z
        .string()
        .optional()
        .describe(
          "Path to save the OBJ mesh file (e.g., my_mesh.obj). If omitted, a .obj file will be created automatically."
        ),
      guidance_scale: z
        .number()
        .optional()
        .describe(
          "Guidance scale for Shap-E (higher = more adherence to prompt). Default 15."
        ),
      batch_size: z
        .number()
        .optional()
        .describe("Number of samples to generate. Default 1."),
      render_mode: z
        .string()
        .optional()
        .describe("Render mode for Shap-E (e.g., 'nerf'). Default 'nerf'."),
      render_size: z
        .number()
        .optional()
        .describe(
          "Render resolution; also affects mesh quality. Default 128."
        ),
      save_mesh: z
        .boolean()
        .optional()
        .describe(
          "Whether to save mesh data instead of only GIF renders. Default true."
        ),
    },
  },
  async ({
    prompt,
    output_path,
    guidance_scale,
    batch_size,
    render_mode,
    render_size,
    save_mesh,
  }) => {
    try {
      const result = await generateMesh(prompt, output_path, {
        guidance_scale,
        batch_size,
        render_mode,
        render_size,
        save_mesh,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      console.error("Error generating mesh:", error.message);
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[System] MCP Server connected via stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
