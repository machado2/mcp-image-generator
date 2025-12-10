import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "mcp-server.js");
const OUTPUT_DIR = path.join(__dirname, "test-output-tools");

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const TEST_IMAGE_PATH = path.join(OUTPUT_DIR, "test_source.png");

// Helper to create a test image
async function createTestImage() {
    await sharp({
        create: {
            width: 100,
            height: 100,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 1 } // Red
        }
    })
    .png()
    .toFile(TEST_IMAGE_PATH);
    console.log("Created test image at", TEST_IMAGE_PATH);
}

function runMcpCommand(command, envOverride) {
    return new Promise((resolve, reject) => {
        const defaultEnv = { IMAGE_GENERATION_PROVIDER: "gemini", GEMINI_API_KEY: "dummy" };
        const proc = spawn("node", [SERVER_PATH], {
            env: { ...process.env, ...(envOverride || defaultEnv) }
        });

        let output = "";
        let errorOutput = "";

        proc.stdout.on("data", (data) => {
            output += data.toString();
            // Check if we got a response
            const lines = output.split("\n");
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.id === command.id) {
                        resolve(json);
                        proc.kill();
                    }
                } catch (e) {
                    // Partial line or non-json
                }
            }
        });

        proc.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });

        proc.on("close", (code) => {
            if (code !== 0 && !output) {
                reject(new Error(`Process exited with code ${code}: ${errorOutput}`));
            }
        });

        // Send initialize first, then the command
        const initMsg = { jsonrpc: "2.0", id: 0, method: "initialize", params: {} };
        proc.stdin.write(JSON.stringify(initMsg) + "\n");
        
        // Wait a bit then send command (or just send immediately, stream handles it)
        setTimeout(() => {
            proc.stdin.write(JSON.stringify(command) + "\n");
        }, 500);
    });
}

async function runTests() {
    await createTestImage();

    console.log("--- Testing get_image_info ---");
    try {
        const response = await runMcpCommand({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
                name: "get_image_info",
                arguments: {
                    image_path: TEST_IMAGE_PATH
                }
            }
        });
        
        if (response.error) {
            console.error("get_image_info failed:", response.error);
        } else {
            const result = JSON.parse(response.result.content[0].text);
            console.log("get_image_info result:", result);
            if (result.info.width === 100 && result.info.format === "png") {
                console.log("PASSED");
            } else {
                console.log("FAILED");
            }
        }
    } catch (e) {
        console.error("Test failed:", e);
    }

    console.log("\n--- Testing resize_image ---");
    const resizePath = path.join(OUTPUT_DIR, "resized.png");
    try {
        const response = await runMcpCommand({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
                name: "resize_image",
                arguments: {
                    source_path: TEST_IMAGE_PATH,
                    output_path: resizePath,
                    width: 50,
                    height: 50
                }
            }
        });
        
        if (response.error) {
            console.error("resize_image failed:", response.error);
        } else {
            const result = JSON.parse(response.result.content[0].text);
            console.log("resize_image result:", result);
            
            // Verify
            const meta = await sharp(resizePath).metadata();
            if (meta.width === 50) {
                console.log("PASSED");
            } else {
                console.log("FAILED: width is " + meta.width);
            }
        }
    } catch (e) {
        console.error("Test failed:", e);
    }

    console.log("\n--- Testing convert_image_format ---");
    const convertPath = path.join(OUTPUT_DIR, "converted.jpg");
    try {
        const response = await runMcpCommand({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
                name: "convert_image_format",
                arguments: {
                    source_path: TEST_IMAGE_PATH,
                    output_path: convertPath,
                    format: "jpg"
                }
            }
        });
        
        if (response.error) {
            console.error("convert_image_format failed:", response.error);
        } else {
            const result = JSON.parse(response.result.content[0].text);
            console.log("convert_image_format result:", result);
            
            // Verify
            const meta = await sharp(convertPath).metadata();
            if (meta.format === "jpeg") {
                console.log("PASSED");
            } else {
                console.log("FAILED: format is " + meta.format);
            }
        }
    } catch (e) {
        console.error("Test failed:", e);
    }

    console.log("\n--- Testing generate_image_from_text (Replicate Nano Banana Pro) ---");
    const genPath = path.join(OUTPUT_DIR, "agent_generated.png");
    try {
        const token = process.env.REPLICATE_API_TOKEN;
        if (!token) {
            console.log("SKIPPED: REPLICATE_API_TOKEN not set");
        } else {
            const response = await runMcpCommand({
                jsonrpc: "2.0",
                id: 4,
                method: "tools/call",
                params: {
                    name: "generate_image_from_text",
                    arguments: {
                        prompt: "photorealistic mountain lake at sunrise, golden light, mist, ultra-detailed landscape, crisp reflections, cinematic composition",
                        output_path: genPath
                    }
                }
            }, {
                IMAGE_GENERATION_MODE: "nano-banana-pro",
                IMAGE_GENERATION_PROVIDER: "replicate",
                REPLICATE_API_TOKEN: token
            });

            if (response.error) {
                console.error("generate_image_from_text failed:", response.error);
            } else {
                const result = JSON.parse(response.result.content[0].text);
                console.log("generate_image_from_text result:", result);
                const meta = await sharp(genPath).metadata();
                if (meta.width && meta.height) {
                    console.log("PASSED");
                } else {
                    console.log("FAILED: image metadata not found");
                }
            }
        }
    } catch (e) {
        console.error("Test failed:", e);
    }
}

runTests();
