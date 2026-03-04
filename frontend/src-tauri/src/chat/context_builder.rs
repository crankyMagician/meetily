use crate::database::models::Transcript;
use crate::database::repositories::{
    meeting::MeetingsRepository, summary::SummaryProcessesRepository,
    transcript::TranscriptsRepository,
};
use sqlx::SqlitePool;
use tracing::info;

/// Builds a system prompt containing meeting context for single-meeting chat.
pub async fn build_single_meeting_context(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<String, String> {
    // Get meeting metadata
    let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to get meeting: {}", e))?
        .ok_or_else(|| "Meeting not found".to_string())?;

    // Get transcripts
    let transcripts = TranscriptsRepository::get_all_for_meeting(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to get transcripts: {}", e))?;

    let transcript_text = format_transcripts(&transcripts);

    // Get summary if available
    let summary_text = match SummaryProcessesRepository::get_summary_data(pool, meeting_id).await {
        Ok(Some(process)) if process.status == "completed" => {
            process.result.and_then(|r| {
                serde_json::from_str::<serde_json::Value>(&r)
                    .ok()
                    .and_then(|v| v.get("markdown").and_then(|m| m.as_str().map(String::from)))
            })
        }
        _ => None,
    };

    let context_info = match (&meeting.context_type, &meeting.context_notes) {
        (Some(ct), Some(cn)) => format!("\nMeeting Type: {}\nContext: {}", ct, cn),
        (Some(ct), None) => format!("\nMeeting Type: {}", ct),
        _ => String::new(),
    };

    let summary_section = summary_text
        .map(|s| format!("\n\n## Meeting Summary\n{}", s))
        .unwrap_or_default();

    Ok(format!(
        r#"You are a helpful meeting assistant. Answer questions about the following meeting.

## Meeting: {}{}
## Date: {}
{}
## Transcript
{}

Answer based only on information from the transcript and summary above. If the answer isn't in the meeting data, say so."#,
        meeting.title,
        context_info,
        meeting.created_at.0.format("%Y-%m-%d %H:%M"),
        summary_section,
        transcript_text,
    ))
}

/// Builds a system prompt for cross-meeting chat by searching transcripts.
pub async fn build_cross_meeting_context(
    pool: &SqlitePool,
    user_query: &str,
) -> Result<String, String> {
    // Extract keywords from the query for search
    let keywords: Vec<&str> = user_query
        .split_whitespace()
        .filter(|w| w.len() > 3)
        .take(5)
        .collect();

    let mut all_results = Vec::new();

    for keyword in &keywords {
        if let Ok(results) = TranscriptsRepository::search_transcripts(pool, keyword).await {
            for result in results {
                if !all_results.iter().any(|r: &crate::api::TranscriptSearchResult| r.id == result.id && r.match_context == result.match_context) {
                    all_results.push(result);
                }
            }
        }
    }

    // Limit to top 10 results
    all_results.truncate(10);

    if all_results.is_empty() {
        return Ok(
            "You are a helpful meeting assistant. The user is asking about meetings, but no relevant transcripts were found. Let them know no matching content was found.".to_string()
        );
    }

    let mut context = String::from(
        "You are a helpful meeting assistant. Answer questions using the following excerpts from multiple meetings.\n\n",
    );

    for result in &all_results {
        context.push_str(&format!(
            "## Meeting: {} ({})\n{}\n\n",
            result.title, result.timestamp, result.match_context
        ));
    }

    context.push_str(
        "Answer based only on the meeting excerpts above. Reference which meeting(s) the information comes from.",
    );

    Ok(context)
}

fn format_transcripts(transcripts: &[Transcript]) -> String {
    transcripts
        .iter()
        .map(|t| {
            if let Some(start) = t.audio_start_time {
                let mins = (start / 60.0) as u32;
                let secs = (start % 60.0) as u32;
                format!("[{:02}:{:02}] {}", mins, secs, t.transcript)
            } else {
                format!("[{}] {}", t.timestamp, t.transcript)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
