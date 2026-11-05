//! « Synthèse » workbook, cell for cell like the ExcelJS version.

use rust_xlsxwriter::{Color, DocProperties, Format, FormatAlign, FormatPattern, Workbook, XlsxError};

use super::CompanyMonth;
use crate::status::{MONTH_NAMES, code, color, days_in_month};

pub fn build(data: &CompanyMonth) -> Result<Vec<u8>, XlsxError> {
    let mut wb = Workbook::new();
    wb.set_properties(&DocProperties::new().set_author("Presencia"));
    let ws = wb.add_worksheet();
    ws.set_name("Synthèse")?;
    ws.set_freeze_panes(3, 1)?;

    let days = days_in_month(data.year, data.month) as u16;
    let title = format!(
        "Présences — {} — {} {}",
        data.company_name,
        MONTH_NAMES[data.month as usize - 1],
        data.year
    );
    ws.merge_range(0, 0, 0, days * 2, &title, &Format::new().set_bold().set_font_size(14))?;
    ws.set_row_height(0, 22)?;

    let center = Format::new().set_align(FormatAlign::Center);
    let day_fmt = center.clone().set_bold();
    let period_fmt = center.clone().set_italic().set_font_size(9);
    ws.write_string(1, 0, "Cadre")?;
    for d in 1..=days {
        let col = 1 + (d - 1) * 2;
        ws.merge_range(1, col, 1, col + 1, "", &day_fmt)?;
        ws.write_number_with_format(1, col, f64::from(d), &day_fmt)?;
        ws.write_string_with_format(2, col, "AM", &period_fmt)?;
        ws.write_string_with_format(2, col + 1, "PM", &period_fmt)?;
    }

    ws.set_column_width(0, 26)?;
    for col in 1..=days * 2 {
        ws.set_column_width(col, 5)?;
    }

    let mut row = 3u32;
    for cadre in &data.cadres {
        ws.write_string(row, 0, &cadre.full_name)?;
        for d in 1..=days {
            let date = data.date(u32::from(d));
            for (i, period) in ["AM", "PM"].iter().enumerate() {
                let col = 1 + (d - 1) * 2 + i as u16;
                match cadre.status(&date, period) {
                    Some(st) => {
                        let fmt = center
                            .clone()
                            .set_pattern(FormatPattern::Solid)
                            .set_background_color(Color::RGB(color(st)))
                            .set_font_color(Color::White)
                            .set_bold()
                            .set_font_size(9);
                        ws.write_string_with_format(row, col, code(st), &fmt)?;
                    }
                    None => {
                        ws.write_blank(row, col, &center)?;
                    }
                }
            }
        }
        row += 1;
    }

    // Two rows below the table (ExcelJS: rowCount + 2).
    ws.write_string_with_format(
        row + 1,
        0,
        "Légende : P = Présent · NP = Non-présent · CP = Congé · RTT = RTT",
        &Format::new().set_italic().set_font_size(9),
    )?;
    wb.save_to_buffer()
}
