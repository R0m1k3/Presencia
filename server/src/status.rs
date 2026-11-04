pub const STATUSES: [&str; 4] = ["present", "absent", "conge", "rtt"];
pub const PERIODS: [&str; 2] = ["AM", "PM"];

pub const MONTH_NAMES: [&str; 12] = [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre",
];

pub fn label(status: &str) -> &'static str {
    match status {
        "present" => "Présent",
        "absent" => "Non-présent",
        "conge" => "Congé",
        _ => "RTT",
    }
}

pub fn code(status: &str) -> &'static str {
    match status {
        "present" => "P",
        "absent" => "NP",
        "conge" => "CP",
        _ => "RTT",
    }
}

/// RGB of each status (Excel fill and PDF label colour).
pub fn color(status: &str) -> u32 {
    match status {
        "present" => 0x2E7D32,
        "absent" => 0xC62828,
        "conge" => 0xEF6C00,
        _ => 0x1565C0,
    }
}

pub fn days_in_month(year: i32, month: i32) -> u32 {
    let (ny, nm) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let first_next = chrono::NaiveDate::from_ymd_opt(ny, nm as u32, 1).unwrap();
    chrono::Datelike::day(&first_next.pred_opt().unwrap())
}
