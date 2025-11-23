#!/usr/bin/env node

import axios from "axios";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment Variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const HUGGING_FACE_TOKEN = process.env.HUGGING_FACE_TOKEN;
const IMAGE_GENERATION_PROVIDER = process.env.IMAGE_GENERATION_PROVIDER || "gemini";

// Provider Configuration
const PROVIDERS = {
  GEMINI: "gemini",
  REPLICATE: "replicate",
  HUGGINGFACE: "huggingface",
};

// Helper to determine active provider
function getActiveProvider() {
  if (IMAGE_GENERATION_PROVIDER === PROVIDERS.REPLICATE && REPLICATE_API_TOKEN) return PROVIDERS.REPLICATE;
  if (IMAGE_GENERATION_PROVIDER === PROVIDERS.HUGGINGFACE && HUGGING_FACE_TOKEN) return PROVIDERS.HUGGINGFACE;
  if (GEMINI_API_KEY) return PROVIDERS.GEMINI;
  if (REPLICATE_API_TOKEN) return PROVIDERS.REPLICATE;
  if (HUGGING_FACE_TOKEN) return PROVIDERS.HUGGINGFACE;
  return null;
}

const activeProvider = getActiveProvider();
if (!activeProvider) {
  console.error("Error: No valid API key found. Please set GEMINI_API_KEY, REPLICATE_API_TOKEN, or HUGGING_FACE_TOKEN.");
  process.exit(1);
}

console.error(`[System] Using Image Provider: ${activeProvider.toUpperCase()}`);

// --- Gemini Implementation ---
const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

async function generateImageGemini(prompt) {
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const requestBody = {
    contents: [{ parts: [{ text: `${prompt}\n\nReturn ONLY the base64 encoded image string of the result, with no markdown formatting or explanation.` }] }],
  };

  const response = await axios.post(url, requestBody, { timeout: 60000 });
  
  if (!response.data.candidates?.[0]?.content?.parts?.[0]) {
    throw new Error("Invalid response from Gemini API");
  }

  const part = response.data.candidates[0].content.parts[0];
  if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
  if (part.text) {
      const cleanText = part.text.replace(/```base64/g, "").replace(/```/g, "").trim();
      return Buffer.from(cleanText, "base64");
  }
  throw new Error("No image data in Gemini API response");
}

async function editImageGemini(base64Image, mimeType, prompt) {
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const requestBody = {
      contents: [
        {
          parts: [
            { text: `${prompt}\n\nReturn ONLY the base64 encoded image string of the result, with no markdown formatting or explanation.` },
            { inlineData: { mimeType: mimeType, data: base64Image } },
          ],
        },
      ],
    };
  
    const response = await axios.post(url, requestBody, { timeout: 60000 });
    
    if (!response.data.candidates?.[0]?.content?.parts?.[0]) {
      throw new Error("Invalid response from Gemini API");
    }
  
    const part = response.data.candidates[0].content.parts[0];
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
    if (part.text) {
        const cleanText = part.text.replace(/```base64/g, "").replace(/```/g, "").trim();
        return Buffer.from(cleanText, "base64");
    }
    throw new Error("No image data in Gemini API response");
}

// --- Replicate Implementation ---
async function generateImageReplicate(prompt) {
  // Using SDXL-Lightning for speed and cost
  const modelVersion = "bytedance/sdxl-lightning-4step:5599ed30703defd1d160a25a63321b4dec97101d98b4674bcc56e41f62f35637"; 
  const url = "https://api.replicate.com/v1/predictions";
  
  const response = await axios.post(url, {
    version: "5599ed30703defd1d160a25a63321b4dec97101d98b4674bcc56e41f62f35637",
    input: { prompt: prompt }
  }, {
    headers: {
      "Authorization": `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      "Prefer": "wait"
    }
  });

  let prediction = response.data;
  
  // Simple polling if wait didn't finish it
  while (prediction.status !== "succeeded" && prediction.status !== "failed") {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const statusUrl = prediction.urls.get;
    const statusResponse = await axios.get(statusUrl, {
      headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
    });
    prediction = statusResponse.data;
  }

  if (prediction.status === "failed") throw new Error("Replicate generation failed: " + prediction.error);
  
  // Replicate returns a URL to the image
  const imageUrl = prediction.output[0];
  const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
  return Buffer.from(imageResponse.data);
}

async function editImageReplicate(base64Image, mimeType, prompt) {
    // Using InstructPix2Pix
    const version = "30c1d0b916a6f8efce20493f5d61ee27491ab2a60437c13c588468b9810ec23f";
    const url = "https://api.replicate.com/v1/predictions";
    
    // Need to upload image or provide as data URI. Replicate accepts data URI.
    const dataUri = `data:${mimeType};base64,${base64Image}`;

    const response = await axios.post(url, {
      version: version,
      input: {
        image: dataUri,
        prompt: prompt,
        image_guidance_scale: 1.5
      }
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
  
    if (prediction.status === "failed") throw new Error("Replicate edit failed: " + prediction.error);
    
    const imageUrl = prediction.output; // usually a string url for this model
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    return Buffer.from(imageResponse.data);
}


// --- Hugging Face Implementation ---
async function generateImageHuggingFace(prompt) {
    // Using Stable Diffusion XL Base 1.0
    const modelId = "stabilityai/stable-diffusion-xl-base-1.0";
    const url = `https://api-inference.huggingface.co/models/${modelId}`;

    const response = await axios.post(url, { inputs: prompt }, {
        headers: {
            "Authorization": `Bearer ${HUGGING_FACE_TOKEN}`,
            "Content-Type": "application/json"
        },
        responseType: "arraybuffer"
    });

    return Buffer.from(response.data);
}

async function editImageHuggingFace(base64Image, mimeType, prompt) {
    // Using InstructPix2Pix
    const modelId = "timbrooks/instruct-pix2pix";
    const url = `https://api-inference.huggingface.co/models/${modelId}`;

    // HF Inference API for img2img usually takes the image as binary in the body or JSON with specific structure depending on the pipeline.
    // For InstructPix2Pix on Inference API, it might be tricky. Let's try sending as parameters if supported, but HF Inference API for standard models usually expects simple input.
    // A better bet for standard API is generic Image-to-Image.
    // However, InstructPix2Pix is specific.
    
    // Alternative: Use image-to-image with SD 1.5 if InstructPix2Pix is not easily available via simple API call.
    // But let's try the standard way for image inputs in HF API: binary body doesn't work well for "edit with prompt".
    // usually it's { inputs: "prompt", parameters: {...}, image: "base64..." } or similar.
    // Actually, many HF Spaces/Inference endpoints expect the image as a file buffer or base64.

    // Trying a simpler approach for HF: standard generation (text-to-image) is robust. Image editing is hit or miss on free Inference API.
    // We will try to use the same model as generation but with img2img if possible, or just failover to text-to-image with a warning if we can't do it.
    
    // BUT, let's try to just call the API. If it fails, we throw.
    // Reading HF docs: For image-to-image, often you send the image bytes directly, but where does the prompt go? Headers? Query params?
    // Actually, for `timbrooks/instruct-pix2pix`, it's not always hosted on the free tier.
    
    // Let's stick to what works reliably:
    // If the user asks for HF edit, we might have to simulate it or warn.
    // But let's try to use `runwayml/stable-diffusion-v1-5` for img2img if we can.
    
    // Actually, for this implementation, to ensure "cheaper options" work:
    // I'll implement Text-to-Image for HF. 
    // For Edit-Image, I'll use `timbrooks/instruct-pix2pix` and send parameters. 
    // If it fails, I'll catch and say "Editing not supported on free HF tier for this model".
    
    // To keep it simple for this task: I will implement `generate` for HF.
    // For `edit`, I will throw an error saying "Image editing is not fully supported on Hugging Face provider yet".
    // Unless I use a specific endpoint I know works.
    
    throw new Error("Image editing is currently only supported on Gemini and Replicate providers.");
}


// --- Main Tool Logic ---

const tools = [
  {
    name: "generate_image_from_text",
    description: "Generate an image from a text description.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed description of the image." },
        output_path: { type: "string", description: "Path where the generated image will be saved." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "edit_image",
    description: "Edit an existing image based on your prompt.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Path to the image file." },
        prompt: { type: "string", description: "Instructions for editing." },
        output_path: { type: "string", description: "Path where the generated image will be saved." },
      },
      required: ["image_path", "prompt"],
    },
  },
];

async function generateImageFromText(prompt, outputPath = "output.png") {
  try {
    let imageBuffer;
    
    if (activeProvider === PROVIDERS.GEMINI) {
      imageBuffer = await generateImageGemini(prompt);
    } else if (activeProvider === PROVIDERS.REPLICATE) {
      imageBuffer = await generateImageReplicate(prompt);
    } else if (activeProvider === PROVIDERS.HUGGINGFACE) {
      imageBuffer = await generateImageHuggingFace(prompt);
    }

    const resolvedOutputPath = path.resolve(outputPath);
    fs.writeFileSync(resolvedOutputPath, imageBuffer);
    
    return {
      success: true,
      output_path: resolvedOutputPath,
      message: `Image generated successfully using ${activeProvider}`,
    };
  } catch (error) {
    console.error("Error generating image:", error.response ? error.response.data : error.message);
    throw error;
  }
}

async function editImage(imagePath, outputPath = "output.png", prompt) {
    try {
        const resolvedPath = path.resolve(imagePath);
        if (!fs.existsSync(resolvedPath)) throw new Error(`Image file not found: ${resolvedPath}`);
        
        const imageBuffer = fs.readFileSync(resolvedPath);
        const base64Image = imageBuffer.toString("base64");
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
        const mimeType = mimeTypes[ext] || "image/png";

        let resultBuffer;

        if (activeProvider === PROVIDERS.GEMINI) {
            resultBuffer = await editImageGemini(base64Image, mimeType, prompt);
        } else if (activeProvider === PROVIDERS.REPLICATE) {
            resultBuffer = await editImageReplicate(base64Image, mimeType, prompt);
        } else if (activeProvider === PROVIDERS.HUGGINGFACE) {
            resultBuffer = await editImageHuggingFace(base64Image, mimeType, prompt);
        }

        const resolvedOutputPath = path.resolve(outputPath);
        fs.writeFileSync(resolvedOutputPath, resultBuffer);

        return {
            success: true,
            output_path: resolvedOutputPath,
            message: `Image edited successfully using ${activeProvider}`,
        };
    } catch (error) {
        console.error("Error editing image:", error.response ? error.response.data : error.message);
        throw error;
    }
}

// --- MCP Server Boilerplate ---

async function processToolCall(toolName, toolInput) {
  if (toolName === "generate_image_from_text") {
    return await generateImageFromText(toolInput.prompt, toolInput.output_path);
  }
  if (toolName === "edit_image") {
    return await editImage(toolInput.image_path, toolInput.output_path, toolInput.prompt);
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
            capabilities: {},
            serverInfo: { name: "image-generation-server", version: "1.0.0" },
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
