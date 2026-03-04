use crate::database::models::Transcript;
use crate::database::repositories::{
    meeting::MeetingsRepository, setting::SettingsRepository,
    summary::SummaryProcessesRepository, transcript::TranscriptsRepository,
};
use sqlx::SqlitePool;
use tracing::info;

/// Truncates text to fit within a character budget.
/// Keeps the beginning of the text and appends a truncation notice.
fn truncate_text(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        return text.to_string();
    }
    let truncated = &text[..max_chars];
    // Try to break at a newline boundary to avoid cutting mid-sentence
    let break_point = truncated.rfind('\n').unwrap_or(max_chars);
    format!(
        "{}\n\n[Transcript truncated — {} of {} characters shown]",
        &text[..break_point],
        break_point,
        text.len()
    )
}

/// Builds a system prompt containing meeting context for single-meeting chat.
/// `max_context_chars` limits the transcript portion to prevent exceeding model context windows.
pub async fn build_single_meeting_context(
    pool: &SqlitePool,
    meeting_id: &str,
    max_context_chars: Option<usize>,
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

    // Get user display name for speaker labels
    let user_name = SettingsRepository::get_user_display_name(pool)
        .await
        .ok()
        .flatten();

    let transcript_text = format_transcripts_with_speakers(&transcripts, user_name.as_deref());

    // Apply truncation if specified
    let transcript_text = match max_context_chars {
        Some(max) => truncate_text(&transcript_text, max),
        None => transcript_text,
    };

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
    max_context_chars: Option<usize>,
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

    // Apply per-result truncation if max_context_chars is set
    let per_result_max = max_context_chars.map(|m| m / all_results.len().max(1));

    for result in &all_results {
        let match_text = match per_result_max {
            Some(max) => truncate_text(&result.match_context, max),
            None => result.match_context.clone(),
        };
        context.push_str(&format!(
            "## Meeting: {} ({})\n{}\n\n",
            result.title, result.timestamp, match_text
        ));
    }

    context.push_str(
        "Answer based only on the meeting excerpts above. Reference which meeting(s) the information comes from.",
    );

    Ok(context)
}

/// Format transcripts with speaker labels using user's display name.
pub fn format_transcripts_with_speakers(
    transcripts: &[Transcript],
    user_display_name: Option<&str>,
) -> String {
    transcripts
        .iter()
        .map(|t| {
            let time_prefix = if let Some(start) = t.audio_start_time {
                let mins = (start / 60.0) as u32;
                let secs = (start % 60.0) as u32;
                format!("[{:02}:{:02}]", mins, secs)
            } else {
                format!("[{}]", t.timestamp)
            };

            let speaker_label = match t.speaker.as_deref() {
                Some("mic") => user_display_name.unwrap_or("Me"),
                Some("system") => "Other Participant",
                Some(other) => other,
                None => "", // No speaker info available (legacy transcripts)
            };

            if speaker_label.is_empty() {
                format!("{} {}", time_prefix, t.transcript)
            } else {
                format!("{} {}: {}", time_prefix, speaker_label, t.transcript)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Legacy format without speaker labels
fn format_transcripts(transcripts: &[Transcript]) -> String {
    format_transcripts_with_speakers(transcripts, None)
}
