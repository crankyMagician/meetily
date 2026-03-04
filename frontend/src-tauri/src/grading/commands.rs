use crate::database::repositories::grade::GradeRepository;
use crate::grading::service::GradingService;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tracing::{error, info};

#[derive(Debug, Serialize, Deserialize)]
pub struct GradeResponse {
    pub id: String,
    pub status: String,
    pub meeting_id: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradingOptions {
    pub grade_target: Option<String>,  // "me", "other", "both"
    pub focus_areas: Option<String>,
    pub user_role: Option<String>,
}

#[tauri::command]
pub async fn api_generate_grade<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    model: String,
    model_name: String,
    grading_options: Option<GradingOptions>,
) -> Result<GradeResponse, String> {
    info!(
        "api_generate_grade called for meeting: {}, model: {}/{}, options: {:?}",
        meeting_id, model, model_name, grading_options
    );

    let pool = state.db_manager.pool().clone();
    let grade_id = format!("grade-{}", uuid::Uuid::new_v4());

    GradeRepository::create_or_reset(&pool, &grade_id, &meeting_id, &model, &model_name)
        .await
        .map_err(|e| format!("Failed to create grade process: {}", e))?;

    let grade_id_clone = grade_id.clone();
    let meeting_id_clone = meeting_id.clone();
    tauri::async_runtime::spawn(async move {
        GradingService::generate_grade_background(
            app,
            pool,
            grade_id_clone,
            meeting_id_clone,
            model,
            model_name,
            grading_options,
        )
        .await;
    });

    Ok(GradeResponse {
        id: grade_id,
        status: "pending".to_string(),
        meeting_id,
        result: None,
        error: None,
    })
}

#[tauri::command]
pub async fn api_get_grade<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    grade_id: Option<String>,
) -> Result<GradeResponse, String> {
    let pool = state.db_manager.pool();

    let grade = if let Some(gid) = grade_id {
        GradeRepository::get_by_id(pool, &gid).await
    } else {
        GradeRepository::get_by_meeting(pool, &meeting_id).await
    };

    match grade {
        Ok(Some(g)) => {
            let result = g
                .result
                .as_ref()
                .and_then(|r| serde_json::from_str::<serde_json::Value>(r).ok());

            Ok(GradeResponse {
                id: g.id,
                status: g.status,
                meeting_id: g.meeting_id,
                result,
                error: g.error,
            })
        }
        Ok(None) => Ok(GradeResponse {
            id: String::new(),
            status: "idle".to_string(),
            meeting_id,
            result: None,
            error: None,
        }),
        Err(e) => {
            error!("Failed to get grade: {}", e);
            Err(format!("Failed to get grade: {}", e))
        }
    }
}
