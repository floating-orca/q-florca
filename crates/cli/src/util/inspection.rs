use anyhow::Result;
use chrono::{DateTime, TimeDelta, Utc};
use colored::Colorize;
use florca_core::driver::DriverErrorDetails;
use florca_core::http::{EngineUrl, RequestBuilderExt};
use florca_core::inspection::{Inspection, InspectionEntry, RunStatus};
use florca_core::run::LatestOrRunId;
use reqwest::blocking::Client;
use serde_json::Value;

/// # Errors
///
/// This function will return an error if the request to the server fails, the server returns an error, or the response cannot be parsed.
pub fn get_inspection(latest_or_run_id: &LatestOrRunId) -> Result<Inspection> {
    let url = EngineUrl::path(&[&latest_or_run_id.to_string(), "status"]);
    let response = Client::new().get(url).with_basic_auth_from_env().send()?;
    if let Err(e) = response.error_for_status_ref() {
        let text = response.text()?;
        if text.is_empty() {
            anyhow::bail!(e);
        }
        anyhow::bail!(text);
    }
    let inspection = response.json::<Inspection>()?;
    Ok(inspection)
}

#[derive(Debug)]
pub struct InspectDisplayOptions {
    pub show_inputs: bool,
    pub show_params: bool,
    pub show_outputs: bool,
}

pub fn print_inspection(inspection: &Inspection, inspect_display_options: &InspectDisplayOptions) {
    let lines = inspection_lines(inspection, inspect_display_options);
    println!("{}", lines.join("\n"));
}

fn inspection_lines(
    inspection: &Inspection,
    inspect_display_options: &InspectDisplayOptions,
) -> Vec<String> {
    let mut lines = Vec::new();
    let success = inspection.run_status == RunStatus::Success;
    lines.push(format!("Success: {success}"));
    if success {
        if let Some(v) = &inspection.output {
            lines.push(format!("Output: {v}"));
        }
    } else {
        let error_details = inspection
            .output
            .clone()
            .and_then(|v| serde_json::from_value::<DriverErrorDetails>(v).ok());
        if let Some(error_details) = error_details {
            lines.push(format!("Error: {}", error_details.message));
        } else {
            lines.push("Error: Unknown error".to_string());
        }
    }
    let workflow_line = workflow_line(inspection, inspect_display_options);
    lines.push(workflow_line);
    let root_entry: Vec<&InspectionEntry> = inspection.root.iter().collect();
    extend_with_entries_lines(&root_entry, 0, false, inspect_display_options, lines)
}

fn workflow_line(
    inspection: &Inspection,
    inspect_display_options: &InspectDisplayOptions,
) -> String {
    let mut line = format!("Workflow: {}", &inspection.deployment_name);
    line = extend_with_start_time(&line, &inspection.start_time);
    line =
        extend_with_end_time_and_delta(&line, &inspection.start_time, inspection.end_time.as_ref());
    if inspect_display_options.show_inputs && inspection.input != Value::Null {
        line = extend_with_input(&line, &inspection.input);
    }
    line
}

fn extend_with_entries_lines(
    entries: &[&InspectionEntry],
    indent: usize,
    is_next: bool,
    inspect_display_options: &InspectDisplayOptions,
    mut lines: Vec<String>,
) -> Vec<String> {
    for entry in entries {
        let mut line = "  ".repeat(indent)
            + &format!(
                "{} {}",
                if is_next { "|" } else { "+" },
                entry.function_name
            );
        line = extend_with_start_time(&line, &entry.start_time);
        line = extend_with_end_time_and_delta(&line, &entry.start_time, entry.end_time.as_ref());
        if inspect_display_options.show_inputs && entry.input != Value::Null {
            line = extend_with_input(&line, &entry.input);
        }
        if inspect_display_options.show_params && entry.params != Value::Null {
            line = extend_with_params(&line, &entry.params);
        }
        if inspect_display_options.show_outputs
            && let Some(v) = &entry.output
            && v != &Value::Null
        {
            line = extend_with_output(&line, v);
        }
        lines.push(line);
        let child_entries: Vec<&InspectionEntry> = entry.children.iter().collect();
        lines = extend_with_entries_lines(
            &child_entries,
            indent + 1,
            false,
            inspect_display_options,
            lines,
        );
        if let Some(next) = &entry.next {
            lines =
                extend_with_entries_lines(&[next], indent, true, inspect_display_options, lines);
        }
    }
    lines
}

fn extend_with_start_time(line: &str, start_time: &DateTime<Utc>) -> String {
    let start_time = format_date_time_str(start_time);
    format!("{} {}", &line, start_time.blue())
}

fn extend_with_end_time_and_delta(
    line: &str,
    start_time: &DateTime<Utc>,
    end_time: Option<&DateTime<Utc>>,
) -> String {
    if let Some(end_time) = end_time {
        let delta =
            TimeDelta::milliseconds(end_time.timestamp_millis() - start_time.timestamp_millis());
        format!(
            "{} {} {}",
            &line,
            format_date_time_str(end_time).red(),
            format!("({delta})").green(),
        )
    } else {
        format!("{} {} {}", &line, "(?)".red(), "(-)".green())
    }
}

fn format_date_time_str(date_time: &DateTime<Utc>) -> String {
    let date_time = date_time
        .with_timezone(&chrono::Local)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, false);
    let time = date_time.split_once('T').unwrap().1;
    format!("({time})")
}

fn extend_with_input(line: &str, input: &Value) -> String {
    format!("{} {}", &line, input.to_string().yellow())
}

fn extend_with_params(line: &str, params: &Value) -> String {
    format!("{} {}", &line, params.to_string().cyan())
}

fn extend_with_output(line: &str, output: &Value) -> String {
    format!("{} {}", &line, output.to_string().magenta())
}

#[cfg(test)]
mod tests {
    use super::*;
    use florca_core::{invocation::InvocationId, run::RunId};
    use serde_json::json;

    #[test]
    #[allow(clippy::too_many_lines)]
    fn test_build_inspection() {
        let expected: &str = r#"Success: true
Output: "1, 2"
Workflow: sequential-map (09:52:01.908+02:00) (09:52:04.339+02:00) (PT2.431S) 2
+ start (09:52:02.038+02:00) (09:52:02.057+02:00) (PT0.019S) 2 {"next":{"sequentialMap":{"fn":"addOne","reduce":"join"}},"payload":[0,1]}
| sequentialMap (09:52:02.069+02:00) (09:52:04.225+02:00) (PT2.156S) [0,1] {"fn":"addOne","reduce":"join"} {"next":"join","payload":[1,2]}
  + addOne (09:52:02.083+02:00) (09:52:03.098+02:00) (PT1.015S) 0 {"payload":1}
  + addOne (09:52:03.141+02:00) (09:52:04.184+02:00) (PT1.043S) 1 {"payload":2}
| join (09:52:04.267+02:00) (09:52:04.312+02:00) (PT0.045S) [1,2] {"payload":"1, 2"}"#;
        let inspection = Inspection {
            run_id: RunId::new(42),
            deployment_name: "sequential-map".into(),
            entry_point: "start".into(),
            run_status: RunStatus::Success,
            start_time: DateTime::parse_from_rfc3339("2023-10-01T09:52:01.908+02:00")
                .unwrap()
                .with_timezone(&Utc),
            end_time: Some(
                DateTime::parse_from_rfc3339("2023-10-01T09:52:04.339+02:00")
                    .unwrap()
                    .with_timezone(&Utc),
            ),
            input: json!(2),
            output: Some(json!("1, 2")),
            root: Some(InspectionEntry {
                invocation_id: InvocationId::new(),
                function_name: "start".into(),
                start_time: DateTime::parse_from_rfc3339("2023-10-01T09:52:02.038+02:00")
                    .unwrap()
                    .with_timezone(&Utc),
                end_time: Some(
                    DateTime::parse_from_rfc3339("2023-10-01T09:52:02.057+02:00")
                        .unwrap()
                        .with_timezone(&Utc),
                ),
                input: json!(2),
                params: Value::Null,
                output: Some(
                    json!({"next": {"sequentialMap": {"fn": "addOne", "reduce": "join"}}, "payload": [0, 1]}),
                ),
                children: Vec::new(),
                next: Some(Box::new(InspectionEntry {
                    invocation_id: InvocationId::new(),
                    function_name: "sequentialMap".into(),
                    start_time: DateTime::parse_from_rfc3339("2023-10-01T09:52:02.069+02:00")
                        .unwrap()
                        .with_timezone(&Utc),
                    end_time: Some(
                        DateTime::parse_from_rfc3339("2023-10-01T09:52:04.225+02:00")
                            .unwrap()
                            .with_timezone(&Utc),
                    ),
                    input: json!([0, 1]),
                    params: json!({"fn": "addOne", "reduce": "join"}),
                    output: Some(json!({"next": "join", "payload": [1, 2]})),
                    children: vec![
                        InspectionEntry {
                            invocation_id: InvocationId::new(),
                            function_name: "addOne".into(),
                            start_time: DateTime::parse_from_rfc3339(
                                "2023-10-01T09:52:02.083+02:00",
                            )
                            .unwrap()
                            .with_timezone(&Utc),
                            end_time: Some(
                                DateTime::parse_from_rfc3339("2023-10-01T09:52:03.098+02:00")
                                    .unwrap()
                                    .with_timezone(&Utc),
                            ),
                            input: json!(0),
                            params: Value::Null,
                            output: Some(json!({"payload": 1})),
                            children: Vec::new(),
                            next: None,
                        },
                        InspectionEntry {
                            invocation_id: InvocationId::new(),
                            function_name: "addOne".into(),
                            start_time: DateTime::parse_from_rfc3339(
                                "2023-10-01T09:52:03.141+02:00",
                            )
                            .unwrap()
                            .with_timezone(&Utc),
                            end_time: Some(
                                DateTime::parse_from_rfc3339("2023-10-01T09:52:04.184+02:00")
                                    .unwrap()
                                    .with_timezone(&Utc),
                            ),
                            input: json!(1),
                            params: Value::Null,
                            output: Some(json!({"payload": 2})),
                            children: Vec::new(),
                            next: None,
                        },
                    ],
                    next: Some(Box::new(InspectionEntry {
                        invocation_id: InvocationId::new(),
                        function_name: "join".into(),
                        start_time: DateTime::parse_from_rfc3339("2023-10-01T09:52:04.267+02:00")
                            .unwrap()
                            .with_timezone(&Utc),
                        end_time: Some(
                            DateTime::parse_from_rfc3339("2023-10-01T09:52:04.312+02:00")
                                .unwrap()
                                .with_timezone(&Utc),
                        ),
                        input: json!([1, 2]),
                        params: Value::Null,
                        output: Some(json!({"payload": "1, 2"})),
                        children: Vec::new(),
                        next: None,
                    })),
                })),
            }),
        };
        let options = InspectDisplayOptions {
            show_inputs: true,
            show_params: true,
            show_outputs: true,
        };
        colored::control::set_override(false);
        let tz = std::env::var("TZ");
        unsafe { std::env::set_var("TZ", "CEST-2") };
        let result = inspection_lines(&inspection, &options);
        if let Ok(tz) = tz {
            unsafe { std::env::set_var("TZ", tz) };
        } else {
            unsafe { std::env::remove_var("TZ") };
        }
        assert_eq!(result.join("\n"), expected);
    }
}
