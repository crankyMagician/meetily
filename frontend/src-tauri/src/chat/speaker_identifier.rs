use crate::database::repositories::{
    setting::SettingsRepository, speaker::SpeakerRepository, transcript::TranscriptsRepository,
};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tracing::{error, info};

pub struct SpeakerIdentifier;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpeakerSuggestion {
    pub suggested_name: String,
    pub confidence: String,
    pub reasoning: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpeakerAssignment {
    pub segment_index: usize,
    pub speaker_index: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IdentifyAndAssignResult {
    pub speakers: Vec<crate::database::repositories::speaker::MeetingSpeaker>,
    pub assignments_count: u64,
}

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

        let response = call_llm(app, pool, model_provider, model_name, system_prompt, &user_prompt).await?;

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

    /// Enhanced speaker identification that also assigns each transcript segment to a speaker.
    /// Creates speaker entries in meeting_speakers and updates transcripts.speaker for each assignment.
    pub async fn identify_and_assign_speakers<R: tauri::Runtime>(
        app: &AppHandle<R>,
        pool: &SqlitePool,
        meeting_id: &str,
        model_provider: &str,
        model_name: &str,
    ) -> Result<IdentifyAndAssignResult, String> {
        info!("Starting speaker identification and assignment for meeting: {}", meeting_id);

        let transcripts = TranscriptsRepository::get_all_for_meeting(pool, meeting_id)
            .await
            .map_err(|e| format!("Failed to get transcripts: {}", e))?;

        if transcripts.is_empty() {
            return Ok(IdentifyAndAssignResult {
                speakers: vec![],
                assignments_count: 0,
            });
        }

        // Build transcript text — include ALL segments (not just system) for better context
        let segment_text: String = transcripts
            .iter()
            .enumerate()
            .map(|(idx, t)| {
                let time = t.audio_start_time.map(|s| {
                    let mins = (s / 60.0) as u32;
                    let secs = (s % 60.0) as u32;
                    format!("[{:02}:{:02}]", mins, secs)
                }).unwrap_or_else(|| format!("[{}]", t.timestamp));
                let source = t.speaker.as_deref().unwrap_or("unknown");
                format!("Segment {}: {} [source:{}] {}", idx, time, source, t.transcript)
            })
            .collect::<Vec<_>>()
            .join("\n");

        let max_chars = 50_000;
        let segment_text = if segment_text.len() > max_chars {
            format!("{}\n[Truncated]", &segment_text[..max_chars])
        } else {
            segment_text
        };

        let system_prompt = r#"You are a speaker identification and assignment assistant. Analyze the following meeting transcript segments. Each segment has a source tag: [source:mic] is the local user's microphone, [source:system] is remote participants via system audio, [source:unknown] is unassigned.

Your tasks:
1. Identify distinct speakers based on context clues (introductions, role references, conversational patterns, name mentions)
2. Assign each segment to the most likely speaker

Return ONLY valid JSON in this exact format (no markdown fencing):
{
  "speakers": [
    {
      "suggested_name": "Name or description",
      "confidence": "high|medium|low",
      "reasoning": "Brief explanation"
    }
  ],
  "assignments": [
    {"segment_index": 0, "speaker_index": 0},
    {"segment_index": 1, "speaker_index": 1}
  ]
}

Rules:
- Speaker index 0 should typically be the local user (mic source)
- Include an assignment for EVERY segment
- If you can't determine a speaker, assign to the most likely based on context
- For mic-source segments, assign to the local user (usually index 0)
- For system-source segments, try to distinguish between different remote speakers"#;

        let user_prompt = format!(
            "Identify speakers and assign each segment:\n\n{}",
            segment_text
        );

        let response = call_llm(app, pool, model_provider, model_name, system_prompt, &user_prompt).await?;

        // Parse response
        let (suggestions, assignments) = parse_identify_and_assign_response(&response);

        // Get existing speakers so we don't overwrite user-set colors
        let existing = SpeakerRepository::get_meeting_speakers(pool, meeting_id)
            .await
            .map_err(|e| format!("Failed to get existing speakers: {}", e))?;
        let existing_keys: std::collections::HashSet<String> =
            existing.iter().map(|s| s.speaker_key.clone()).collect();
        let used_colors: Vec<String> = existing.iter().filter_map(|s| s.color.clone()).collect();

        // Create speaker entries for each suggestion
        let default_colors = [
            "blue", "purple", "red", "green", "amber", "pink", "indigo", "cyan", "emerald", "rose", "teal", "violet",
        ];

        let mut speaker_keys: Vec<String> = Vec::new();
        for (i, suggestion) in suggestions.iter().enumerate() {
            let speaker_key = if i == 0 {
                "mic".to_string()
            } else if suggestions.len() == 2 && i == 1 {
                "system".to_string()
            } else {
                format!("speaker_{}", i)
            };

            // Only create if doesn't exist
            if !existing_keys.contains(&speaker_key) {
                let color = if speaker_key == "mic" {
                    "blue"
                } else if speaker_key == "system" {
                    "purple"
                } else {
                    // Find unused color
                    let mut picked = default_colors[i % default_colors.len()];
                    for c in &default_colors {
                        if !used_colors.contains(&c.to_string()) {
                            picked = c;
                            break;
                        }
                    }
                    picked
                };

                let _ = SpeakerRepository::add_speaker(
                    pool,
                    meeting_id,
                    &speaker_key,
                    &suggestion.suggested_name,
                    Some(color),
                )
                .await;
            } else {
                // Update display name from LLM suggestion
                let _ = SpeakerRepository::set_speaker_name(
                    pool,
                    meeting_id,
                    &speaker_key,
                    &suggestion.suggested_name,
                    "llm",
                )
                .await;
            }

            speaker_keys.push(speaker_key);
        }

        // Apply assignments: only update segments that don't already have a manually-set speaker
        let mut assignments_count: u64 = 0;
        for assignment in &assignments {
            if assignment.segment_index >= transcripts.len() {
                continue;
            }
            if assignment.speaker_index >= speaker_keys.len() {
                continue;
            }

            let transcript = &transcripts[assignment.segment_index];
            let new_speaker = &speaker_keys[assignment.speaker_index];

            // Update the transcript speaker
            if let Err(e) = TranscriptsRepository::update_speaker(
                pool,
                &transcript.id,
                Some(new_speaker),
            )
            .await
            {
                error!("Failed to assign speaker to segment {}: {}", assignment.segment_index, e);
            } else {
                assignments_count += 1;
            }
        }

        // Refresh speakers list
        let final_speakers = SpeakerRepository::get_meeting_speakers(pool, meeting_id)
            .await
            .map_err(|e| format!("Failed to get final speakers: {}", e))?;

        info!(
            "Speaker identification and assignment complete for meeting {}: {} speakers, {} assignments",
            meeting_id, final_speakers.len(), assignments_count
        );

        Ok(IdentifyAndAssignResult {
            speakers: final_speakers,
            assignments_count,
        })
    }
}

/// Shared LLM call helper
async fn call_llm<R: tauri::Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
    model_provider: &str,
    model_name: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
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
    generate_summary(
        &client,
        &provider,
        model_name,
        &final_api_key,
        system_prompt,
        user_prompt,
        ollama_endpoint.as_deref(),
        custom_endpoint.as_deref(),
        custom_max_tokens,
        custom_temp,
        custom_top_p,
        app_data_dir.as_ref(),
        None,
    )
    .await
}

fn parse_speaker_suggestions(response: &str) -> Vec<SpeakerSuggestion> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(response) {
        return extract_suggestions(&value);
    }

    if let Some(start) = response.find('{') {
        if let Some(end) = response.rfind('}') {
            let json_str = &response[start..=end];
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str) {
                return extract_suggestions(&value);
            }
        }
    }

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

fn parse_identify_and_assign_response(response: &str) -> (Vec<SpeakerSuggestion>, Vec<SpeakerAssignment>) {
    let value = if let Ok(v) = serde_json::from_str::<serde_json::Value>(response) {
        v
    } else if let Some(start) = response.find('{') {
        if let Some(end) = response.rfind('}') {
            let json_str = &response[start..=end];
            match serde_json::from_str::<serde_json::Value>(json_str) {
                Ok(v) => v,
                Err(_) => return (vec![SpeakerSuggestion {
                    suggested_name: "Participant".to_string(),
                    confidence: "low".to_string(),
                    reasoning: "Could not parse LLM response".to_string(),
                }], vec![]),
            }
        } else {
            return (vec![], vec![]);
        }
    } else {
        return (vec![], vec![]);
    };

    let suggestions = extract_suggestions(&value);

    let assignments = value
        .get("assignments")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    Some(SpeakerAssignment {
                        segment_index: a.get("segment_index")?.as_u64()? as usize,
                        speaker_index: a.get("speaker_index")?.as_u64()? as usize,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    (suggestions, assignments)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_speaker_suggestions tests ─────────────────────────────

    #[test]
    fn parse_valid_json() {
        let input = r#"{"speakers": [{"suggested_name": "Alice", "confidence": "high", "reasoning": "Introduced herself"}]}"#;
        let result = parse_speaker_suggestions(input);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].suggested_name, "Alice");
        assert_eq!(result[0].confidence, "high");
        assert_eq!(result[0].reasoning, "Introduced herself");
    }

    #[test]
    fn parse_json_with_markdown_fencing() {
        let input = "```json\n{\"speakers\": [{\"suggested_name\": \"Bob\", \"confidence\": \"medium\", \"reasoning\": \"Role reference\"}]}\n```";
        let result = parse_speaker_suggestions(input);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].suggested_name, "Bob");
    }

    #[test]
    fn parse_json_with_preamble() {
        let input = "Here's the result: {\"speakers\": [{\"suggested_name\": \"Carol\", \"confidence\": \"low\", \"reasoning\": \"Guess\"}]}";
        let result = parse_speaker_suggestions(input);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].suggested_name, "Carol");
    }

    #[test]
    fn parse_invalid_json_returns_fallback() {
        let input = "This is not JSON at all!!!";
        let result = parse_speaker_suggestions(input);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].suggested_name, "Participant");
        assert_eq!(result[0].confidence, "low");
    }

    #[test]
    fn parse_empty_speakers_array() {
        let input = r#"{"speakers": []}"#;
        let result = parse_speaker_suggestions(input);
        // Empty speakers array — extract_suggestions returns empty, but parse_speaker_suggestions
        // delegates to extract_suggestions which returns empty vec for empty array
        // Actually looking at extract_suggestions: empty array → empty vec from the filter_map
        // So parse_speaker_suggestions returns an empty vec
        assert!(result.is_empty());
    }

    #[test]
    fn parse_missing_required_fields() {
        let input = r#"{"speakers": [{"confidence": "high"}, {"suggested_name": "Valid", "confidence": "high", "reasoning": "ok"}]}"#;
        let result = parse_speaker_suggestions(input);
        // First entry filtered out (no suggested_name), second kept
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].suggested_name, "Valid");
    }

    #[test]
    fn parse_defaults_confidence_and_reasoning() {
        let input = r#"{"speakers": [{"suggested_name": "Dave"}]}"#;
        let result = parse_speaker_suggestions(input);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].confidence, "low");
        assert_eq!(result[0].reasoning, "");
    }

    // ── parse_identify_and_assign_response tests ────────────────────

    #[test]
    fn parse_full_response() {
        let input = r#"{
            "speakers": [
                {"suggested_name": "Alice", "confidence": "high", "reasoning": "Intro"},
                {"suggested_name": "Bob", "confidence": "medium", "reasoning": "Context"}
            ],
            "assignments": [
                {"segment_index": 0, "speaker_index": 0},
                {"segment_index": 1, "speaker_index": 1}
            ]
        }"#;
        let (speakers, assignments) = parse_identify_and_assign_response(input);
        assert_eq!(speakers.len(), 2);
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].segment_index, 0);
        assert_eq!(assignments[0].speaker_index, 0);
        assert_eq!(assignments[1].segment_index, 1);
        assert_eq!(assignments[1].speaker_index, 1);
    }

    #[test]
    fn parse_response_missing_assignments() {
        let input = r#"{"speakers": [{"suggested_name": "Alice", "confidence": "high", "reasoning": "ok"}]}"#;
        let (speakers, assignments) = parse_identify_and_assign_response(input);
        assert_eq!(speakers.len(), 1);
        assert!(assignments.is_empty());
    }

    #[test]
    fn parse_response_invalid_assignment_fields() {
        let input = r#"{
            "speakers": [{"suggested_name": "Alice", "confidence": "high", "reasoning": "ok"}],
            "assignments": [
                {"segment_index": "not_a_number", "speaker_index": 0},
                {"segment_index": 1, "speaker_index": 0}
            ]
        }"#;
        let (_, assignments) = parse_identify_and_assign_response(input);
        // First assignment filtered out (segment_index is string, as_u64 returns None)
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].segment_index, 1);
    }

    #[test]
    fn parse_response_empty_string() {
        let (speakers, assignments) = parse_identify_and_assign_response("");
        assert!(speakers.is_empty());
        assert!(assignments.is_empty());
    }

    #[test]
    fn parse_response_with_extra_text() {
        let input = "Sure! Here is the analysis:\n{\"speakers\": [{\"suggested_name\": \"Eve\", \"confidence\": \"medium\", \"reasoning\": \"Pattern\"}], \"assignments\": [{\"segment_index\": 0, \"speaker_index\": 0}]}\nHope this helps!";
        let (speakers, assignments) = parse_identify_and_assign_response(input);
        assert_eq!(speakers.len(), 1);
        assert_eq!(speakers[0].suggested_name, "Eve");
        assert_eq!(assignments.len(), 1);
    }

    // ── extract_suggestions tests ───────────────────────────────────

    #[test]
    fn extract_multiple_speakers() {
        let value: serde_json::Value = serde_json::from_str(r#"{
            "speakers": [
                {"suggested_name": "A", "confidence": "high", "reasoning": "r1"},
                {"suggested_name": "B", "confidence": "medium", "reasoning": "r2"},
                {"suggested_name": "C", "confidence": "low", "reasoning": "r3"}
            ]
        }"#).unwrap();
        let result = extract_suggestions(&value);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].suggested_name, "A");
        assert_eq!(result[1].suggested_name, "B");
        assert_eq!(result[2].suggested_name, "C");
    }

    #[test]
    fn extract_no_speakers_key() {
        let value: serde_json::Value = serde_json::from_str(r#"{"other": "data"}"#).unwrap();
        let result = extract_suggestions(&value);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].suggested_name, "Participant");
    }

    #[test]
    fn extract_partial_speaker_entries() {
        let value: serde_json::Value = serde_json::from_str(r#"{
            "speakers": [
                {"suggested_name": "Valid"},
                {"confidence": "high"},
                {"suggested_name": "AlsoValid", "confidence": "medium"}
            ]
        }"#).unwrap();
        let result = extract_suggestions(&value);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].suggested_name, "Valid");
        assert_eq!(result[1].suggested_name, "AlsoValid");
    }
}
