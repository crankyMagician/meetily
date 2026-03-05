use crate::api::{TranscriptSearchResult, TranscriptSegment};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqlitePool};
use tracing::{error, info};
use uuid::Uuid;

pub struct TranscriptsRepository;

impl TranscriptsRepository {
    /// Saves a new meeting and its associated transcript segments.
    /// This function uses a transaction to ensure that either both the meeting
    /// and all its transcripts are saved, or none of them are.
    pub async fn save_transcript(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
    ) -> Result<String, SqlxError> {
        let meeting_id = format!("meeting-{}", Uuid::new_v4());

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now();

        // 1. Create the new meeting
        let result = sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&meeting_id)
        .bind(meeting_title)
        .bind(now)
        .bind(now)
        .bind(&folder_path)
        .execute(&mut *transaction)
        .await;

        if let Err(e) = result {
            error!("Failed to create meeting '{}': {}", meeting_title, e);
            transaction.rollback().await?;
            return Err(e);
        }

        info!("Successfully created meeting with id: {}", meeting_id);

        // 2. Save each transcript segment with audio timing fields and speaker
        for segment in transcripts {
            let transcript_id = format!("transcript-{}", Uuid::new_v4());
            let result = sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration, speaker)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&transcript_id)
            .bind(&meeting_id)
            .bind(&segment.text)
            .bind(&segment.timestamp)
            .bind(segment.audio_start_time)
            .bind(segment.audio_end_time)
            .bind(segment.duration)
            .bind(&segment.speaker)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!(
                    "Failed to save transcript segment for meeting {}: {}",
                    meeting_id, e
                );
                transaction.rollback().await?;
                return Err(e);
            }
        }

        info!(
            "Successfully saved {} transcript segments for meeting {}",
            transcripts.len(),
            meeting_id
        );

        // Commit the transaction
        transaction.commit().await?;

        Ok(meeting_id)
    }

    /// Gets all transcripts for a meeting, ordered by audio_start_time.
    pub async fn get_all_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<crate::database::models::Transcript>, SqlxError> {
        sqlx::query_as::<_, crate::database::models::Transcript>(
            "SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    /// Searches for a query string within the transcripts.
    /// It returns a list of matching transcripts with context.
    pub async fn search_transcripts(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<TranscriptSearchResult>, SqlxError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        let search_query = format!("%{}%", query.to_lowercase());

        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT m.id, m.title, t.transcript, t.timestamp
             FROM meetings m
             JOIN transcripts t ON m.id = t.meeting_id
             WHERE LOWER(t.transcript) LIKE ?",
        )
        .bind(&search_query)
        .fetch_all(pool)
        .await?;

        let results = rows
            .into_iter()
            .map(|(id, title, transcript, timestamp)| {
                let match_context = Self::get_match_context(&transcript, query);
                TranscriptSearchResult {
                    id,
                    title,
                    match_context,
                    timestamp,
                }
            })
            .collect();

        Ok(results)
    }

    /// Updates the speaker field for a single transcript.
    pub async fn update_speaker(
        pool: &SqlitePool,
        transcript_id: &str,
        speaker: Option<&str>,
    ) -> Result<(), SqlxError> {
        sqlx::query("UPDATE transcripts SET speaker = ? WHERE id = ?")
            .bind(speaker)
            .bind(transcript_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Bulk-updates all NULL-speaker transcripts in a meeting.
    pub async fn set_unassigned_speakers(
        pool: &SqlitePool,
        meeting_id: &str,
        speaker: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "UPDATE transcripts SET speaker = ? WHERE meeting_id = ? AND speaker IS NULL",
        )
        .bind(speaker)
        .bind(meeting_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// Batch-update speaker for multiple transcript IDs at once.
    pub async fn update_speakers_batch(
        pool: &SqlitePool,
        transcript_ids: &[String],
        speaker: &str,
    ) -> Result<u64, SqlxError> {
        if transcript_ids.is_empty() {
            return Ok(0);
        }

        // Build placeholders for IN clause
        let placeholders: Vec<&str> = transcript_ids.iter().map(|_| "?").collect();
        let query_str = format!(
            "UPDATE transcripts SET speaker = ? WHERE id IN ({})",
            placeholders.join(", ")
        );

        let mut query = sqlx::query(&query_str).bind(speaker);
        for id in transcript_ids {
            query = query.bind(id);
        }

        let result = query.execute(pool).await?;
        Ok(result.rows_affected())
    }

    /// Helper function to extract a snippet of text around the first match of a query.
    fn get_match_context(transcript: &str, query: &str) -> String {
        let transcript_lower = transcript.to_lowercase();
        let query_lower = query.to_lowercase();

        match transcript_lower.find(&query_lower) {
            Some(match_index) => {
                let start_index = match_index.saturating_sub(100);
                let end_index = (match_index + query.len() + 100).min(transcript.len());

                let mut context = String::new();
                if start_index > 0 {
                    context.push_str("...");
                }
                context.push_str(&transcript[start_index..end_index]);
                if end_index < transcript.len() {
                    context.push_str("...");
                }
                context
            }
            None => transcript.chars().take(200).collect(), // Fallback to the start of the transcript
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::test_helpers::{create_test_pool, seed_meeting, seed_transcript};

    #[tokio::test]
    async fn update_speakers_batch_updates_all() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "Hello", Some("mic")).await;
        seed_transcript(&pool, "t2", "m1", "Hi", Some("mic")).await;
        seed_transcript(&pool, "t3", "m1", "Hey", Some("system")).await;

        let ids = vec!["t1".to_string(), "t2".to_string()];
        let count = TranscriptsRepository::update_speakers_batch(&pool, &ids, "alice")
            .await
            .unwrap();
        assert_eq!(count, 2);

        // Verify t1 and t2 changed, t3 unchanged
        let all = TranscriptsRepository::get_all_for_meeting(&pool, "m1")
            .await
            .unwrap();
        let t1 = all.iter().find(|t| t.id == "t1").unwrap();
        let t2 = all.iter().find(|t| t.id == "t2").unwrap();
        let t3 = all.iter().find(|t| t.id == "t3").unwrap();
        assert_eq!(t1.speaker.as_deref(), Some("alice"));
        assert_eq!(t2.speaker.as_deref(), Some("alice"));
        assert_eq!(t3.speaker.as_deref(), Some("system"));
    }

    #[tokio::test]
    async fn update_speakers_batch_empty_ids_returns_zero() {
        let pool = create_test_pool().await;
        let count = TranscriptsRepository::update_speakers_batch(&pool, &[], "alice")
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn update_speakers_batch_nonexistent_ids() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        let ids = vec!["nonexistent1".to_string(), "nonexistent2".to_string()];
        let count = TranscriptsRepository::update_speakers_batch(&pool, &ids, "alice")
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn update_speakers_batch_single_id() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "Hello", Some("mic")).await;

        let ids = vec!["t1".to_string()];
        let count = TranscriptsRepository::update_speakers_batch(&pool, &ids, "bob")
            .await
            .unwrap();
        assert_eq!(count, 1);

        let all = TranscriptsRepository::get_all_for_meeting(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(all[0].speaker.as_deref(), Some("bob"));
    }

    #[tokio::test]
    async fn update_speakers_batch_preserves_other_fields() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "Important text", Some("mic")).await;

        let ids = vec!["t1".to_string()];
        TranscriptsRepository::update_speakers_batch(&pool, &ids, "alice")
            .await
            .unwrap();

        let all = TranscriptsRepository::get_all_for_meeting(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(all[0].transcript, "Important text");
        assert_eq!(all[0].timestamp, "2026-03-05T00:00:00Z");
    }
}
