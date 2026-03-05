use sqlx::{Connection, SqlitePool};
use tracing::info;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct MeetingSpeaker {
    pub id: String,
    pub meeting_id: String,
    pub speaker_key: String,
    pub display_name: String,
    pub suggested_by: Option<String>,
    pub created_at: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpeakerSegmentCount {
    pub speaker: String,
    pub count: i64,
}

/// Default colors for auto-populated speakers
const DEFAULT_COLORS: &[&str] = &[
    "blue", "purple", "red", "green", "amber", "pink", "indigo", "cyan", "emerald", "rose",
    "teal", "violet",
];

pub struct SpeakerRepository;

impl SpeakerRepository {
    /// Get all speaker name mappings for a meeting
    pub async fn get_meeting_speakers(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<MeetingSpeaker>, sqlx::Error> {
        sqlx::query_as::<_, MeetingSpeaker>(
            "SELECT id, meeting_id, speaker_key, display_name, suggested_by, created_at, color, sort_order
             FROM meeting_speakers WHERE meeting_id = ?
             ORDER BY sort_order ASC, speaker_key ASC",
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

    /// Set a speaker's color
    pub async fn set_speaker_color(
        pool: &SqlitePool,
        meeting_id: &str,
        speaker_key: &str,
        color: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE meeting_speakers SET color = ? WHERE meeting_id = ? AND speaker_key = ?",
        )
        .bind(color)
        .bind(meeting_id)
        .bind(speaker_key)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Delete a speaker entry
    pub async fn delete_speaker(
        pool: &SqlitePool,
        meeting_id: &str,
        speaker_key: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM meeting_speakers WHERE meeting_id = ? AND speaker_key = ?")
            .bind(meeting_id)
            .bind(speaker_key)
            .execute(pool)
            .await?;
        info!(
            "Deleted speaker '{}' from meeting {}",
            speaker_key, meeting_id
        );
        Ok(())
    }

    /// Get segment counts per speaker for a meeting
    pub async fn get_speaker_segment_counts(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<SpeakerSegmentCount>, sqlx::Error> {
        let rows: Vec<(String, i64)> = sqlx::query_as(
            "SELECT speaker, COUNT(*) as count FROM transcripts
             WHERE meeting_id = ? AND speaker IS NOT NULL
             GROUP BY speaker",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(speaker, count)| SpeakerSegmentCount { speaker, count })
            .collect())
    }

    /// Reassign all transcript segments from one speaker to another, then delete the old speaker entry
    pub async fn reassign_speaker(
        pool: &SqlitePool,
        meeting_id: &str,
        from_speaker: &str,
        to_speaker: &str,
    ) -> Result<u64, sqlx::Error> {
        let mut conn = pool.acquire().await?;
        let mut tx = conn.begin().await?;

        // Update all transcript segments
        let result = sqlx::query(
            "UPDATE transcripts SET speaker = ? WHERE meeting_id = ? AND speaker = ?",
        )
        .bind(to_speaker)
        .bind(meeting_id)
        .bind(from_speaker)
        .execute(&mut *tx)
        .await?;

        let count = result.rows_affected();

        // Delete the old speaker entry
        sqlx::query("DELETE FROM meeting_speakers WHERE meeting_id = ? AND speaker_key = ?")
            .bind(meeting_id)
            .bind(from_speaker)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        info!(
            "Reassigned {} segments from '{}' to '{}' in meeting {}",
            count, from_speaker, to_speaker, meeting_id
        );
        Ok(count)
    }

    /// Ensure default speakers exist for a meeting by querying distinct speakers from transcripts
    /// and inserting missing entries with auto-assigned colors
    pub async fn ensure_default_speakers(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<MeetingSpeaker>, sqlx::Error> {
        // Get distinct speakers from transcripts
        let transcript_speakers: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT speaker FROM transcripts WHERE meeting_id = ? AND speaker IS NOT NULL",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await?;

        // Get existing speakers
        let existing = Self::get_meeting_speakers(pool, meeting_id).await?;
        let existing_keys: std::collections::HashSet<String> =
            existing.iter().map(|s| s.speaker_key.clone()).collect();
        let used_colors: Vec<String> = existing.iter().filter_map(|s| s.color.clone()).collect();

        // Insert missing speakers with auto-assigned colors
        for (i, (speaker_key,)) in transcript_speakers.iter().enumerate() {
            if !existing_keys.contains(speaker_key) {
                let color = pick_color(speaker_key, &used_colors, i);
                let display_name = default_display_name(speaker_key);
                let id = format!("speaker-{}", uuid::Uuid::new_v4());

                sqlx::query(
                    r#"
                    INSERT INTO meeting_speakers (id, meeting_id, speaker_key, display_name, suggested_by, color, sort_order)
                    VALUES (?, ?, ?, ?, 'auto', ?, ?)
                    ON CONFLICT(meeting_id, speaker_key) DO NOTHING
                    "#,
                )
                .bind(&id)
                .bind(meeting_id)
                .bind(speaker_key)
                .bind(&display_name)
                .bind(&color)
                .bind(i as i64)
                .execute(pool)
                .await?;
            }
        }

        // Return full list
        Self::get_meeting_speakers(pool, meeting_id).await
    }

    /// Add a new speaker to a meeting
    pub async fn add_speaker(
        pool: &SqlitePool,
        meeting_id: &str,
        speaker_key: &str,
        display_name: &str,
        color: Option<&str>,
    ) -> Result<MeetingSpeaker, sqlx::Error> {
        let id = format!("speaker-{}", uuid::Uuid::new_v4());

        // Get next sort_order
        let max_order: Option<(Option<i64>,)> = sqlx::query_as(
            "SELECT MAX(sort_order) FROM meeting_speakers WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;
        let sort_order = max_order
            .and_then(|r| r.0)
            .unwrap_or(0)
            + 1;

        let final_color = color.unwrap_or("blue");

        sqlx::query(
            r#"
            INSERT INTO meeting_speakers (id, meeting_id, speaker_key, display_name, suggested_by, color, sort_order)
            VALUES (?, ?, ?, ?, 'user', ?, ?)
            ON CONFLICT(meeting_id, speaker_key) DO UPDATE SET
                display_name = excluded.display_name,
                color = excluded.color
            "#,
        )
        .bind(&id)
        .bind(meeting_id)
        .bind(speaker_key)
        .bind(display_name)
        .bind(final_color)
        .bind(sort_order)
        .execute(pool)
        .await?;

        Ok(MeetingSpeaker {
            id,
            meeting_id: meeting_id.to_string(),
            speaker_key: speaker_key.to_string(),
            display_name: display_name.to_string(),
            suggested_by: Some("user".to_string()),
            created_at: None,
            color: Some(final_color.to_string()),
            sort_order: Some(sort_order),
        })
    }
}

/// Pick a color for a speaker key, using defaults for known keys
fn pick_color(speaker_key: &str, used_colors: &[String], fallback_index: usize) -> String {
    match speaker_key {
        "mic" => "blue".to_string(),
        "system" => "purple".to_string(),
        _ => {
            // Find next unused color
            for color in DEFAULT_COLORS {
                if !used_colors.contains(&color.to_string()) {
                    return color.to_string();
                }
            }
            // All used — cycle
            DEFAULT_COLORS[fallback_index % DEFAULT_COLORS.len()].to_string()
        }
    }
}

/// Default display name for a speaker key
fn default_display_name(speaker_key: &str) -> String {
    match speaker_key {
        "mic" => "You".to_string(),
        "system" => "Other".to_string(),
        _ => speaker_key.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::test_helpers::{create_test_pool, seed_meeting, seed_transcript};

    // ── Pure helper tests (no DB) ───────────────────────────────────

    #[test]
    fn pick_color_mic_returns_blue() {
        assert_eq!(pick_color("mic", &[], 0), "blue");
    }

    #[test]
    fn pick_color_system_returns_purple() {
        assert_eq!(pick_color("system", &[], 0), "purple");
    }

    #[test]
    fn pick_color_unknown_uses_first_available() {
        assert_eq!(pick_color("custom", &[], 0), "blue");
    }

    #[test]
    fn pick_color_skips_used_colors() {
        let used = vec!["blue".to_string()];
        assert_eq!(pick_color("custom", &used, 0), "purple");
    }

    #[test]
    fn pick_color_all_used_cycles() {
        let used: Vec<String> = DEFAULT_COLORS.iter().map(|s| s.to_string()).collect();
        // fallback_index=3 → DEFAULT_COLORS[3 % 12] = "green"
        assert_eq!(pick_color("custom", &used, 3), "green");
    }

    #[test]
    fn default_display_name_mic() {
        assert_eq!(default_display_name("mic"), "You");
    }

    #[test]
    fn default_display_name_system() {
        assert_eq!(default_display_name("system"), "Other");
    }

    #[test]
    fn default_display_name_custom() {
        assert_eq!(default_display_name("alice"), "alice");
    }

    // ── Async DB tests ──────────────────────────────────────────────

    #[tokio::test]
    async fn add_speaker_creates_entry() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        let speaker = SpeakerRepository::add_speaker(&pool, "m1", "mic", "You", Some("blue"))
            .await
            .unwrap();
        assert_eq!(speaker.speaker_key, "mic");
        assert_eq!(speaker.display_name, "You");

        let speakers = SpeakerRepository::get_meeting_speakers(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(speakers.len(), 1);
        assert_eq!(speakers[0].speaker_key, "mic");
    }

    #[tokio::test]
    async fn add_speaker_upserts_on_conflict() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        SpeakerRepository::add_speaker(&pool, "m1", "mic", "You", Some("blue"))
            .await
            .unwrap();
        SpeakerRepository::add_speaker(&pool, "m1", "mic", "Me", Some("red"))
            .await
            .unwrap();

        let speakers = SpeakerRepository::get_meeting_speakers(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(speakers.len(), 1);
        assert_eq!(speakers[0].display_name, "Me");
        assert_eq!(speakers[0].color.as_deref(), Some("red"));
    }

    #[tokio::test]
    async fn get_meeting_speakers_empty() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        let speakers = SpeakerRepository::get_meeting_speakers(&pool, "m1")
            .await
            .unwrap();
        assert!(speakers.is_empty());
    }

    #[tokio::test]
    async fn get_meeting_speakers_ordered_by_sort_order() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        // Insert with explicit sort_orders (reversed)
        sqlx::query(
            "INSERT INTO meeting_speakers (id, meeting_id, speaker_key, display_name, sort_order) VALUES (?, ?, ?, ?, ?)"
        )
        .bind("s1").bind("m1").bind("b").bind("B").bind(2)
        .execute(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO meeting_speakers (id, meeting_id, speaker_key, display_name, sort_order) VALUES (?, ?, ?, ?, ?)"
        )
        .bind("s2").bind("m1").bind("a").bind("A").bind(1)
        .execute(&pool).await.unwrap();

        let speakers = SpeakerRepository::get_meeting_speakers(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(speakers[0].speaker_key, "a");
        assert_eq!(speakers[1].speaker_key, "b");
    }

    #[tokio::test]
    async fn set_speaker_name_creates_on_insert() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        SpeakerRepository::set_speaker_name(&pool, "m1", "mic", "Sam", "user")
            .await
            .unwrap();

        let name = SpeakerRepository::get_speaker_name(&pool, "m1", "mic")
            .await
            .unwrap();
        assert_eq!(name, Some("Sam".to_string()));
    }

    #[tokio::test]
    async fn set_speaker_name_updates_on_conflict() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        SpeakerRepository::set_speaker_name(&pool, "m1", "mic", "Sam", "user")
            .await
            .unwrap();
        SpeakerRepository::set_speaker_name(&pool, "m1", "mic", "Samuel", "llm")
            .await
            .unwrap();

        let name = SpeakerRepository::get_speaker_name(&pool, "m1", "mic")
            .await
            .unwrap();
        assert_eq!(name, Some("Samuel".to_string()));
    }

    #[tokio::test]
    async fn get_speaker_name_found() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        SpeakerRepository::set_speaker_name(&pool, "m1", "mic", "You", "auto")
            .await
            .unwrap();
        let name = SpeakerRepository::get_speaker_name(&pool, "m1", "mic")
            .await
            .unwrap();
        assert_eq!(name, Some("You".to_string()));
    }

    #[tokio::test]
    async fn get_speaker_name_not_found() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        let name = SpeakerRepository::get_speaker_name(&pool, "m1", "nonexistent")
            .await
            .unwrap();
        assert_eq!(name, None);
    }

    #[tokio::test]
    async fn set_speaker_color_updates() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        SpeakerRepository::add_speaker(&pool, "m1", "mic", "You", Some("blue"))
            .await
            .unwrap();
        SpeakerRepository::set_speaker_color(&pool, "m1", "mic", "red")
            .await
            .unwrap();

        let speakers = SpeakerRepository::get_meeting_speakers(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(speakers[0].color.as_deref(), Some("red"));
    }

    #[tokio::test]
    async fn delete_speaker_removes_entry() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        SpeakerRepository::add_speaker(&pool, "m1", "mic", "You", Some("blue"))
            .await
            .unwrap();
        SpeakerRepository::delete_speaker(&pool, "m1", "mic")
            .await
            .unwrap();

        let speakers = SpeakerRepository::get_meeting_speakers(&pool, "m1")
            .await
            .unwrap();
        assert!(speakers.is_empty());
    }

    #[tokio::test]
    async fn delete_speaker_nonexistent_is_ok() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        let result = SpeakerRepository::delete_speaker(&pool, "m1", "nonexistent").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn get_speaker_segment_counts() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "Hello", Some("mic")).await;
        seed_transcript(&pool, "t2", "m1", "Hi there", Some("mic")).await;
        seed_transcript(&pool, "t3", "m1", "Good day", Some("system")).await;

        let counts = SpeakerRepository::get_speaker_segment_counts(&pool, "m1")
            .await
            .unwrap();

        let mic_count = counts.iter().find(|c| c.speaker == "mic").unwrap().count;
        let sys_count = counts.iter().find(|c| c.speaker == "system").unwrap().count;
        assert_eq!(mic_count, 2);
        assert_eq!(sys_count, 1);
    }

    #[tokio::test]
    async fn get_speaker_segment_counts_excludes_null() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "Hello", Some("mic")).await;
        seed_transcript(&pool, "t2", "m1", "No speaker", None).await;

        let counts = SpeakerRepository::get_speaker_segment_counts(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(counts.len(), 1);
        assert_eq!(counts[0].speaker, "mic");
    }

    #[tokio::test]
    async fn reassign_speaker_moves_segments() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "A", Some("system")).await;
        seed_transcript(&pool, "t2", "m1", "B", Some("system")).await;
        seed_transcript(&pool, "t3", "m1", "C", Some("mic")).await;

        SpeakerRepository::add_speaker(&pool, "m1", "system", "Other", Some("purple"))
            .await
            .unwrap();
        SpeakerRepository::add_speaker(&pool, "m1", "alice", "Alice", Some("red"))
            .await
            .unwrap();

        let count = SpeakerRepository::reassign_speaker(&pool, "m1", "system", "alice")
            .await
            .unwrap();
        assert_eq!(count, 2);

        // "system" speaker entry should be deleted
        let speakers = SpeakerRepository::get_meeting_speakers(&pool, "m1")
            .await
            .unwrap();
        assert!(!speakers.iter().any(|s| s.speaker_key == "system"));

        // Transcripts should now be "alice"
        let counts = SpeakerRepository::get_speaker_segment_counts(&pool, "m1")
            .await
            .unwrap();
        let alice_count = counts.iter().find(|c| c.speaker == "alice").unwrap().count;
        assert_eq!(alice_count, 2);
    }

    #[tokio::test]
    async fn reassign_speaker_returns_count() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "A", Some("mic")).await;

        SpeakerRepository::add_speaker(&pool, "m1", "mic", "You", Some("blue"))
            .await
            .unwrap();

        let count = SpeakerRepository::reassign_speaker(&pool, "m1", "mic", "sam")
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn ensure_default_speakers_creates_from_transcripts() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "Hello", Some("mic")).await;
        seed_transcript(&pool, "t2", "m1", "Hi", Some("system")).await;

        let speakers = SpeakerRepository::ensure_default_speakers(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(speakers.len(), 2);

        let mic_speaker = speakers.iter().find(|s| s.speaker_key == "mic").unwrap();
        let sys_speaker = speakers.iter().find(|s| s.speaker_key == "system").unwrap();
        assert_eq!(mic_speaker.display_name, "You");
        assert_eq!(mic_speaker.color.as_deref(), Some("blue"));
        assert_eq!(sys_speaker.display_name, "Other");
        assert_eq!(sys_speaker.color.as_deref(), Some("purple"));
    }

    #[tokio::test]
    async fn ensure_default_speakers_no_duplicates() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;
        seed_transcript(&pool, "t1", "m1", "Hello", Some("mic")).await;

        // Manually add mic speaker first
        SpeakerRepository::add_speaker(&pool, "m1", "mic", "Sam", Some("red"))
            .await
            .unwrap();

        let speakers = SpeakerRepository::ensure_default_speakers(&pool, "m1")
            .await
            .unwrap();
        assert_eq!(speakers.len(), 1);
        // Should keep original name, not overwrite with default
        assert_eq!(speakers[0].display_name, "Sam");
    }

    #[tokio::test]
    async fn ensure_default_speakers_empty_meeting() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        let speakers = SpeakerRepository::ensure_default_speakers(&pool, "m1")
            .await
            .unwrap();
        assert!(speakers.is_empty());
    }

    #[tokio::test]
    async fn add_speaker_auto_increments_sort_order() {
        let pool = create_test_pool().await;
        seed_meeting(&pool, "m1", "Test").await;

        let s1 = SpeakerRepository::add_speaker(&pool, "m1", "mic", "You", Some("blue"))
            .await
            .unwrap();
        let s2 = SpeakerRepository::add_speaker(&pool, "m1", "system", "Other", Some("purple"))
            .await
            .unwrap();
        let s3 = SpeakerRepository::add_speaker(&pool, "m1", "alice", "Alice", Some("red"))
            .await
            .unwrap();

        assert_eq!(s1.sort_order, Some(1));
        assert_eq!(s2.sort_order, Some(2));
        assert_eq!(s3.sort_order, Some(3));
    }
}
