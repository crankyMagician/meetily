use crate::database::models::{ChatMessage, ChatSession};
use chrono::Utc;
use sqlx::SqlitePool;
use tracing::info;

pub struct ChatRepository;

impl ChatRepository {
    pub async fn create_session(
        pool: &SqlitePool,
        id: &str,
        meeting_id: Option<&str>,
        title: Option<&str>,
    ) -> Result<ChatSession, sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO chat_sessions (id, meeting_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(meeting_id)
        .bind(title)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;

        info!("Chat session created: {}", id);
        Ok(ChatSession {
            id: id.to_string(),
            meeting_id: meeting_id.map(|s| s.to_string()),
            title: title.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn get_session(
        pool: &SqlitePool,
        session_id: &str,
    ) -> Result<Option<ChatSession>, sqlx::Error> {
        sqlx::query_as::<_, ChatSession>(
            "SELECT * FROM chat_sessions WHERE id = ?",
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn list_sessions_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<ChatSession>, sqlx::Error> {
        sqlx::query_as::<_, ChatSession>(
            "SELECT * FROM chat_sessions WHERE meeting_id = ? ORDER BY updated_at DESC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn list_cross_meeting_sessions(
        pool: &SqlitePool,
    ) -> Result<Vec<ChatSession>, sqlx::Error> {
        sqlx::query_as::<_, ChatSession>(
            "SELECT * FROM chat_sessions WHERE meeting_id IS NULL ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn add_message(
        pool: &SqlitePool,
        id: &str,
        session_id: &str,
        role: &str,
        content: &str,
    ) -> Result<ChatMessage, sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(session_id)
        .bind(role)
        .bind(content)
        .bind(now)
        .execute(pool)
        .await?;

        // Update session updated_at
        sqlx::query("UPDATE chat_sessions SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(session_id)
            .execute(pool)
            .await?;

        Ok(ChatMessage {
            id: id.to_string(),
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: now,
        })
    }

    pub async fn get_messages(
        pool: &SqlitePool,
        session_id: &str,
    ) -> Result<Vec<ChatMessage>, sqlx::Error> {
        sqlx::query_as::<_, ChatMessage>(
            "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
        )
        .bind(session_id)
        .fetch_all(pool)
        .await
    }
}
