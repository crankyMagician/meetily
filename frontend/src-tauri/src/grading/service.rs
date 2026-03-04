use crate::chat::context_builder::format_transcripts_with_speakers;
use crate::database::repositories::{
    grade::GradeRepository, meeting::MeetingsRepository, setting::SettingsRepository,
    transcript::TranscriptsRepository,
};
use crate::grading::processor::build_grading_prompt;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tracing::{error, info};

pub struct GradingService;

impl GradingService {
    pub async fn generate_grade_background<R: tauri::Runtime>(
        _app: AppHandle<R>,
        pool: SqlitePool,
        grade_id: String,
        meeting_id: String,
        model_provider: String,
        model_name: String,
        grading_options: Option<crate::grading::commands::GradingOptions>,
    ) {
        info!(
            "Starting grade generation for meeting: {}, grade: {}",
            meeting_id, grade_id
        );

        // Parse provider
        let provider = match LLMProvider::from_str(&model_provider) {
            Ok(p) => p,
            Err(e) => {
                Self::fail(&pool, &grade_id, &e).await;
                return;
            }
        };

        // Get API key
        let api_key = if provider == LLMProvider::Ollama
            || provider == LLMProvider::BuiltInAI
            || provider == LLMProvider::CustomOpenAI
        {
            String::new()
        } else {
            match SettingsRepository::get_api_key(&pool, &model_provider).await {
                Ok(Some(key)) if !key.is_empty() => key,
                _ => {
                    Self::fail(
                        &pool,
                        &grade_id,
                        &format!("API key not found for {}", model_provider),
                    )
                    .await;
                    return;
                }
            }
        };

        // Get Ollama endpoint if needed
        let ollama_endpoint = if provider == LLMProvider::Ollama {
            SettingsRepository::get_model_config(&pool)
                .await
                .ok()
                .flatten()
                .and_then(|c| c.ollama_endpoint)
        } else {
            None
        };

        // Get CustomOpenAI config if needed
        let (custom_endpoint, custom_api_key, custom_max_tokens, custom_temp, custom_top_p) =
            if provider == LLMProvider::CustomOpenAI {
                match SettingsRepository::get_custom_openai_config(&pool).await {
                    Ok(Some(config)) => (
                        Some(config.endpoint),
                        config.api_key,
                        config.max_tokens.map(|t| t as u32),
                        config.temperature,
                        config.top_p,
                    ),
                    _ => {
                        Self::fail(&pool, &grade_id, "Custom OpenAI config not found").await;
                        return;
                    }
                }
            } else {
                (None, None, None, None, None)
            };

        let final_api_key = if provider == LLMProvider::CustomOpenAI {
            custom_api_key.unwrap_or_default()
        } else {
            api_key
        };

        // Get meeting context
        let (context_type, context_notes) =
            MeetingsRepository::get_meeting_context(&pool, &meeting_id)
                .await
                .unwrap_or((None, None));

        // Get all transcripts
        let transcripts = match TranscriptsRepository::get_all_for_meeting(&pool, &meeting_id).await
        {
            Ok(t) if !t.is_empty() => t,
            Ok(_) => {
                Self::fail(&pool, &grade_id, "No transcripts found for this meeting").await;
                return;
            }
            Err(e) => {
                Self::fail(&pool, &grade_id, &format!("Failed to get transcripts: {}", e)).await;
                return;
            }
        };

        // Get user display name for speaker labels
        let user_name = SettingsRepository::get_user_display_name(&pool)
            .await
            .ok()
            .flatten();

        // Format transcript with speaker labels
        let transcript_text = format_transcripts_with_speakers(&transcripts, user_name.as_deref());

        // Truncate transcript to fit model context window
        let max_chars: usize = match provider {
            LLMProvider::BuiltInAI => 80_000,
            _ => 300_000,
        };
        let transcript_text = if transcript_text.len() > max_chars {
            let break_point = transcript_text[..max_chars].rfind('\n').unwrap_or(max_chars);
            format!(
                "{}\n\n[Transcript truncated — {} of {} characters shown]",
                &transcript_text[..break_point],
                break_point,
                transcript_text.len()
            )
        } else {
            transcript_text
        };

        // Build prompt with grading options
        let grade_target = match grading_options.as_ref().and_then(|o| o.grade_target.as_deref()) {
            Some("other") => "the other participant",
            Some("both") => "all participants",
            _ => user_name.as_deref().unwrap_or("the participant"),
        };
        let focus_areas = grading_options.as_ref().and_then(|o| o.focus_areas.as_deref());
        let user_role = grading_options.as_ref().and_then(|o| o.user_role.as_deref());
        let system_prompt =
            build_grading_prompt(context_type.as_deref(), context_notes.as_deref(), Some(grade_target), focus_areas, user_role);
        let user_prompt = format!(
            "<transcript>\n{}\n</transcript>",
            transcript_text
        );

        let app_data_dir = _app.path().app_data_dir().ok();

        // Call LLM
        let client = reqwest::Client::new();
        match generate_summary(
            &client,
            &provider,
            &model_name,
            &final_api_key,
            &system_prompt,
            &user_prompt,
            ollama_endpoint.as_deref(),
            custom_endpoint.as_deref(),
            custom_max_tokens,
            custom_temp,
            custom_top_p,
            app_data_dir.as_ref(),
            None,
        )
        .await
        {
            Ok(response) => {
                // Try to parse as JSON, store the raw response if parsing fails
                let result_json = match serde_json::from_str::<serde_json::Value>(&response) {
                    Ok(_) => response.clone(),
                    Err(_) => {
                        // Try to extract JSON from the response
                        if let Some(start) = response.find('{') {
                            if let Some(end) = response.rfind('}') {
                                let json_str = &response[start..=end];
                                if serde_json::from_str::<serde_json::Value>(json_str).is_ok() {
                                    json_str.to_string()
                                } else {
                                    response.clone()
                                }
                            } else {
                                response.clone()
                            }
                        } else {
                            response.clone()
                        }
                    }
                };

                if let Err(e) =
                    GradeRepository::update_completed(&pool, &grade_id, &result_json).await
                {
                    error!("Failed to save grade result: {}", e);
                } else {
                    info!("Grade completed for meeting: {}", meeting_id);
                }
            }
            Err(e) => {
                Self::fail(&pool, &grade_id, &e).await;
            }
        }
    }

    async fn fail(pool: &SqlitePool, grade_id: &str, error: &str) {
        error!("Grade generation failed for {}: {}", grade_id, error);
        if let Err(e) = GradeRepository::update_failed(pool, grade_id, error).await {
            error!("Failed to update grade status: {}", e);
        }
    }
}
