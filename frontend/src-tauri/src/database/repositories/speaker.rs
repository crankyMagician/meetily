use sqlx::SqlitePool;
use tracing::info;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct MeetingSpeaker {
    pub id: String,
    pub meeting_id: String,
    pub speaker_key: String,
    pub display_name: String,
    pub suggested_by: Option<String>,
    pub created_at: Option<String>,
}

pub struct SpeakerRepository;

impl SpeakerRepository {
    /// Get all speaker name mappings for a meeting
    pub async fn get_meeting_speakers(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<MeetingSpeaker>, sqlx::Error> {
        sqlx::query_as::<_, MeetingSpeaker>(
            "SELECT * FROM meeting_speakers WHERE meeting_id = ? ORDER BY speaker_key",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    /// Get a specific speaker name for a meeting
    pub async fn get_speaker_name(
        pool: &SqlitePool,
        meeting_id: &str,
        speaker_key: &str,
    ) -> Result<Option<String>, sqlx::Error> {
        let result: Option<(String,)> = sqlx::query_as(
            "SELECT display_name FROM meeting_speakers WHERE meeting_id = ? AND speaker_key = ?",
        )
        .bind(meeting_id)
        .bind(speaker_key)
        .fetch_optional(pool)
        .await?;
        Ok(result.map(|r| r.0))
    }

    /// Set or update a speaker's display name
    pub async fn set_speaker_name(
        pool: &SqlitePool,
        meeting_id: &str,
        speaker_key: &str,
        display_name: &str,
        suggested_by: &str,
    ) -> Result<(), sqlx::Error> {
        let id = format!("speaker-{}", uuid::Uuid::new_v4());
        sqlx::query(
            r#"
            INSERT INTO meeting_speakers (id, meeting_id, speaker_key, display_name, suggested_by)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(meeting_id, speaker_key) DO UPDATE SET
                display_name = excluded.display_name,
                suggested_by = excluded.suggested_by
            "#,
        )
        .bind(&id)
        .bind(meeting_id)
        .bind(speaker_key)
        .bind(display_name)
        .bind(suggested_by)
        .execute(pool)
        .await?;

        info!(
            "Set speaker '{}' display name to '{}' for meeting {}",
            speaker_key, display_name, meeting_id
        );
        Ok(())
    }
}
