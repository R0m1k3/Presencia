//! Monthly summary PDF, drawn like the pdfkit version: A4, Helvetica (one
//! of the standard PDF fonts, not embedded), same metrics and positions.
//! Positions are pdfkit's (origin top-left), converted when written.

use std::fmt::Write as _;

use super::CompanyMonth;
use crate::status::{MONTH_NAMES, color, days_in_month, label};

const PAGE_W: f64 = 595.28;
const PAGE_H: f64 = 841.89;
const MARGIN: f64 = 40.0;
/// Helvetica AFM metrics (as read by pdfkit).
const ASCENDER: f64 = 718.0;
const DESCENDER: f64 = -207.0;
const LINE_GAP: f64 = 231.0;
/// Glyph widths of WinAnsi codes 32..=255, in 1/1000 em.
const WIDTHS: [u16; 224] = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,500,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];

/// Unicode → WinAnsiEncoding byte; `?` when the font has no glyph.
fn win_ansi(c: char) -> u8 {
    let u = c as u32;
    match u {
        0x20..=0x7E | 0xA0..=0xFF => u as u8,
        _ => match c {
            '€' => 0x80, '‚' => 0x82, 'ƒ' => 0x83, '„' => 0x84, '…' => 0x85, '†' => 0x86, '‡' => 0x87,
            'ˆ' => 0x88, '‰' => 0x89, 'Š' => 0x8A, '‹' => 0x8B, 'Œ' => 0x8C, 'Ž' => 0x8E, '‘' => 0x91,
            '’' => 0x92, '“' => 0x93, '”' => 0x94, '•' => 0x95, '–' => 0x96, '—' => 0x97, '˜' => 0x98,
            '™' => 0x99, 'š' => 0x9A, '›' => 0x9B, 'œ' => 0x9C, 'ž' => 0x9E, 'Ÿ' => 0x9F,
            _ => b'?',
        },
    }
}

fn width_of(s: &str, size: f64) -> f64 {
    s.chars().map(|c| f64::from(WIDTHS[usize::from(win_ansi(c)) - 32])).sum::<f64>() * size / 1000.0
}

/// `currentLineHeight(includeGap)`.
fn line_height(size: f64, gap: bool) -> f64 {
    (ASCENDER + if gap { LINE_GAP } else { 0.0 } - DESCENDER) / 1000.0 * size
}

fn rgb(hex: u32) -> String {
    let c = |shift: u32| f64::from((hex >> shift) & 0xFF) / 255.0;
    format!("{} {} {}", num(c(16)), num(c(8)), num(c(0)))
}

fn num(v: f64) -> String {
    let s = format!("{v:.3}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

/// Greedy word wrap at spaces, as pdfkit's line wrapper does for these texts.
fn wrap(text: &str, size: f64, width: f64) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in text.split(' ') {
        let candidate = if line.is_empty() { word.to_string() } else { format!("{line} {word}") };
        if !line.is_empty() && width_of(&candidate, size) > width {
            lines.push(std::mem::replace(&mut line, word.to_string()));
        } else {
            line = candidate;
        }
    }
    lines.push(line);
    lines
}

#[derive(Default)]
struct Doc {
    pages: Vec<String>,
    /// Flowing text cursor (pdfkit's doc.y).
    y: f64,
    size: f64,
}

impl Doc {
    fn new() -> Self {
        let mut d = Doc { size: 12.0, ..Default::default() };
        d.add_page();
        d
    }

    fn add_page(&mut self) {
        self.pages.push(String::new());
        self.y = MARGIN;
    }

    fn out(&mut self) -> &mut String {
        self.pages.last_mut().unwrap()
    }

    /// One line of text whose top is at `y`.
    fn text_at(&mut self, s: &str, x: f64, y: f64, size: f64, fill: u32) {
        let baseline = PAGE_H - y - ASCENDER / 1000.0 * size;
        let hex: String = s.chars().map(|c| format!("{:02X}", win_ansi(c))).collect();
        let color = rgb(fill);
        let _ = writeln!(self.out(), "BT {color} rg /F1 {} Tf {} {} Td <{hex}> Tj ET", num(size), num(x), num(baseline));
    }

    /// `doc.text(s)` in the flow at the left margin, moving the cursor down.
    fn flow(&mut self, s: &str, size: f64, fill: u32, underline: bool) {
        self.size = size;
        for line in wrap(s, size, PAGE_W - 2.0 * MARGIN) {
            let y = self.y;
            self.text_at(&line, MARGIN, y, size, fill);
            if underline {
                let lw = if size < 10.0 { 0.5 } else { (size / 10.0).floor() };
                let ly = PAGE_H - (y + line_height(size, false) - lw);
                let x2 = MARGIN + width_of(&line, size);
                let c = rgb(fill);
                let _ = writeln!(self.out(), "{c} RG {} w {} {} m {} {} l S", num(lw), num(MARGIN), num(ly), num(x2), num(ly));
            }
            self.y += line_height(size, true);
        }
    }

    fn move_down(&mut self, lines: f64) {
        self.y += line_height(self.size, true) * lines;
    }

    fn fill_rect(&mut self, x: f64, y: f64, w: f64, h: f64, fill: u32) {
        let c = rgb(fill);
        let _ = writeln!(self.out(), "{c} rg {} {} {} {} re f", num(x), num(PAGE_H - y - h), num(w), num(h));
    }

    fn stroke_rect(&mut self, x: f64, y: f64, w: f64, h: f64, stroke: u32) {
        let c = rgb(stroke);
        let _ = writeln!(self.out(), "{c} RG 1 w {} {} {} {} re S", num(x), num(PAGE_H - y - h), num(w), num(h));
    }

    fn finish(self) -> Vec<u8> {
        let mut objects: Vec<Vec<u8>> = Vec::new();
        let n = self.pages.len();
        // 1 catalog, 2 pages, 3 font, 4 info, then (page, content) pairs.
        objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
        let kids: Vec<String> = (0..n).map(|i| format!("{} 0 R", 5 + 2 * i)).collect();
        objects.push(format!("<< /Type /Pages /Count {n} /Kids [{}] >>", kids.join(" ")).into_bytes());
        objects.push(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_vec());
        objects.push(b"<< /Producer (Presencia) /Creator (Presencia) >>".to_vec());
        for (i, content) in self.pages.iter().enumerate() {
            objects.push(
                format!(
                    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
                    num(PAGE_W), num(PAGE_H), 6 + 2 * i
                )
                .into_bytes(),
            );
            let mut stream = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
            stream.extend_from_slice(content.as_bytes());
            stream.extend_from_slice(b"endstream");
            objects.push(stream);
        }
        let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let mut offsets = Vec::new();
        for (i, obj) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            pdf.extend_from_slice(obj);
            pdf.extend_from_slice(b"\nendobj\n");
        }
        let xref = pdf.len();
        let mut tail = format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1);
        for o in offsets {
            let _ = write!(tail, "{o:010} 00000 n \n");
        }
        let _ = write!(tail, "trailer\n<< /Size {} /Root 1 0 R /Info 4 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1);
        pdf.extend_from_slice(tail.as_bytes());
        pdf
    }
}

const DARK: u32 = 0x111111;
const NONE: u32 = 0x999999;

pub fn build(data: &CompanyMonth) -> Vec<u8> {
    let mut doc = Doc::new();
    let days = days_in_month(data.year, data.month);

    doc.flow("Presencia — Récapitulatif de présences", 18.0, DARK, false);
    doc.move_down(0.2);
    let subtitle = format!("{} — {} {}", data.company_name, MONTH_NAMES[data.month as usize - 1], data.year);
    doc.flow(&subtitle, 12.0, 0x444444, false);
    doc.move_down(1.0);

    for (idx, cadre) in data.cadres.iter().enumerate() {
        if idx > 0 {
            doc.add_page();
        } else {
            doc.move_down(0.5);
        }
        doc.flow(&cadre.full_name, 14.0, DARK, true);
        doc.move_down(0.5);

        let mut counts = [0u32; 4];
        let (x, row_h, col_day, col_am, col_pm) = (MARGIN, 16.0, 30.0, 90.0, 90.0);
        let table_w = col_day + col_am + col_pm;
        let mut y = doc.y;

        doc.fill_rect(x, y, table_w, row_h, 0x333333);
        doc.text_at("Jour", x + 4.0, y + 4.0, 9.0, 0xFFFFFF);
        doc.text_at("Matin (AM)", x + col_day + 4.0, y + 4.0, 9.0, 0xFFFFFF);
        doc.text_at("Après-midi (PM)", x + col_day + col_am + 4.0, y + 4.0, 9.0, 0xFFFFFF);
        y += row_h;

        for d in 1..=days {
            let date = data.date(d);
            let am = cadre.status(&date, "AM");
            let pm = cadre.status(&date, "PM");
            for st in [am, pm].into_iter().flatten() {
                counts[crate::status::STATUSES.iter().position(|s| *s == st).unwrap()] += 1;
            }
            if y > 760.0 {
                doc.add_page();
                y = MARGIN;
            }
            doc.stroke_rect(x, y, table_w, row_h, 0xDDDDDD);
            doc.text_at(&d.to_string(), x + 4.0, y + 4.0, 9.0, DARK);
            for (st, cx) in [(am, x + col_day + 4.0), (pm, x + col_day + col_am + 4.0)] {
                match st {
                    Some(st) => doc.text_at(label(st), cx, y + 4.0, 9.0, color(st)),
                    None => doc.text_at("—", cx, y + 4.0, 9.0, NONE),
                }
            }
            y += row_h;
        }

        y += 10.0;
        if y > 740.0 {
            doc.add_page();
            y = MARGIN;
        }
        doc.y = y;
        let totals = format!(
            "Total demi-journées — Présent: {}  ·  Non-présent: {}  ·  Congé: {}  ·  RTT: {}",
            counts[0], counts[1], counts[2], counts[3]
        );
        doc.flow(&totals, 10.0, DARK, false);
    }
    doc.finish()
}
