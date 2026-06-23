use uuid::Uuid;

use super::projects::{AppState, Project};

/// Create a sample project with pre-built interview transcripts, codes, and annotations.
pub async fn projects_create_sample_internal(
    state: &AppState,
    target_dir: String,
) -> Result<Project, String> {
    // Create project via the normal flow (validates name internally)
    let project = super::projects::projects_create_internal(
        state,
        "Sample Project".to_string(),
        Some("A sample qualitative data analysis project with interview transcripts and starter codes.".to_string()),
        target_dir,
    )
    .await?;

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Seed sample interview transcripts
    let interviews: Vec<(&str, &str)> = vec![
        ("Participant A — Work-Life Balance", "I find it really hard to switch off after work. My laptop is always open, and I'll check emails at 10pm without even thinking about it. The pandemic made it worse because now there's no physical separation between my office and my living room. I used to have a commute that gave me time to decompress, but now I just close my laptop and I'm already home. My manager expects quick responses on Slack even after hours, and I feel guilty if I don't reply. I've tried setting boundaries, like no email after 7pm, but I always break my own rules. It's affecting my sleep too — I'll wake up at 3am worrying about a presentation or a deadline. I know it's not sustainable, but I don't know how to change the culture on my team."),
        ("Participant A — Team Dynamics", "My team is really collaborative, which I love. We have daily standups that actually feel useful, not just a status update ritual. People share their blockers honestly and others jump in to help. But there's this unspoken competition too — whoever responds fastest on Slack or sends the most pull requests gets subtle recognition from leadership. It pushes people to work longer hours even though nobody explicitly says to. I've noticed the junior devs especially feel this pressure. They see the senior engineers working late and think that's the expectation. I try to mentor them and tell them it's okay to log off, but I'm not exactly modeling that behavior myself."),
        ("Participant B — Remote Onboarding", "Starting a new job remotely was incredibly disorienting. I'd never met any of my colleagues in person, and trying to learn the codebase through screen shares was exhausting. The documentation was decent, but there's so much tacit knowledge that you normally pick up just by sitting near people and overhearing conversations. I felt isolated for the first three months. My onboarding buddy was great — she set up daily 30-minute calls for the first two weeks — but it's not the same as being able to tap someone on the shoulder. I almost quit at the four-month mark, honestly. What kept me was the work itself — the problems are genuinely interesting — and eventually I built enough relationships through pair programming sessions that I started to feel like part of the team."),
        ("Participant C — Career Growth", "I've been at the company for four years now, and I'm starting to wonder what's next. I've gone from junior to mid-level to senior, but the path beyond that is really unclear. There's no formal promotion framework — it's all based on manager advocacy. My current manager is supportive, but she's also overworked and doesn't have time to build a strong case for me. I've seen people get promoted who are less technical but better at self-promotion, and that frustrates me. I don't want to become someone who's constantly marketing myself internally. I want to grow technically — maybe into an architect role or a deep specialist track. But those roles don't really exist in our org structure. I've started looking at other companies, which feels disloyal, but I don't see how to advance here."),
    ];

    for (i, (title, text)) in interviews.iter().enumerate() {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO document (id, project_id, title, file_format, plain_text, text_hash, extractor_id, word_count, sort_order) \
             VALUES (?, ?, ?, 'txt', ?, '', 'sample-project', ?, ?)",
        )
        .bind(&id)
        .bind(&project.id)
        .bind(title)
        .bind(text)
        .bind(text.split_whitespace().count() as i64)
        .bind(i as i64)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to insert sample document: {}", e))?;
    }

    // Seed code tree — two-level hierarchy of thematic codes
    let codes_data: Vec<(&str, Option<&str>, &str)> = vec![
        ("Work-Life Balance", None, "#6366f1"),
        ("Team Dynamics", None, "#ec4899"),
        ("Career Development", None, "#f59e0b"),
        ("Wellbeing", None, "#10b981"),
        ("Communication", None, "#3b82f6"),
        ("Boundary Setting", Some("Work-Life Balance"), "#8b5cf6"),
        ("After-Hours Work", Some("Work-Life Balance"), "#ef4444"),
        ("Remote Work Impact", Some("Work-Life Balance"), "#14b8a6"),
        ("Collaboration", Some("Team Dynamics"), "#f97316"),
        ("Competition", Some("Team Dynamics"), "#06b6d4"),
        ("Mentorship", Some("Team Dynamics"), "#84cc16"),
        ("Promotion Process", Some("Career Development"), "#d946ef"),
        ("Skill Growth", Some("Career Development"), "#64748b"),
        ("Job Satisfaction", Some("Career Development"), "#e11d48"),
        ("Stress & Anxiety", Some("Wellbeing"), "#0ea5e9"),
        ("Sleep Issues", Some("Wellbeing"), "#a855f7"),
    ];

    let mut code_ids: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // First pass: create root codes
    for (name, parent, color) in &codes_data {
        if parent.is_none() {
            let id = Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO code (id, project_id, name, color) VALUES (?, ?, ?, ?)")
                .bind(&id)
                .bind(&project.id)
                .bind(name)
                .bind(color)
                .execute(pool)
                .await
                .map_err(|e| format!("{}", e))?;
            sqlx::query("INSERT INTO code_closure (ancestor, descendant, depth) VALUES (?, ?, 0)")
                .bind(&id)
                .bind(&id)
                .execute(pool)
                .await
                .map_err(|e| format!("{}", e))?;
            code_ids.insert(name.to_string(), id);
        }
    }

    // Second pass: create child codes
    for (name, parent_name, color) in &codes_data {
        if let Some(parent_name) = parent_name {
            let parent_id = code_ids.get(*parent_name)
                .ok_or(format!("Parent code '{}' not found", parent_name))?;
            let id = Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO code (id, project_id, name, color) VALUES (?, ?, ?, ?)")
                .bind(&id)
                .bind(&project.id)
                .bind(name)
                .bind(color)
                .execute(pool)
                .await
                .map_err(|e| format!("{}", e))?;
            sqlx::query("INSERT INTO code_closure (ancestor, descendant, depth) VALUES (?, ?, 0)")
                .bind(&id)
                .bind(&id)
                .execute(pool)
                .await
                .map_err(|e| format!("{}", e))?;
            sqlx::query(
                "INSERT INTO code_closure (ancestor, descendant, depth) \
                 SELECT ancestor, ?, depth + 1 FROM code_closure WHERE descendant = ?",
            )
            .bind(&id)
            .bind(parent_id)
            .execute(pool)
            .await
            .map_err(|e| format!("{}", e))?;
            code_ids.insert(name.to_string(), id);
        }
    }

    // Seed annotations — keyword-based character positions
    let annotations_data: Vec<(&str, &str, usize, usize)> = vec![
        ("Participant A — Work-Life Balance", "Boundary Setting", 410, 465),
        ("Participant A — Work-Life Balance", "After-Hours Work", 51, 85),
        ("Participant A — Work-Life Balance", "Remote Work Impact", 154, 220),
        ("Participant A — Work-Life Balance", "Stress & Anxiety", 580, 650),
        ("Participant A — Work-Life Balance", "Sleep Issues", 530, 565),
        ("Participant A — Team Dynamics", "Collaboration", 14, 110),
        ("Participant A — Team Dynamics", "Competition", 175, 295),
        ("Participant A — Team Dynamics", "Mentorship", 450, 585),
        ("Participant B — Remote Onboarding", "Remote Work Impact", 0, 180),
        ("Participant B — Remote Onboarding", "Mentorship", 340, 430),
        ("Participant B — Remote Onboarding", "Job Satisfaction", 585, 720),
        ("Participant B — Remote Onboarding", "Stress & Anxiety", 190, 290),
        ("Participant C — Career Growth", "Promotion Process", 120, 300),
        ("Participant C — Career Growth", "Skill Growth", 400, 520),
        ("Participant C — Career Growth", "Job Satisfaction", 0, 115),
        ("Participant C — Career Growth", "Competition", 290, 400),
    ];

    for (doc_title, code_name, start, end) in &annotations_data {
        // Find document by title
        let doc_row: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM document WHERE title = ?",
        )
        .bind(doc_title)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        let Some((doc_id,)) = doc_row else { continue };
        let Some(code_id) = code_ids.get(*code_name) else { continue };

        let sel_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO selection (id, document_id, code_id, selection_type) VALUES (?, ?, ?, 'text')",
        )
        .bind(&sel_id)
        .bind(&doc_id)
        .bind(code_id)
        .execute(pool)
        .await
        .map_err(|e| format!("{}", e))?;

        sqlx::query(
            "INSERT INTO text_selection (selection_id, start_char, end_char) VALUES (?, ?, ?)",
        )
        .bind(&sel_id)
        .bind(*start as i64)
        .bind(*end as i64)
        .execute(pool)
        .await
        .map_err(|e| format!("{}", e))?;
    }

    drop(pool_guard);

    Ok(project)
}

#[tauri::command]
pub async fn projects_create_sample(
    _app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    target_dir: String,
) -> Result<Project, String> {
    projects_create_sample_internal(&state, target_dir).await
}
