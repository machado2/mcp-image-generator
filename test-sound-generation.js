
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

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;

// Validate Replicate API key
if (!REPLICATE_API_TOKEN) {
  console.error("Error: REPLICATE_API_TOKEN or REPLICATE_API_KEY environment variable is not set.");
  process.exit(1);
}

// Test configuration
const OUTPUT_DIR = path.join(__dirname, "test-output-audio");

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// Model mappings (Must match server implementation or be fetched similarly)
const AUDIO_MODELS = {
    SFX: "sepal/audiogen",
    AMBIENT: "haoheliu/audio-ldm", 
    LOOP: "stability-ai/stable-audio-2.5"
};

// Cache for model versions (Mocking server behavior)
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
    
    // Fallback known hashes (Should match server)
    if (modelName === "sepal/audiogen") return "154b3e5141493cb1b8cec976d9aa90f2b691137e39ad906d2421b74c2a8c52b8"; 
    if (modelName === "haoheliu/audio-ldm") return "b61392adecdd660326fc9cfc5398182437dbe5e97b5decfb36e1a36de68b5b95"; 
    if (modelName === "stability-ai/stable-audio-2.5") return "a61ac8edbb27cd2eda1b2eff2bbc03dcff1131f5560836ff77a052df05b77491";

    throw new Error(`Could not determine version for model ${modelName}`);
}

async function generateSoundReplicate(prompt, type, duration = 3) {
    console.log(`\n[GENERATE] Creating ${type} with prompt: "${prompt}"`);

    let modelName;
    let input = { prompt, duration };

    if (type === "sfx") {
        modelName = AUDIO_MODELS.SFX;
    } else if (type === "ambient") {
        modelName = AUDIO_MODELS.AMBIENT;
        input = { 
            text: prompt, 
            duration: duration.toString(), 
            n_candidates: 1, 
            guidance_scale: 2.5
        };
    } else if (type === "loop") {
        modelName = AUDIO_MODELS.LOOP;
        input = {
            prompt,
            seconds_total: duration,
            steps: 20 // Lower steps for test speed if possible, though model might have minimums
        };
    } else {
        throw new Error("Invalid sound type");
    }

    const version = await getModelVersion(modelName);
    console.log(`[GENERATE] Using model ${modelName}:${version}`);

    const url = "https://api.replicate.com/v1/predictions";
    
    try {
        const response = await axios.post(url, {
            version: version,
            input: input
        }, {
            headers: {
                "Authorization": `Token ${REPLICATE_API_TOKEN}`,
                "Content-Type": "application/json",
                "Prefer": "wait"
            },
            timeout: 300000 // 5 minutes timeout
        });

        let prediction = response.data;
        console.log(`[GENERATE] Prediction ID: ${prediction.id}`);
        
        // Poll until completion
        let attempts = 0;
        const maxAttempts = 120; // 2-4 minutes
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
        
        // Download the generated audio
        let audioUrl = prediction.output;
        if (Array.isArray(audioUrl)) audioUrl = audioUrl[0];
        
        console.log(`[GENERATE] Downloading audio from: ${audioUrl}`);
        
        const audioResponse = await axios.get(audioUrl, { responseType: "arraybuffer" });
        const audioBuffer = Buffer.from(audioResponse.data);
        
        console.log(`[GENERATE] ✓ Sound generated successfully (${audioBuffer.length} bytes)`);
        return audioBuffer;

    } catch (error) {
        console.error("[GENERATE] Error:", error.message);
        if (error.response) console.error(JSON.stringify(error.response.data, null, 2));
        throw error;
    }
}

async function runTest() {
    console.log("=".repeat(60));
    console.log("TEST: Generate Sounds (SFX, Ambient, Loop)");
    console.log("Provider: Replicate");
    console.log("=".repeat(60));
    
    const tests = [
        // Short duration to save credits/time
        { type: "sfx", prompt: "coin drop on concrete", duration: 2 },
        // { type: "ambient", prompt: "wind blowing in a desert", duration: 3 }, // Commented out to save time/credits for now, verify SFX first
        // { type: "loop", prompt: "simple drum beat 120bpm", duration: 3 }
    ];

    // Running just one for now to verify the flow
    try {
        for (const test of tests) {
            const audioBuffer = await generateSoundReplicate(test.prompt, test.type, test.duration);
            const outputPath = path.join(OUTPUT_DIR, `test_${test.type}.wav`);
            fs.writeFileSync(outputPath, audioBuffer);
            console.log(`[SAVE] Saved to: ${outputPath}`);
        }

        console.log("\n" + "=".repeat(60));
        console.log("TEST PASSED ✓");
        console.log("=".repeat(60));
    } catch (error) {
        console.error("\n" + "=".repeat(60));
        console.error("TEST FAILED ✗");
        console.error("=".repeat(60));
        process.exit(1);
    }
}

runTest();
