import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file if it exists
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  });
}

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;

// Validate Replicate API key
if (!REPLICATE_API_TOKEN) {
  console.error("Error: REPLICATE_API_TOKEN or REPLICATE_API_KEY environment variable is not set.");
  process.exit(1);
}

const OUTPUT_DIR = path.join(__dirname, "test-output-mesh");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

let modelVersion = null;

async function getModelVersion() {
  if (modelVersion) return modelVersion;

  try {
    const url = "https://api.replicate.com/v1/models/cjwbw/shap-e";
    const response = await axios.get(url, {
      headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` },
    });

    if (response.data && response.data.latest_version && response.data.latest_version.id) {
      modelVersion = response.data.latest_version.id;
      return modelVersion;
    }
  } catch (error) {
    console.error("Error fetching Shap-E model version:", error.message);
  }

  modelVersion = "0d348e32f723509b8cd6d20be8c774a2fb6cfe6f442fed892005e327a6f06649";
  return modelVersion;
}

async function generateMeshReplicate(prompt, params = {}) {
  console.log(`\n[GENERATE] Creating 3D mesh with prompt: "${prompt}"`);

  const version = await getModelVersion();
  console.log(`[GENERATE] Using Shap-E version: ${version}`);

  const url = "https://api.replicate.com/v1/predictions";

  const input = {
    prompt,
    guidance_scale: params.guidance_scale ?? 15,
    batch_size: params.batch_size ?? 1,
    render_mode: params.render_mode ?? "nerf",
    render_size: params.render_size ?? 128,
    save_mesh: params.save_mesh !== undefined ? params.save_mesh : true,
  };

  try {
    const response = await axios.post(
      url,
      { version, input },
      {
        headers: {
          "Authorization": `Token ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          "Prefer": "wait",
        },
        timeout: 600000,
      }
    );

    let prediction = response.data;
    console.log(`[GENERATE] Prediction ID: ${prediction.id}`);

    let attempts = 0;
    const maxAttempts = 180;

    while (prediction.status !== "succeeded" && prediction.status !== "failed" && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;

      const statusUrl = prediction.urls.get;
      const statusResponse = await axios.get(statusUrl, {
        headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` },
      });
      prediction = statusResponse.data;
      console.log(`[GENERATE] Status: ${prediction.status} (attempt ${attempts}/${maxAttempts})`);
    }

    if (prediction.status === "failed") {
      throw new Error("Shap-E generation failed: " + prediction.error);
    }

    if (prediction.status !== "succeeded") {
      throw new Error(`Generation timeout after ${maxAttempts * 5} seconds`);
    }

    const output = prediction.output;
    console.log("[GENERATE] Raw output:", JSON.stringify(output, null, 2));
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

    console.log(`[GENERATE] Downloading mesh from: ${meshUrl}`);

    const meshResponse = await axios.get(meshUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(meshResponse.data);
    const contentType = meshResponse.headers["content-type"] || "";

    console.log(`[GENERATE] ✓ Mesh downloaded (${buffer.length} bytes, content-type: ${contentType})`);
    return { buffer, contentType, meshUrl };
  } catch (error) {
    console.error("[GENERATE] Error:", error.message);
    if (error.response) console.error(JSON.stringify(error.response.data, null, 2));
    throw error;
  }
}

async function runTest() {
  console.log("=".repeat(60));
  console.log("TEST: Generate 3D Mesh with Shap-E");
  console.log("Provider: Replicate");
  console.log("=".repeat(60));

  const prompt = "a low-poly fantasy sword on a stand";

  try {
    const { buffer, contentType, meshUrl } = await generateMeshReplicate(prompt, {});

    let extFromUrl = "";
    if (meshUrl) {
      const urlPath = meshUrl.split("?")[0];
      const dotIndex = urlPath.lastIndexOf(".");
      if (dotIndex !== -1) {
        extFromUrl = urlPath.slice(dotIndex);
      }
    }

    let ext = extFromUrl || ".bin";
    if (!extFromUrl) {
      if (contentType.includes("zip")) {
        ext = ".zip";
      } else if (contentType.includes("gltf")) {
        ext = ".glb";
      } else if (contentType.includes("obj")) {
        ext = ".obj";
      }
    }

    const outputPath = path.join(OUTPUT_DIR, `test_mesh${ext}`);
    fs.writeFileSync(outputPath, buffer);
    console.log(`[SAVE] Mesh saved to: ${outputPath}`);

    console.log("\n" + "=".repeat(60));
    console.log("TEST PASSED ✓");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("TEST FAILED ✗");
    console.error("=".repeat(60));
    console.error("Error:", error.message);
    process.exit(1);
  }
}

runTest();
