use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use base64::{Engine as _, engine::general_purpose};

#[derive(Debug)]
pub enum GeminiClientError {
    RequestError(reqwest::Error),
    ResponseError(String),
    DecodeError(String),
    MissingResponse,
}

impl std::fmt::Display for GeminiClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GeminiClientError::RequestError(e) => write!(f, "Request error: {}", e),
            GeminiClientError::ResponseError(e) => write!(f, "Response error: {}", e),
            GeminiClientError::DecodeError(e) => write!(f, "Decode error: {}", e),
            GeminiClientError::MissingResponse => write!(f, "Missing response from Gemini"),
        }
    }
}

impl std::error::Error for GeminiClientError {}

impl From<reqwest::Error> for GeminiClientError {
    fn from(error: reqwest::Error) -> Self {
        GeminiClientError::RequestError(error)
    }
}

pub struct GeminiClient {
    client: Client,
    api_key: String,
}

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<Content>,
}

#[derive(Serialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Part {
    Text { text: String },
    InlineData { inline_data: InlineData },
}

#[derive(Serialize, Deserialize)]
struct InlineData {
    #[serde(alias = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Deserialize)]
struct Candidate {
    content: Option<ResponseContent>,
}

#[derive(Deserialize)]
struct ResponseContent {
    parts: Option<Vec<ResponsePart>>,
}

#[derive(Deserialize)]
struct ResponsePart {
    text: Option<String>,
    #[serde(alias = "inlineData")]
    inline_data: Option<InlineData>,
}

impl GeminiClient {
    pub fn new() -> Self {
        let api_key = env::var("GEMINI_API_KEY").expect("GEMINI_API_KEY must be set");
        Self {
            client: Client::new(),
            api_key,
        }
    }

    pub async fn generate_colored_image(&self, image_data: &[u8]) -> Result<Vec<u8>, GeminiClientError> {
        // Note: The user requested "nano banana pro" model.
        // Since Gemini API doesn't return an image directly but text/multimodal response,
        // and the prompt is "draw a colored... version", we are assuming the model
        // might return a base64 string or we are using a hypothetical image generation endpoint.
        // However, standard Gemini Vision models (like gemini-1.5-flash) are text-to-text/image-to-text.
        // If this were a real image generation task, we'd use Imagen or similar.
        // Given the constraints and the specific model name "nano banana pro", 
        // I will implement this as if calling a standard Gemini endpoint but expecting
        // the model to potentially return a description or if it was an image gen model, a url/base64.
        //
        // BUT, the requirement says "generate a colored version... and serves it".
        // Current public Gemini API (v1beta) is primarily for text/chat.
        // For the sake of this exercise and the specific "nano banana pro" instruction,
        // I will construct the request to a hypothetical endpoint or the standard one
        // and assume the response contains the image data (or we mock it if it's a placeholder).
        //
        // Let's assume we are using the `gemini-1.5-flash` (mapped from "nano banana pro" as discussed in thought process, 
        // but user said USE "nano banana pro" LITERALLY).
        //
        // IMPORTANT: The standard Gemini API does NOT generate images from images yet (it analyzes images).
        // However, to fulfill the "generate a colored version" requirement with "Gemini",
        // we might be in a hypothetical scenario or using a specific Google Cloud Vertex AI Imagen endpoint.
        //
        // I will implement a standard call structure. If the API returns text, we might have to fail or mock.
        // For a robust app, I'll assume the API returns a base64 string of the image in the text response
        // if we prompt it correctly, OR this is a placeholder for a real image gen API.
        
        // "Nano Banana Pro" is the codename for "Gemini 3 Pro Image"
        // The API identifier includes the -preview suffix during the preview phase
        let model = "gemini-3-pro-image-preview";
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, self.api_key
        );

        let base64_image = general_purpose::STANDARD.encode(image_data);

        let request_body = GeminiRequest {
            contents: vec![Content {
                parts: vec![
                    Part::Text {
                        text: "draw a colored and better version of this comic, with high quality graphics. Return ONLY the base64 encoded image string of the result, with no markdown formatting.".to_string(),
                    },
                    Part::InlineData {
                        inline_data: InlineData {
                            mime_type: "image/png".to_string(),
                            data: base64_image,
                        },
                    },
                ],
            }],
        };

        let resp = self.client.post(&url).json(&request_body).send().await
            .map_err(GeminiClientError::from)?;
        
        if !resp.status().is_success() {
            let status = resp.status();
            let error_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            log::error!("Gemini API Error: Status: {}, Body: {}", status, error_text);
             return Err(GeminiClientError::ResponseError(
                  format!("Gemini API error: {} - {}", status, error_text).to_string()));
        }

        let resp_text = resp.text().await.map_err(GeminiClientError::from)?;
        log::debug!("Gemini API Response received (length: {})", resp_text.len());

        let gemini_resp: GeminiResponse = serde_json::from_str(&resp_text)
            .map_err(|e| GeminiClientError::DecodeError(format!("Failed to parse JSON: {}", e)))?;

        // Extract text which we hope contains base64 image
        if let Some(candidates) = gemini_resp.candidates {
            if let Some(first) = candidates.first() {
                if let Some(content) = &first.content {
                    if let Some(parts) = &content.parts {
                        if let Some(first_part) = parts.first() {
                            // Check for inline data (image) first
                            if let Some(inline_data) = &first_part.inline_data {
                                let image_bytes = general_purpose::STANDARD.decode(&inline_data.data);
                                match image_bytes {
                                    Ok(bytes) => return Ok(bytes),
                                    Err(e) => {
                                        return Err(GeminiClientError::DecodeError(
                                            format!("Failed to decode base64 image from inlineData: {}", e).to_string()));
                                    }
                                }
                            }
                            // Fallback to text if inline data is missing (though unlikely for image gen model)
                            if let Some(text) = &first_part.text {
                                // Clean up potential markdown code blocks if present
                                let clean_text = text.replace("```base64", "").replace("```", "").trim().to_string();
                                // Decode base64 to bytes
                                let image_bytes = general_purpose::STANDARD.decode(&clean_text);
                                match image_bytes {
                                    Ok(bytes) => return Ok(bytes),
                                    Err(e) => {
                                        return Err(GeminiClientError::DecodeError(
                                            format!("Failed to decode base64 image from text: {}", e).to_string()));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Err(GeminiClientError::MissingResponse)
    }
}