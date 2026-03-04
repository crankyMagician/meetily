/// Builds the system prompt for communication grading based on meeting context.
///
/// # Arguments
/// * `context_type` - Meeting type (e.g., "Sales Call", "Interview")
/// * `context_notes` - Additional context notes
/// * `grade_target` - Who to grade (e.g., "Sam", "the participant")
/// * `focus_areas` - Specific areas to focus on (e.g., "pricing objection handling")
/// * `user_role` - User's role in the meeting (e.g., "Sales rep", "Interviewer")
pub fn build_grading_prompt(
    context_type: Option<&str>,
    context_notes: Option<&str>,
    grade_target: Option<&str>,
    focus_areas: Option<&str>,
    user_role: Option<&str>,
) -> String {
    let ctx = context_type.unwrap_or("General");
    let target = grade_target.unwrap_or("the participant");

    let notes_section = context_notes
        .filter(|n| !n.is_empty())
        .map(|n| format!("\nAdditional Context: {}", n))
        .unwrap_or_default();

    let role_section = user_role
        .filter(|r| !r.is_empty())
        .map(|r| format!("\n{} is the {}.", target, r))
        .unwrap_or_default();

    let focus_section = focus_areas
        .filter(|f| !f.is_empty())
        .map(|f| format!("\n\n## Focus Areas\nPay special attention to: {}", f))
        .unwrap_or_default();

    let context_criteria = match ctx.to_lowercase().as_str() {
        "sales call" => r#"
## Context-Specific Criteria (Sales Call):
- Discovery Questions (1-10): Asks open-ended questions to uncover needs
- Objection Handling (1-10): Addresses concerns with empathy and evidence
- Value Articulation (1-10): Clearly communicates product/service value
- Closing Technique (1-10): Appropriate use of closing strategies"#,
        "interview" => r#"
## Context-Specific Criteria (Interview):
- STAR Method (1-10): Uses Situation-Task-Action-Result structure
- Question Quality (1-10): Asks insightful, relevant questions
- Rapport Building (1-10): Establishes connection and trust
- Self-Presentation (1-10): Presents experience clearly and confidently"#,
        "team standup" => r#"
## Context-Specific Criteria (Team Standup):
- Update Brevity (1-10): Keeps updates concise and focused
- Blocker Clarity (1-10): Clearly identifies and communicates blockers
- Action Items (1-10): Defines clear next steps
- Team Awareness (1-10): Shows awareness of team dependencies"#,
        "presentation" => r#"
## Context-Specific Criteria (Presentation):
- Engagement (1-10): Keeps audience interested and involved
- Structure (1-10): Logical flow with clear beginning, middle, end
- Audience Awareness (1-10): Adapts content to audience level
- Visual Support (1-10): Effective use of slides/demos if applicable"#,
        "1-on-1" => r#"
## Context-Specific Criteria (1-on-1):
- Feedback Quality (1-10): Provides specific, actionable feedback
- Active Listening (1-10): Demonstrates understanding of the other person
- Goal Alignment (1-10): Connects discussion to goals and growth
- Follow-up Clarity (1-10): Sets clear action items and timelines"#,
        "personal" => r#"
## Context-Specific Criteria (Personal):
- Empathy (1-10): Shows understanding of others' feelings
- Emotional Awareness (1-10): Recognizes and manages emotions
- Boundary Setting (1-10): Respectfully sets and maintains boundaries
- Supportiveness (1-10): Provides appropriate support and encouragement"#,
        _ => r#"
## Context-Specific Criteria (General):
- Engagement (1-10): Keeps the conversation productive
- Adaptability (1-10): Adjusts communication style as needed
- Follow-through (1-10): Addresses topics completely
- Professionalism (1-10): Maintains appropriate tone and conduct"#,
    };

    format!(
        r#"You are an expert communication coach. Analyze the following meeting transcript and grade {target}'s communication skills.{role_section}

Meeting Type: {ctx}{notes_section}
{focus_section}
## Universal Criteria (always evaluate):
- Speaking Clarity (1-10): Clear ideas, minimal filler words, structured thoughts
- Conciseness (1-10): Gets to the point, avoids repetition
- Active Listening (1-10): Acknowledges others, builds on their points
- Overall Effectiveness (1-10): How well communication served the meeting's purpose
{context_criteria}

Transcript segments are labeled with speaker names. Focus your grading on {target}'s contributions only.

Return ONLY valid JSON in this exact format (no markdown fencing):
{{
  "overall_score": <number 1-10>,
  "categories": [
    {{"name": "<category name>", "score": <1-10>, "feedback": "<brief feedback>"}}
  ],
  "strengths": ["<strength 1>", "<strength 2>"],
  "areas_for_improvement": ["<area 1>", "<area 2>"],
  "actionable_tips": ["<tip 1>", "<tip 2>", "<tip 3>"]
}}"#
    )
}
