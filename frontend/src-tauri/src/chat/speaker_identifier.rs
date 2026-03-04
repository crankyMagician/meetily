use crate::database::repositories::{
    setting::SettingsRepository, speaker::SpeakerRepository, transcript::TranscriptsRepository,
};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tracing::{error, info};

pub struct SpeakerIdentifier;

impl SpeakerIdentifier {
    /// Identifies speakers in system-audio transcript segments using LLM analysis.
    /// Saves suggestions to the meeting_speakers table.
    pub async fn identify_speakers<R: tauri::Runtime>(
        app: &AppHandle<R>,
        pool: &SqlitePool,
        meeting_id: &str,
        model_provider: &str,
        model_name: &str,
    ) -> Result<Vec<SpeakerSuggestion>, String> {
        info!("Starting speaker identification for meeting: {}", meeting_id);

        // Get system-audio transcripts
        let transcripts = TranscriptsRepository::get_all_for_meeting(pool, meeting_id)
            .await
            .map_err(|e| format!("Failed to get transcripts: {}", e))?;

        let system_segments: Vec<_> = transcripts
            .iter()
            .enumerate()
            .filter(|(_, t)| t.speaker.as_deref() == Some("system"))
            .collect();

        if system_segments.is_empty() {
            info!("No system audio segments found for meeting {}", meeting_id);
            return Ok(vec![]);
        }

        // Build transcript text with segment indices
        let segment_text: String = system_segments
            .iter()
            .map(|(idx, t)| {
                let time = t.audio_start_time.map(|s| {
                    let mins = (s / 60.0) as u32;
                    let secs = (s % 60.0) as u32;
                    format!("[{:02}:{:02}]", mins, secs)
                }).unwrap_or_else(|| format!("[{}]", t.timestamp));
                format!("Segment {}: {} {}", idx, time, t.transcript)
            })
            .collect::<Vec<_>>()
            .join("\n");

        // Truncate if too long
        let max_chars = 50_000;
        let segment_text = if segment_text.len() > max_chars {
            format!("{}\n[Truncated]", &segment_text[..max_chars])
        } else {
            segment_text
        };

        let system_prompt = r#"You are a speaker identification assistant. Analyze the following transcript segments from system audio (remote participants in a meeting). Try to identify distinct speakers based on context clues like introductions, role references, conversational patterns, or name mentions.

Return ONLY valid JSON in this exact format (no markdown fencing):
{
  "speakers": [
    {
      "suggested_name": "Name or description",
      "confidence": "high|medium|low",
      "reasoning": "Brief explanation of why you identified this speaker"
    }
  ]
}

If you cannot identify any specific speakers, return: {"speakers": [{"suggested_name": "Participant", "confidence": "low", "reasoning": "No identifying information found"}]}"#;

        let user_prompt = format!(
            "Identify the speakers in these system audio segments:\n\n{}",
            segment_text
        );

        // Parse provider and get credentials
        let provider = LLMProvider::from_str(model_provider)?;

        let api_key = if provider == LLMProvider::Ollama
            || provider == LLMProvider::BuiltInAI
            || provider == LLMProvider::CustomOpenAI
        {
            String::new()
        } else {
            SettingsRepository::get_api_key(pool, model_provider)
                .await
                .map_err(|e| format!("Failed to get API key: {}", e))?
                .ok_or_else(|| format!("API key not found for {}", model_provider))?
        };

        let ollama_endpoint = if provider == LLMProvider::Ollama {
            SettingsRepository::get_model_config(pool)
                .await
                .ok()
                .flatten()
                .and_then(|c| c.ollama_endpoint)
        } else {
            None
        };

        let (custom_endpoint, custom_api_key, custom_max_tokens, custom_temp, custom_top_p) =
            if provider == LLMProvider::CustomOpenAI {
                match SettingsRepository::get_custom_openai_config(pool).await {
                    Ok(Some(config)) => (
                        Some(config.endpoint),
                        config.api_key,
                        config.max_tokens.map(|t| t as u32),
                        config.temperature,
                        config.top_p,
                    ),
                    _ => return Err("Custom OpenAI config not found".to_string()),
                }
            } else {
                (None, None, None, None, None)
            };

        let final_api_key = if provider == LLMProvider::CustomOpenAI {
            custom_api_key.unwrap_or_default()
        } else {
            api_key
        };

        let app_data_dir = app.path().app_data_dir().ok();

        let client = reqwest::Client::new();
        let response = generate_summary(
            &client,
            &provider,
            model_name,
            &final_api_key,
            system_prompt,
            &user_prompt,
            ollama_endpoint.as_deref(),
            custom_endpoint.as_deref(),
            custom_max_tokens,
            custom_temp,
            custom_top_p,
            app_data_dir.as_ref(),
            None,
        )
        .await?;

        // Parse response
        let suggestions = parse_speaker_suggestions(&response);

        // Save to database
        for (i, suggestion) in suggestions.iter().enumerate() {
            let speaker_key = if suggestions.len() == 1 {
                "system".to_string()
            } else {
                format!("system_speaker_{}", i + 1)
            };

            if let Err(e) = SpeakerRepository::set_speaker_name(
                pool,
                meeting_id,
                &speaker_key,
                &suggestion.suggested_name,
                "llm",
            )
            .await
            {
                error!("Failed to save speaker suggestion: {}", e);
            }
        }

        info!(
            "Speaker identification complete for meeting {}: {} speakers found",
            meeting_id,
            suggestions.len()
        );

        Ok(suggestions)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpeakerSuggestion {
    pub suggested_name: String,
    pub confidence: String,
    pub reasoning: String,
}

fn parse_speaker_suggestions(response: &str) -> Vec<SpeakerSuggestion> {
    // Try to parse as JSON directly
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(response) {
        return extract_suggestions(&value);
    }

    // Try to extract JSON from response
    if let Some(start) = response.find('{') {
        if let Some(end) = response.rfind('}') {
            let json_str = &response[start..=end];
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str) {
                return extract_suggestions(&value);
            }
        }
    }

    // Fallback
    vec![SpeakerSuggestion {
        suggested_name: "Participant".to_string(),
        confidence: "low".to_string(),
        reasoning: "Could not parse LLM response".to_string(),
    }]
}

fn extract_suggestions(value: &serde_json::Value) -> Vec<SpeakerSuggestion> {
    if let Some(speakers) = value.get("speakers").and_then(|s| s.as_array()) {
        speakers
            .iter()
            .filter_map(|s| {
                Some(SpeakerSuggestion {
                    suggested_name: s.get("suggested_name")?.as_str()?.to_string(),
                    confidence: s
                        .get("confidence")
                        .and_then(|c| c.as_str())
                        .unwrap_or("low")
                        .to_string(),
                    reasoning: s
                        .get("reasoning")
                        .and_then(|r| r.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
            })
            .collect()
    } else {
        vec![SpeakerSuggestion {
            suggested_name: "Participant".to_string(),
            confidence: "low".to_string(),
            reasoning: "No speakers array in response".to_string(),
        }]
    }
}
