use crate::chat::service::ChatService;
use crate::database::repositories::chat::ChatRepository;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tracing::{error, info};

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatSessionResponse {
    pub id: String,
    pub meeting_id: Option<String>,
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessageResponse {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageResponse {
    pub message: ChatMessageResponse,
    pub response: String,
}

#[tauri::command]
pub async fn api_create_chat_session<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: Option<String>,
    title: Option<String>,
) -> Result<ChatSessionResponse, String> {
    let pool = state.db_manager.pool();
    let session_id = format!("chat-{}", uuid::Uuid::new_v4());

    let session = ChatRepository::create_session(
        pool,
        &session_id,
        meeting_id.as_deref(),
        title.as_deref(),
    )
    .await
    .map_err(|e| format!("Failed to create chat session: {}", e))?;

    info!("Created chat session: {}", session_id);
    Ok(ChatSessionResponse {
        id: session.id,
        meeting_id: session.meeting_id,
        title: session.title,
        created_at: session.created_at.to_rfc3339(),
    })
}

#[tauri::command]
pub async fn api_send_chat_message<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    session_id: String,
    message: String,
    model: String,
    model_name: String,
) -> Result<SendMessageResponse, String> {
    let pool = state.db_manager.pool();

    let response = ChatService::send_message(&app, pool, &session_id, &message, &model, &model_name)
        .await?;

    // Get the last two messages (user + assistant)
    let messages = ChatRepository::get_messages(pool, &session_id)
        .await
        .map_err(|e| format!("Failed to get messages: {}", e))?;

    let last_user_msg = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .ok_or("User message not found")?;

    Ok(SendMessageResponse {
        message: ChatMessageResponse {
            id: last_user_msg.id.clone(),
            session_id: last_user_msg.session_id.clone(),
            role: last_user_msg.role.clone(),
            content: last_user_msg.content.clone(),
            created_at: last_user_msg.created_at.to_rfc3339(),
        },
        response,
    })
}

#[tauri::command]
pub async fn api_get_chat_history<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ChatMessageResponse>, String> {
    let pool = state.db_manager.pool();

    let messages = ChatRepository::get_messages(pool, &session_id)
        .await
        .map_err(|e| format!("Failed to get chat history: {}", e))?;

    Ok(messages
        .into_iter()
        .map(|m| ChatMessageResponse {
            id: m.id,
            session_id: m.session_id,
            role: m.role,
            content: m.content,
            created_at: m.created_at.to_rfc3339(),
        })
        .collect())
}

#[tauri::command]
pub async fn api_list_chat_sessions<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: Option<String>,
) -> Result<Vec<ChatSessionResponse>, String> {
    let pool = state.db_manager.pool();

    let sessions = if let Some(mid) = meeting_id {
        ChatRepository::list_sessions_for_meeting(pool, &mid).await
    } else {
        ChatRepository::list_cross_meeting_sessions(pool).await
    }
    .map_err(|e| format!("Failed to list chat sessions: {}", e))?;

    Ok(sessions
        .into_iter()
        .map(|s| ChatSessionResponse {
            id: s.id,
            meeting_id: s.meeting_id,
            title: s.title,
            created_at: s.created_at.to_rfc3339(),
        })
        .collect())
}
