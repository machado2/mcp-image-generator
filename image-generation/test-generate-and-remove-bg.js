import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file if it exists
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  });
}

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// Validate Replicate API key
if (!REPLICATE_API_TOKEN) {
  console.error("Error: REPLICATE_API_TOKEN environment variable is not set.");
  console.error("Please set REPLICATE_API_TOKEN in your .env file or as an environment variable.");
  process.exit(1);
}

// Test configuration
const TEST_PROMPT = "a cute golden retriever dog sitting in a meadow with flowers, professional photography";
const OUTPUT_DIR = path.join(__dirname, "test-output");

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

/**
 * Generate image using Replicate SDXL-Lightning
 */
async function generateImage(prompt) {
  console.log(`\n[GENERATE] Creating image with prompt: "${prompt}"`);
  
  const url = "https://api.replicate.com/v1/predictions";
  const version = "5599ed30703defd1d160a25a63321b4dec97101d98b4674bcc56e41f62f35637"; // SDXL-Lightning
  
  try {
    const response = await axios.post(url, {
      version: version,
      input: { prompt: prompt }
    }, {
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        "Prefer": "wait"
      },
      timeout: 120000
    });

    let prediction = response.data;
    console.log(`[GENERATE] Prediction ID: ${prediction.id}`);
    
    // Poll until completion
    let attempts = 0;
    const maxAttempts = 60;
    while (prediction.status !== "succeeded" && prediction.status !== "failed" && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
      
      const statusUrl = prediction.urls.get;
      const statusResponse = await axios.get(statusUrl, {
        headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
      });
      prediction = statusResponse.data;
      console.log(`[GENERATE] Status: ${prediction.status} (attempt ${attempts}/${maxAttempts})`);
    }

    if (prediction.status === "failed") {
      throw new Error("Replicate generation failed: " + prediction.error);
    }
    
    if (prediction.status !== "succeeded") {
      throw new Error(`Generation timeout after ${maxAttempts * 2} seconds`);
    }
    
    // Download the generated image
    const imageUrl = prediction.output[0];
    console.log(`[GENERATE] Downloading image from: ${imageUrl}`);
    
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const imageBuffer = Buffer.from(imageResponse.data);
    
    console.log(`[GENERATE] ✓ Image generated successfully (${imageBuffer.length} bytes)`);
    return {
      buffer: imageBuffer,
      mimeType: "image/png"
    };
  } catch (error) {
    console.error("[GENERATE] Error:", error.message);
    throw error;
  }
}

/**
 * Remove background from image using Replicate background-remover
 */
async function removeBackground(imageBuffer, mimeType) {
  console.log(`\n[REMOVE-BG] Removing background from image...`);
  console.log(`[REMOVE-BG] Image size: ${imageBuffer.length} bytes`);
  
  const base64Image = imageBuffer.toString("base64");
  const dataUri = `data:${mimeType};base64,${base64Image}`;
  
  const url = "https://api.replicate.com/v1/predictions";
  // Using 851-labs/background-remover (updated to latest version)
  const version = "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";
  
  try {
    console.log(`[REMOVE-BG] Sending request with version: ${version}`);
    const response = await axios.post(url, {
      version: version,
      input: {
        image: `data:${mimeType};base64,${base64Image}`
      }
    }, {
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        "Prefer": "wait"
      },
      timeout: 120000,
      validateStatus: () => true // Don't throw on any status code
    });

    if (response.status !== 200 && response.status !== 201) {
      console.error(`[REMOVE-BG] API Error ${response.status}:`, JSON.stringify(response.data, null, 2));
      throw new Error(`API returned status ${response.status}: ${response.data.detail || response.data.error || JSON.stringify(response.data)}`);
    }

    let prediction = response.data;
    console.log(`[REMOVE-BG] Prediction ID: ${prediction.id}`);
    
    // Poll until completion
    let attempts = 0;
    const maxAttempts = 60;
    while (prediction.status !== "succeeded" && prediction.status !== "failed" && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
      
      const statusUrl = prediction.urls.get;
      const statusResponse = await axios.get(statusUrl, {
        headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
      });
      prediction = statusResponse.data;
      console.log(`[REMOVE-BG] Status: ${prediction.status} (attempt ${attempts}/${maxAttempts})`);
    }

    if (prediction.status === "failed") {
      throw new Error("Replicate background removal failed: " + prediction.error);
    }
    
    if (prediction.status !== "succeeded") {
      throw new Error(`Background removal timeout after ${maxAttempts * 2} seconds`);
    }
    
    // Download the processed image
    const imageUrl = prediction.output;
    console.log(`[REMOVE-BG] Downloading image from: ${imageUrl}`);
    
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const resultBuffer = Buffer.from(imageResponse.data);
    
    console.log(`[REMOVE-BG] ✓ Background removed successfully (${resultBuffer.length} bytes)`);
    return resultBuffer;
  } catch (error) {
    console.error("[REMOVE-BG] Error:", error.message);
    throw error;
  }
}

/**
 * Main test function
 */
async function runTest() {
  console.log("=".repeat(60));
  console.log("TEST: Generate Image and Remove Background");
  console.log("Provider: Replicate");
  console.log("=".repeat(60));
  
  try {
    // Step 1: Generate image
    const generatedImage = await generateImage(TEST_PROMPT);
    
    // Save generated image
    const generatedPath = path.join(OUTPUT_DIR, "test_generated.png");
    fs.writeFileSync(generatedPath, generatedImage.buffer);
    console.log(`[SAVE] Generated image saved to: ${generatedPath}`);
    
    // Step 2: Remove background
    const editedImage = await removeBackground(generatedImage.buffer, generatedImage.mimeType);
    
    // Save edited image
    const editedPath = path.join(OUTPUT_DIR, "test_background_removed.png");
    fs.writeFileSync(editedPath, editedImage);
    console.log(`[SAVE] Background-removed image saved to: ${editedPath}`);
    
    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("TEST PASSED ✓");
    console.log("=".repeat(60));
    console.log(`Generated image: ${generatedPath}`);
    console.log(`Edited image: ${editedPath}`);
    console.log("\nTest completed successfully!");
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("TEST FAILED ✗");
    console.error("=".repeat(60));
    console.error("Error:", error.message);
    process.exit(1);
  }
}

// Run the test
runTest();
