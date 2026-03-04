use crate::database::models::CommunicationGrade;
use chrono::Utc;
use sqlx::SqlitePool;
use tracing::info;

pub struct GradeRepository;

impl GradeRepository {
    pub async fn create_or_reset(
        pool: &SqlitePool,
        id: &str,
        meeting_id: &str,
        model: &str,
        model_name: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO communication_grades (id, meeting_id, status, model, model_name, created_at, updated_at)
            VALUES (?, ?, 'pending', ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = 'pending',
                result = NULL,
                error = NULL,
                model = excluded.model,
                model_name = excluded.model_name,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(id)
        .bind(meeting_id)
        .bind(model)
        .bind(model_name)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
        info!("Grade process created/reset for meeting: {}", meeting_id);
        Ok(())
    }

    pub async fn update_completed(
        pool: &SqlitePool,
        id: &str,
        result_json: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            "UPDATE communication_grades SET status = 'completed', result = ?, error = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(result_json)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_failed(
        pool: &SqlitePool,
        id: &str,
        error: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            "UPDATE communication_grades SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
        )
        .bind(error)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn get_by_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<CommunicationGrade>, sqlx::Error> {
        sqlx::query_as::<_, CommunicationGrade>(
            "SELECT * FROM communication_grades WHERE meeting_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn get_by_id(
        pool: &SqlitePool,
        id: &str,
    ) -> Result<Option<CommunicationGrade>, sqlx::Error> {
        sqlx::query_as::<_, CommunicationGrade>(
            "SELECT * FROM communication_grades WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }
}
