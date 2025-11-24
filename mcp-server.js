#!/usr/bin/env node

import axios from "axios";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

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

let geminiClient = null;
if (GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

async function generateImageGemini(prompt, options = {}) {
  if (!geminiClient) throw new Error("Gemini API Key not initialized");

  const config = {
      responseModalities: ["IMAGE"], 
  };
  
  if (options.aspectRatio || options.resolution) {
      config.imageConfig = {};
      if (options.aspectRatio) config.imageConfig.aspectRatio = options.aspectRatio;
      if (options.resolution) config.imageConfig.imageSize = options.resolution;
  }
  
  if (options.numberOfImages) {
       config.candidateCount = options.numberOfImages;
  }

  try {
    const response = await geminiClient.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: config
    });
    
    if (!response.candidates || response.candidates.length === 0) {
        throw new Error("No candidates in Gemini API response");
    }
    
    const images = [];
    for (const candidate of response.candidates) {
        const part = candidate.content.parts[0];
        if (part.inlineData && part.inlineData.data) {
            images.push(Buffer.from(part.inlineData.data, "base64"));
        } else if (part.text) {
             // Clean up potential markdown
             const cleanText = part.text.replace(/```base64/g, "").replace(/```/g, "").trim();
             if (/^[A-Za-z0-9+/=]+$/.test(cleanText)) {
                  images.push(Buffer.from(cleanText, "base64"));
             }
        }
    }
    
    if (images.length === 0) {
         throw new Error("No image data in Gemini API response");
    }
    
    return images; 
  } catch (error) {
      console.error("Gemini Generation Error:", error);
      throw error;
  }
}

async function editImageGemini(base64Image, mimeType, prompt, options = {}) {
    if (!geminiClient) throw new Error("Gemini API Key not initialized");

     const config = {
        responseModalities: ["IMAGE"], 
    };
    
    if (options.aspectRatio || options.resolution) {
        config.imageConfig = {};
        if (options.aspectRatio) config.imageConfig.aspectRatio = options.aspectRatio;
        if (options.resolution) config.imageConfig.imageSize = options.resolution;
    }
    
    if (options.numberOfImages) {
        config.candidateCount = options.numberOfImages;
   }

    try {
        const response = await geminiClient.models.generateContent({
            model: GEMINI_MODEL,
            contents: [
                { text: prompt },
                { inlineData: { mimeType: mimeType, data: base64Image } }
            ],
            config: config
        });
        
        const images = [];
        for (const candidate of response.candidates) {
            const part = candidate.content.parts[0];
            if (part.inlineData && part.inlineData.data) {
                images.push(Buffer.from(part.inlineData.data, "base64"));
            } else if (part.text) {
                 const cleanText = part.text.replace(/```base64/g, "").replace(/```/g, "").trim();
                 if (/^[A-Za-z0-9+/=]+$/.test(cleanText)) {
                      images.push(Buffer.from(cleanText, "base64"));
                 }
            }
        }
        
        if (images.length === 0) {
             throw new Error("No image data in Gemini API response");
        }
        
        return images;
    } catch (error) {
        console.error("Gemini Edit Error:", error);
        throw error;
    }
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
    
    const imageUrl = prediction.output; 
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    return Buffer.from(imageResponse.data);
}

async function removeBackgroundReplicate(base64Image, mimeType) {
  // Using 851-labs/background-remover
  const version = "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";
  const url = "https://api.replicate.com/v1/predictions";
  
  const dataUri = `data:${mimeType};base64,${base64Image}`;

  const response = await axios.post(url, {
    version: version,
    input: {
      image: dataUri
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

  if (prediction.status === "failed") throw new Error("Replicate background removal failed: " + prediction.error);
  
  const imageUrl = prediction.output; 
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
    throw new Error("Image editing is currently only supported on Gemini and Replicate providers.");
}

async function removeBackgroundHuggingFace(imageBuffer) {
  // Using briaai/RMBG-2.0 Space
  const API_URL = "https://briaai-bria-rmbg-20.hf.space/run/predict";
  
  const formData = new FormData();
  formData.append("data", new Blob([imageBuffer]), "input.png");
  
  const resp = await fetch(API_URL, {
    method: "POST",
    body: formData,
  });
  
  const result = await resp.json();
  if (result.error) {
      throw new Error("Hugging Face Space error: " + JSON.stringify(result.error));
  }

  // result.data[0] returns the base64 PNG data URL, we need to strip the prefix if present or just parse it.
  // Usually it is "data:image/png;base64,..." or just base64.
  // The user example says: const base64Data = result.data[0].split(",")[1];
  let base64Data = result.data[0];
  if (base64Data.includes(",")) {
      base64Data = base64Data.split(",")[1];
  }
  
  return Buffer.from(base64Data, "base64");
}


// --- Main Tool Logic ---

const tools = [
  {
    name: "generate_image_from_text",
    description: "Generate an image from a text description. Note: When using Gemini, it only supports specific resolutions and PNG format.",
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
    description: "Edit an existing image based on your prompt. Note: This tool ONLY alters the visual content of the image; it does NOT change the image format or dimensions.",
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
  {
    name: "remove_background",
    description: "Remove the background from an image.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Path to the image file." },
        output_path: { type: "string", description: "Path where the transparent image will be saved." },
      },
      required: ["image_path"],
    },
  },
  {
    name: "convert_image_format",
    description: "Convert an image to a different format (e.g., PNG, JPEG, WEBP, GIF, TIFF, AVIF).",
    inputSchema: {
        type: "object",
        properties: {
            source_path: { type: "string", description: "Path to the source image." },
            output_path: { type: "string", description: "Path where the converted image will be saved. If not provided, will save in the same directory with new extension." },
            format: { type: "string", description: "Target format (png, jpeg, jpg, webp, gif, tiff, avif)." }
        },
        required: ["source_path", "format"]
    }
  },
  {
    name: "resize_image",
    description: "Resize an image to specific dimensions.",
    inputSchema: {
        type: "object",
        properties: {
            source_path: { type: "string", description: "Path to the source image." },
            output_path: { type: "string", description: "Path where the resized image will be saved." },
            width: { type: "number", description: "Target width in pixels." },
            height: { type: "number", description: "Target height in pixels. Optional if preserving aspect ratio." },
            fit: { type: "string", description: "How the image should be resized to fit the dimensions (cover, contain, fill, inside, outside). Default is 'cover'." }
        },
        required: ["source_path", "width"]
    }
  },
  {
    name: "get_image_info",
    description: "Get metadata about an image (dimensions, format, etc.).",
    inputSchema: {
        type: "object",
        properties: {
            image_path: { type: "string", description: "Path to the image file." }
        },
        required: ["image_path"]
    }
  }
];

if (activeProvider === PROVIDERS.GEMINI) {
    // Enhance generate_image_from_text with Gemini params
    const genTool = tools.find(t => t.name === "generate_image_from_text");
    genTool.description += " Supports advanced parameters like aspectRatio and resolution.";
    genTool.inputSchema.properties.aspectRatio = { 
        type: "string", 
        description: "Aspect ratio of the image (e.g., '1:1', '3:4', '4:3', '9:16', '16:9')." 
    };
    genTool.inputSchema.properties.resolution = { 
        type: "string", 
        description: "Resolution/Size of the image (e.g., '1K', '2K', '4K')." 
    };
    genTool.inputSchema.properties.numberOfImages = { 
        type: "number", 
        description: "Number of images to generate." 
    };

    // Enhance edit_image with Gemini params
    const editTool = tools.find(t => t.name === "edit_image");
    editTool.inputSchema.properties.aspectRatio = { 
        type: "string", 
        description: "Aspect ratio." 
    };
    editTool.inputSchema.properties.resolution = { 
        type: "string", 
        description: "Resolution/Size." 
    };
    editTool.inputSchema.properties.numberOfImages = { 
        type: "number", 
        description: "Number of images." 
    };
}

async function generateImageFromText(prompt, outputPath = "output.png", options = {}) {
  try {
    let imageBuffers = [];
    
    if (activeProvider === PROVIDERS.GEMINI) {
      imageBuffers = await generateImageGemini(prompt, options);
    } else if (activeProvider === PROVIDERS.REPLICATE) {
      const buf = await generateImageReplicate(prompt);
      imageBuffers = [buf];
    } else if (activeProvider === PROVIDERS.HUGGINGFACE) {
      const buf = await generateImageHuggingFace(prompt);
      imageBuffers = [buf];
    }

    const results = [];
    const resolvedOutputPath = path.resolve(outputPath);
    const dir = path.dirname(resolvedOutputPath);
    const ext = path.extname(resolvedOutputPath);
    const name = path.basename(resolvedOutputPath, ext);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    imageBuffers.forEach((buf, index) => {
        let filePath;
        if (index === 0) {
            filePath = resolvedOutputPath;
        } else {
            filePath = path.join(dir, `${name}_${index + 1}${ext}`);
        }
        
        fs.writeFileSync(filePath, buf);
        results.push(filePath);
    });
    
    return {
      success: true,
      output_paths: results,
      message: `Image(s) generated successfully using ${activeProvider}`,
    };
  } catch (error) {
    console.error("Error generating image:", error.response ? error.response.data : error.message);
    throw error;
  }
}

async function editImage(imagePath, outputPath = "output.png", prompt, options = {}) {
    try {
        const resolvedPath = path.resolve(imagePath);
        if (!fs.existsSync(resolvedPath)) throw new Error(`Image file not found: ${resolvedPath}`);
        
        const imageBuffer = fs.readFileSync(resolvedPath);
        const base64Image = imageBuffer.toString("base64");
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
        const mimeType = mimeTypes[ext] || "image/png";

        let imageBuffers = [];

        if (activeProvider === PROVIDERS.GEMINI) {
            imageBuffers = await editImageGemini(base64Image, mimeType, prompt, options);
        } else if (activeProvider === PROVIDERS.REPLICATE) {
            const buf = await editImageReplicate(base64Image, mimeType, prompt);
            imageBuffers = [buf];
        } else if (activeProvider === PROVIDERS.HUGGINGFACE) {
            const buf = await editImageHuggingFace(base64Image, mimeType, prompt);
            imageBuffers = [buf];
        }

        const results = [];
        const resolvedOutputPath = path.resolve(outputPath);
        const dir = path.dirname(resolvedOutputPath);
        const extOutput = path.extname(resolvedOutputPath);
        const name = path.basename(resolvedOutputPath, extOutput);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        imageBuffers.forEach((buf, index) => {
            let filePath;
            if (index === 0) {
                filePath = resolvedOutputPath;
            } else {
                filePath = path.join(dir, `${name}_${index + 1}${extOutput}`);
            }
            
            fs.writeFileSync(filePath, buf);
            results.push(filePath);
        });

        return {
            success: true,
            output_paths: results,
            message: `Image(s) edited successfully using ${activeProvider}`,
        };
    } catch (error) {
        console.error("Error editing image:", error.response ? error.response.data : error.message);
        throw error;
    }
}

async function removeBackground(imagePath, outputPath) {
    try {
        const resolvedPath = path.resolve(imagePath);
        if (!fs.existsSync(resolvedPath)) throw new Error(`Image file not found: ${resolvedPath}`);
        
        const imageBuffer = fs.readFileSync(resolvedPath);
        const base64Image = imageBuffer.toString("base64");
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
        const mimeType = mimeTypes[ext] || "image/png";

        let imageBufferResult = null;
        let usedProvider = "";

        // Priority: Replicate > Hugging Face
        if (REPLICATE_API_TOKEN) {
            try {
                console.error("[System] Attempting background removal with Replicate...");
                imageBufferResult = await removeBackgroundReplicate(base64Image, mimeType);
                usedProvider = "Replicate";
            } catch (err) {
                console.error("Replicate background removal failed, falling back if possible:", err.message);
            }
        }
        
        if (!imageBufferResult) {
            // Fallback to Hugging Face (Space doesn't necessarily need token, or we can use the Space implementation)
             console.error("[System] Attempting background removal with Hugging Face Space...");
             imageBufferResult = await removeBackgroundHuggingFace(imageBuffer);
             usedProvider = "Hugging Face";
        }

        if (!imageBufferResult) {
            throw new Error("Background removal failed with all available providers.");
        }

        // Determine output path
        if (!outputPath) {
             const dir = path.dirname(resolvedPath);
             const name = path.basename(resolvedPath, ext);
             outputPath = path.join(dir, `${name}_nobg.png`);
        }

        const resolvedOutputPath = path.resolve(outputPath);
        const dirOutput = path.dirname(resolvedOutputPath);
        if (!fs.existsSync(dirOutput)) {
            fs.mkdirSync(dirOutput, { recursive: true });
        }

        fs.writeFileSync(resolvedOutputPath, imageBufferResult);

        return {
            success: true,
            output_paths: [resolvedOutputPath],
            message: `Background removed successfully using ${usedProvider}`,
        };

    } catch (error) {
        console.error("Error removing background:", error.message);
        throw error;
    }
}

// --- New Tools Implementation (Sharp) ---

async function convertImage(sourcePath, outputPath, format) {
    try {
        const resolvedSourcePath = path.resolve(sourcePath);
        if (!fs.existsSync(resolvedSourcePath)) throw new Error(`Source image not found: ${resolvedSourcePath}`);

        // Normalize format
        format = format.toLowerCase().replace('.', '');
        if (format === 'jpg') format = 'jpeg';
        
        const validFormats = ['png', 'jpeg', 'webp', 'gif', 'tiff', 'avif', 'heif'];
        if (!validFormats.includes(format)) throw new Error(`Unsupported format: ${format}`);

        // Determine output path if not provided
        if (!outputPath) {
            const dir = path.dirname(resolvedSourcePath);
            const name = path.basename(resolvedSourcePath, path.extname(resolvedSourcePath));
            outputPath = path.join(dir, `${name}.${format}`);
        }
        
        const resolvedOutputPath = path.resolve(outputPath);
        const dirOutput = path.dirname(resolvedOutputPath);
        if (!fs.existsSync(dirOutput)) {
            fs.mkdirSync(dirOutput, { recursive: true });
        }

        await sharp(resolvedSourcePath)
            .toFormat(format)
            .toFile(resolvedOutputPath);

        return {
            success: true,
            output_path: resolvedOutputPath,
            message: `Image converted to ${format} successfully.`
        };

    } catch (error) {
        console.error("Error converting image:", error.message);
        throw error;
    }
}

async function resizeImage(sourcePath, outputPath, width, height, fit = 'cover') {
    try {
        const resolvedSourcePath = path.resolve(sourcePath);
        if (!fs.existsSync(resolvedSourcePath)) throw new Error(`Source image not found: ${resolvedSourcePath}`);

        if (!outputPath) {
             const dir = path.dirname(resolvedSourcePath);
             const name = path.basename(resolvedSourcePath, path.extname(resolvedSourcePath));
             outputPath = path.join(dir, `${name}_resized${path.extname(resolvedSourcePath)}`);
        }

        const resolvedOutputPath = path.resolve(outputPath);
        const dirOutput = path.dirname(resolvedOutputPath);
        if (!fs.existsSync(dirOutput)) {
            fs.mkdirSync(dirOutput, { recursive: true });
        }

        await sharp(resolvedSourcePath)
            .resize({
                width: width,
                height: height,
                fit: fit
            })
            .toFile(resolvedOutputPath);

        return {
            success: true,
            output_path: resolvedOutputPath,
            message: `Image resized to ${width}x${height || 'auto'} successfully.`
        };

    } catch (error) {
        console.error("Error resizing image:", error.message);
        throw error;
    }
}

async function getImageInfo(imagePath) {
    try {
        const resolvedPath = path.resolve(imagePath);
        if (!fs.existsSync(resolvedPath)) throw new Error(`Image file not found: ${resolvedPath}`);

        const metadata = await sharp(resolvedPath).metadata();
        
        return {
            success: true,
            info: {
                format: metadata.format,
                width: metadata.width,
                height: metadata.height,
                channels: metadata.channels,
                size: fs.statSync(resolvedPath).size
            }
        };

    } catch (error) {
        console.error("Error getting image info:", error.message);
        throw error;
    }
}


// --- MCP Server Boilerplate ---

async function processToolCall(toolName, toolInput) {
  if (toolName === "generate_image_from_text") {
    return await generateImageFromText(toolInput.prompt, toolInput.output_path, {
        aspectRatio: toolInput.aspectRatio,
        resolution: toolInput.resolution,
        numberOfImages: toolInput.numberOfImages
    });
  }
  if (toolName === "edit_image") {
    return await editImage(toolInput.image_path, toolInput.output_path, toolInput.prompt, {
        aspectRatio: toolInput.aspectRatio,
        resolution: toolInput.resolution,
        numberOfImages: toolInput.numberOfImages
    });
  }
  if (toolName === "remove_background") {
    return await removeBackground(toolInput.image_path, toolInput.output_path);
  }
  if (toolName === "convert_image_format") {
      return await convertImage(toolInput.source_path, toolInput.output_path, toolInput.format);
  }
  if (toolName === "resize_image") {
      return await resizeImage(toolInput.source_path, toolInput.output_path, toolInput.width, toolInput.height, toolInput.fit);
  }
  if (toolName === "get_image_info") {
      return await getImageInfo(toolInput.image_path);
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
