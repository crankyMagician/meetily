use crate::chat::context_builder::{build_cross_meeting_context, build_single_meeting_context};
use crate::database::repositories::{chat::ChatRepository, setting::SettingsRepository};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tracing::{error, info};

pub struct ChatService;

impl ChatService {
    /// Sends a user message and gets an LLM response.
    /// Returns the assistant's response content.
    pub async fn send_message<R: tauri::Runtime>(
        _app: &AppHandle<R>,
        pool: &SqlitePool,
        session_id: &str,
        user_message: &str,
        model_provider: &str,
        model_name: &str,
    ) -> Result<String, String> {
        info!(
            "Chat message for session {}: {}",
            session_id,
            &user_message[..user_message.len().min(100)]
        );

        // Save user message
        let user_msg_id = format!("msg-{}", uuid::Uuid::new_v4());
        ChatRepository::add_message(pool, &user_msg_id, session_id, "user", user_message)
            .await
            .map_err(|e| format!("Failed to save user message: {}", e))?;

        // Parse provider early so we can determine context limits
        let provider = LLMProvider::from_str(model_provider)?;

        // Get session to determine context
        let session = ChatRepository::get_session(pool, session_id)
            .await
            .map_err(|e| format!("Failed to get session: {}", e))?
            .ok_or_else(|| "Session not found".to_string())?;

        // Determine max context chars based on provider to prevent overflow
        // BuiltInAI has ~32K token context (~80K chars), cloud providers have 128K+ (~300K chars)
        let max_context_chars = match provider {
            LLMProvider::BuiltInAI => Some(80_000),
            _ => Some(300_000),
        };

        // Build context based on whether this is single or cross-meeting
        let system_prompt = if let Some(meeting_id) = &session.meeting_id {
            build_single_meeting_context(pool, meeting_id, max_context_chars).await?
        } else {
            build_cross_meeting_context(pool, user_message, max_context_chars).await?
        };

        // Get chat history for context
        let history = ChatRepository::get_messages(pool, session_id)
            .await
            .map_err(|e| format!("Failed to get chat history: {}", e))?;

        // Build the user prompt with conversation history
        let mut user_prompt = String::new();
        // Include last 10 messages of history (excluding the just-saved user message)
        let history_to_include: Vec<_> = history
            .iter()
            .rev()
            .skip(1) // skip the message we just saved
            .take(10)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();

        if !history_to_include.is_empty() {
            user_prompt.push_str("Previous conversation:\n");
            for msg in &history_to_include {
                let role_label = if msg.role == "user" { "User" } else { "Assistant" };
                user_prompt.push_str(&format!("{}: {}\n", role_label, msg.content));
            }
            user_prompt.push_str("\n");
        }

        user_prompt.push_str(&format!("User: {}", user_message));

        // Get API key
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

        // Get Ollama endpoint if needed
        let ollama_endpoint = if provider == LLMProvider::Ollama {
            SettingsRepository::get_model_config(pool)
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

        let app_data_dir = _app.path().app_data_dir().ok();

        // Call LLM
        let client = reqwest::Client::new();
        let response = generate_summary(
            &client,
            &provider,
            model_name,
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
        .await?;

        // Save assistant response
        let assistant_msg_id = format!("msg-{}", uuid::Uuid::new_v4());
        ChatRepository::add_message(pool, &assistant_msg_id, session_id, "assistant", &response)
            .await
            .map_err(|e| format!("Failed to save assistant message: {}", e))?;

        info!("Chat response saved for session: {}", session_id);
        Ok(response)
    }
}
