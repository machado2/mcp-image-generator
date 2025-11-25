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
  console.error("Error: REPLICATE_API_TOKEN is required for sound generation.");
  process.exit(1);
}

console.error(`[System] Sound Generation Server Started`);

// --- Audio Generation Implementation ---

// Model mappings
const AUDIO_MODELS = {
    SFX: "sepal/audiogen",
    AMBIENT: "haoheliu/audio-ldm", 
    LOOP: "stability-ai/stable-audio-2.5"
};

// Cache for model versions
const modelVersions = {};

async function getModelVersion(modelName) {
    if (modelVersions[modelName]) return modelVersions[modelName];

    try {
        const [owner, name] = modelName.split("/");
        const url = `https://api.replicate.com/v1/models/${owner}/${name}`;
        const response = await axios.get(url, {
            headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
        });
        
        if (response.data.latest_version) {
            modelVersions[modelName] = response.data.latest_version.id;
            return response.data.latest_version.id;
        }
    } catch (error) {
        console.error(`Error fetching version for ${modelName}: ${error.message}`);
    }
    
    // Fallback known hashes if lookup fails
    if (modelName === "sepal/audiogen") return "154b3e5141493cb1b8cec976d9aa90f2b691137e39ad906d2421b74c2a8c52b8"; 
    if (modelName === "haoheliu/audio-ldm") return "b61392adecdd660326fc9cfc5398182437dbe5e97b5decfb36e1a36de68b5b95"; 
    if (modelName === "stability-ai/stable-audio-2.5") return "a61ac8edbb27cd2eda1b2eff2bbc03dcff1131f5560836ff77a052df05b77491";

    throw new Error(`Could not determine version for model ${modelName}`);
}

async function generateSoundReplicate(prompt, type, duration = 5) {
    if (!REPLICATE_API_TOKEN) throw new Error("Replicate API Token is required for audio generation.");

    let modelName;
    let input = { prompt, duration };

    if (type === "sfx") {
        modelName = AUDIO_MODELS.SFX;
    } else if (type === "ambient") {
        modelName = AUDIO_MODELS.AMBIENT;
        // AudioLDM parameters
        input = { 
            text: prompt, // AudioLDM uses 'text' not 'prompt' in some versions, checking inputs...
            duration: duration.toString(), 
            n_candidates: 3,
            guidance_scale: 2.5
        };
    } else if (type === "loop") {
        modelName = AUDIO_MODELS.LOOP;
        input = {
            prompt,
            seconds_total: duration,
            steps: 100
        };
    } else {
        throw new Error("Invalid sound type");
    }

    const version = await getModelVersion(modelName);
    const url = "https://api.replicate.com/v1/predictions";
    
    console.error(`[Audio] Generating ${type} using ${modelName}:${version}`);

    const response = await axios.post(url, {
        version: version,
        input: input
    }, {
        headers: {
            "Authorization": `Token ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            "Prefer": "wait"
        }
    });

    let prediction = response.data;
    
    while (prediction.status !== "succeeded" && prediction.status !== "failed") {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const statusUrl = prediction.urls.get;
        const statusResponse = await axios.get(statusUrl, {
            headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
        });
        prediction = statusResponse.data;
    }

    if (prediction.status === "failed") throw new Error("Audio generation failed: " + prediction.error);
    
    // Replicate returns a URL to the audio file (or list of URLs)
    let audioUrl = prediction.output;
    if (Array.isArray(audioUrl)) audioUrl = audioUrl[0]; // Take first if array (common in some models)
    
    if (!audioUrl) throw new Error("No audio output URL received");

    const audioResponse = await axios.get(audioUrl, { responseType: "arraybuffer" });
    return Buffer.from(audioResponse.data);
}

async function generateSound(prompt, type, outputPath, duration) {
    try {
        const audioBuffer = await generateSoundReplicate(prompt, type, duration);
        
        // Determine output path
        if (!outputPath) {
            outputPath = `output_${type}_${Date.now()}.wav`;
        }
        
        const resolvedOutputPath = path.resolve(outputPath);
        const dir = path.dirname(resolvedOutputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(resolvedOutputPath, audioBuffer);
        
        return {
            success: true,
            output_path: resolvedOutputPath,
            message: `Sound generated successfully (${type})`
        };
    } catch (error) {
        console.error("Error generating sound:", error.message);
        throw error;
    }
}

// --- Main Tool Logic ---

const tools = [
  {
    name: "generate_sound_sfx",
    description: "Generate sound effects (SFX) using AudioGen (Meta). Best for real-world sounds like footsteps, explosions, engine noises, etc.",
    inputSchema: {
        type: "object",
        properties: {
            prompt: { type: "string", description: "Description of the sound (e.g., 'footsteps on wooden floor', 'laser gun shot')." },
            output_path: { type: "string", description: "Path to save the audio file." },
            duration: { type: "number", description: "Duration in seconds (default 2)." }
        },
        required: ["prompt"]
    }
  },
  {
    name: "generate_sound_ambient",
    description: "Generate ambient or abstract sounds using AudioLDM 2. Best for sci-fi, magic, drones, and background textures.",
    inputSchema: {
        type: "object",
        properties: {
            prompt: { type: "string", description: "Description of the sound." },
            output_path: { type: "string", description: "Path to save the audio file." },
            duration: { type: "number", description: "Duration in seconds (default 5)." }
        },
        required: ["prompt"]
    }
  },
  {
    name: "generate_sound_loop",
    description: "Generate short musical loops or beats using Stable Audio. Best for percussion, drum beats, or simple instrument riffs.",
    inputSchema: {
        type: "object",
        properties: {
            prompt: { type: "string", description: "Description of the loop." },
            output_path: { type: "string", description: "Path to save the audio file." },
            duration: { type: "number", description: "Duration in seconds (default 3)." }
        },
        required: ["prompt"]
    }
  }
];

// --- MCP Server Boilerplate ---

async function processToolCall(toolName, toolInput) {
  if (toolName === "generate_sound_sfx") {
      return await generateSound(toolInput.prompt, "sfx", toolInput.output_path, toolInput.duration || 2);
  }
  if (toolName === "generate_sound_ambient") {
      return await generateSound(toolInput.prompt, "ambient", toolInput.output_path, toolInput.duration || 5);
  }
  if (toolName === "generate_sound_loop") {
      return await generateSound(toolInput.prompt, "loop", toolInput.output_path, toolInput.duration || 3);
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
      if (request.jsonrpc !== "2.0") return; // Simple validation

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
            serverInfo: { name: "sound-generation-server", version: "1.0.0" },
          },
        });
      } else if (request.method === "tools/list") {
        sendMessage({ jsonrpc: "2.0", id: request.id, result: { tools: tools } });
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
