use sqlx::SqlitePool;

/// Create an in-memory SQLite pool with all migrations applied.
pub async fn create_test_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("Failed to create in-memory SQLite pool");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    pool
}

/// Insert a meeting row for testing.
pub async fn seed_meeting(pool: &SqlitePool, meeting_id: &str, title: &str) {
    let now = chrono::Utc::now();
    sqlx::query(
        "INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .bind(meeting_id)
    .bind(title)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .expect("Failed to seed meeting");
}

/// Insert a transcript row for testing.
pub async fn seed_transcript(
    pool: &SqlitePool,
    id: &str,
    meeting_id: &str,
    text: &str,
    speaker: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, speaker) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(meeting_id)
    .bind(text)
    .bind("2026-03-05T00:00:00Z")
    .bind(speaker)
    .execute(pool)
    .await
    .expect("Failed to seed transcript");
}
