import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Anthropic();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Tool definitions
const tools = [
  {
    name: "generate_image_from_text",
    description:
      "Generate an image from a text description using Gemini API. Creates a new image based on your prompt.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed description of the image you want to generate. Be specific about style, colors, composition, etc.",
        },
        output_path: {
          type: "string",
          description:
            "Path where the generated image will be saved. If not provided, will use output.png",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_colored_image",
    description:
      "Generate a colored and enhanced version of an existing image. Takes an image file path and returns an improved, colored version.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description:
            "Path to the image file (PNG, JPG, JPEG, GIF, WebP). Can be absolute or relative path.",
        },
        output_path: {
          type: "string",
          description:
            "Path where the generated image will be saved. If not provided, will use output.png",
        },
        prompt: {
          type: "string",
          description:
            "Optional custom instructions for how to enhance the image. If not provided, will use default enhancement prompt.",
        },
      },
      required: ["image_path"],
    },
  },
];

async function generateImageFromText(prompt, outputPath = "output.png") {
  console.log(`Generating image from prompt: ${prompt.substring(0, 100)}...`);

  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\nReturn ONLY the base64 encoded image string of the result, with no markdown formatting or explanation.`,
          },
        ],
      },
    ],
  };

  try {
    console.log("Sending request to Gemini API...");
    const response = await axios.post(url, requestBody, {
      timeout: 60000,
    });

    if (!response.data.candidates || response.data.candidates.length === 0) {
      throw new Error("No candidates in Gemini API response");
    }

    const candidate = response.data.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      throw new Error("No content parts in Gemini API response");
    }

    const part = candidate.content.parts[0];

    if (part.inlineData && part.inlineData.data) {
      console.log("Received image data from Gemini API");
      const imageBytes = Buffer.from(part.inlineData.data, "base64");
      const resolvedOutputPath = path.resolve(outputPath);
      fs.writeFileSync(resolvedOutputPath, imageBytes);
      console.log(`Image saved to: ${resolvedOutputPath}`);
      return {
        success: true,
        output_path: resolvedOutputPath,
        message: "Image generated from text and saved successfully",
      };
    }

    if (part.text) {
      console.log("Received text response from Gemini API");
      const cleanText = part.text
        .replace(/```base64/g, "")
        .replace(/```/g, "")
        .trim();

      const imageBytes = Buffer.from(cleanText, "base64");
      const resolvedOutputPath = path.resolve(outputPath);
      fs.writeFileSync(resolvedOutputPath, imageBytes);
      console.log(`Image saved to: ${resolvedOutputPath}`);
      return {
        success: true,
        output_path: resolvedOutputPath,
        message: "Image generated from text and saved successfully",
      };
    }

    throw new Error("No image data in Gemini API response");
  } catch (error) {
    if (error.response) {
      console.error(
        `Gemini API error: ${error.response.status} - ${error.response.statusText}`
      );
      console.error("Response data:", error.response.data);
      throw new Error(
        `Gemini API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
      );
    }
    throw error;
  }
}

async function generateColoredImage(imagePath, outputPath = "output.png", customPrompt = null) {
  // Read image file
  const resolvedPath = path.resolve(imagePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Image file not found: ${resolvedPath}`);
  }

  const imageBuffer = fs.readFileSync(resolvedPath);
  const base64Image = imageBuffer.toString("base64");

  // Determine MIME type from file extension
  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const mimeType = mimeTypes[ext] || "image/png";

  console.log(`Processing image: ${imagePath}`);
  console.log(`MIME type: ${mimeType}`);

  // Call Gemini API
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = customPrompt || "Draw a colored and better version of this comic, with high quality graphics.";

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\nReturn ONLY the base64 encoded image string of the result, with no markdown formatting or explanation.`,
          },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image,
            },
          },
        ],
      },
    ],
  };

  try {
    console.log("Sending request to Gemini API...");
    const response = await axios.post(url, requestBody, {
      timeout: 60000, // 60 second timeout for image generation
    });

    if (!response.data.candidates || response.data.candidates.length === 0) {
      throw new Error("No candidates in Gemini API response");
    }

    const candidate = response.data.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      throw new Error("No content parts in Gemini API response");
    }

    const part = candidate.content.parts[0];

    // Check for inline data (image) first
    if (part.inlineData && part.inlineData.data) {
      console.log("Received image data from Gemini API");
      const imageBytes = Buffer.from(part.inlineData.data, "base64");
      const resolvedOutputPath = path.resolve(outputPath);
      fs.writeFileSync(resolvedOutputPath, imageBytes);
      console.log(`Image saved to: ${resolvedOutputPath}`);
      return {
        success: true,
        output_path: resolvedOutputPath,
        message: "Image enhanced and saved successfully",
      };
    }

    // Fallback to text response (base64 in text)
    if (part.text) {
      console.log("Received text response from Gemini API");
      const cleanText = part.text
        .replace(/```base64/g, "")
        .replace(/```/g, "")
        .trim();

      const imageBytes = Buffer.from(cleanText, "base64");
      const resolvedOutputPath = path.resolve(outputPath);
      fs.writeFileSync(resolvedOutputPath, imageBytes);
      console.log(`Image saved to: ${resolvedOutputPath}`);
      return {
        success: true,
        output_path: resolvedOutputPath,
        message: "Image enhanced and saved successfully",
      };
    }

    throw new Error("No image data or text content in Gemini API response");
  } catch (error) {
    if (error.response) {
      console.error(
        `Gemini API error: ${error.response.status} - ${error.response.statusText}`
      );
      console.error("Response data:", error.response.data);
      throw new Error(
        `Gemini API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
      );
    }
    throw error;
  }
}

async function processToolCall(toolName, toolInput) {
  console.log(`Processing tool: ${toolName}`);
  console.log("Input:", toolInput);

  if (toolName === "generate_image_from_text") {
    const result = await generateImageFromText(
      toolInput.prompt,
      toolInput.output_path
    );
    return result;
  }

  if (toolName === "generate_colored_image") {
    const result = await generateColoredImage(
      toolInput.image_path,
      toolInput.output_path,
      toolInput.prompt
    );
    return result;
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

async function main() {
  console.log("Starting Image Generation MCP Server...");
  console.log("Available tools:", tools.map((t) => t.name).join(", "));
  console.log("\nListening for MCP requests...\n");

  const messages = [];

  // Example: Read from stdin for server integration
  // For testing, you can also call this directly
  const testImagePath = process.argv[2];

  if (testImagePath) {
    console.log(`\n=== TEST MODE ===`);
    console.log(`Processing image: ${testImagePath}\n`);

    try {
      const result = await generateColoredImage(testImagePath);
      console.log("\n=== RESULT ===");
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  } else {
    console.log("Usage: node server.js <image_path>");
    console.log("Example: node server.js test.png\n");
    console.log("Or configure in your MCP client with:");
    console.log(`{
  "command": "node",
  "args": ["server.js"],
  "env": {
    "GEMINI_API_KEY": "your-api-key"
  }
}`);
  }
}

// Export for use as MCP server
export { tools, processToolCall };

// Run main if executed directly
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
