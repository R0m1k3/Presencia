mod common;

use std::{collections::HashMap, io::Read};

use common::*;
use quick_xml::{Reader, events::Event};
use serde_json::json;

/// Cells (`A1` → (value, fill ARGB)) and merged ranges of the first sheet.
struct Sheet {
    cells: HashMap<String, (String, Option<String>)>,
    merges: Vec<String>,
    sheet_name: String,
    frozen: (String, String),
}

fn attr(e: &quick_xml::events::BytesStart, name: &str) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.as_ref() == name.as_bytes()).map(|a| a.unescape_value().unwrap().into_owned())
}

fn read_xlsx(bytes: &[u8]) -> Sheet {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut file = |name: &str| {
        let mut s = String::new();
        if let Ok(mut f) = zip.by_name(name) {
            f.read_to_string(&mut s).unwrap();
        }
        s
    };
    let (shared, styles, sheet, workbook) =
        (file("xl/sharedStrings.xml"), file("xl/styles.xml"), file("xl/worksheets/sheet1.xml"), file("xl/workbook.xml"));

    let mut strings = Vec::new();
    let mut r = Reader::from_str(&shared);
    let mut in_t = false;
    loop {
        match r.read_event().unwrap() {
            Event::Start(e) if e.name().as_ref() == b"si" => strings.push(String::new()),
            Event::Start(e) if e.name().as_ref() == b"t" => in_t = true,
            Event::End(e) if e.name().as_ref() == b"t" => in_t = false,
            Event::Text(t) if in_t => strings.last_mut().unwrap().push_str(&t.unescape().unwrap()),
            Event::Eof => break,
            _ => {}
        }
    }

    // fills, then cellXfs → fill colour.
    let (mut fills, mut xfs) = (Vec::<Option<String>>::new(), Vec::<Option<String>>::new());
    let mut r = Reader::from_str(&styles);
    let mut section = "";
    loop {
        match r.read_event().unwrap() {
            Event::Start(e) | Event::Empty(e) => match e.name().as_ref() {
                b"fills" => section = "fills",
                b"cellXfs" => section = "xfs",
                b"cellStyleXfs" => section = "",
                b"fill" if section == "fills" => fills.push(None),
                b"fgColor" if section == "fills" => *fills.last_mut().unwrap() = attr(&e, "rgb"),
                b"xf" if section == "xfs" => {
                    let f: usize = attr(&e, "fillId").unwrap_or_default().parse().unwrap_or(0);
                    xfs.push(fills.get(f).cloned().flatten());
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }

    let mut cells = HashMap::new();
    let mut merges = Vec::new();
    let mut frozen = (String::new(), String::new());
    let mut r = Reader::from_str(&sheet);
    let mut cur: Option<(String, Option<String>, Option<String>)> = None;
    let mut in_v = false;
    loop {
        match r.read_event().unwrap() {
            Event::Start(e) if e.name().as_ref() == b"c" => cur = Some((attr(&e, "r").unwrap(), attr(&e, "t"), attr(&e, "s"))),
            Event::Empty(e) if e.name().as_ref() == b"c" => {
                let s: usize = attr(&e, "s").unwrap_or_default().parse().unwrap_or(0);
                cells.insert(attr(&e, "r").unwrap(), (String::new(), xfs.get(s).cloned().flatten()));
            }
            Event::Start(e) if e.name().as_ref() == b"v" => in_v = true,
            Event::End(e) if e.name().as_ref() == b"v" => in_v = false,
            Event::Text(t) if in_v => {
                let (cell, ty, s) = cur.clone().unwrap();
                let raw = t.unescape().unwrap().into_owned();
                let v = if ty.as_deref() == Some("s") { strings[raw.parse::<usize>().unwrap()].clone() } else { raw };
                let s: usize = s.unwrap_or_default().parse().unwrap_or(0);
                cells.insert(cell, (v, xfs.get(s).cloned().flatten()));
            }
            Event::Empty(e) if e.name().as_ref() == b"mergeCell" => merges.push(attr(&e, "ref").unwrap()),
            Event::Empty(e) if e.name().as_ref() == b"pane" => {
                frozen = (attr(&e, "xSplit").unwrap_or_default(), attr(&e, "ySplit").unwrap_or_default())
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let sheet_name = workbook.split("<sheet name=\"").nth(1).unwrap().split('"').next().unwrap().to_string();
    Sheet { cells, merges, sheet_name, frozen }
}

fn pdf_text(bytes: &[u8]) -> String {
    let doc = lopdf::Document::load_mem(bytes).unwrap();
    let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
    doc.extract_text(&pages).unwrap()
}

#[tokio::test]
async fn excel_and_pdf() {
    let t = setup("export").await;
    let admin = t.admin().await;
    let (cid, alice, _) = t.company_with_cadre(&admin, "Société — Nord", "alice@x.fr").await;
    sqlx::query("UPDATE users SET full_name = 'Alice Martin' WHERE id = $1").bind(alice as i32).execute(&t.pool).await.unwrap();
    let r = t.call("POST", "/api/users", Some(json!({ "full_name": "Zoé Bernard", "email": "zoe@x.fr", "password": "password1", "role": "cadre", "company_id": cid })), Some(&admin)).await;
    assert_eq!(r.status, 201);
    // An inactive cadre is left out.
    let r = t.call("POST", "/api/users", Some(json!({ "full_name": "Inactif", "email": "old@x.fr", "password": "password1", "role": "cadre", "company_id": cid })), Some(&admin)).await;
    let old = r.json()["id"].as_i64().unwrap();
    t.call("PUT", &format!("/api/users/{old}"), Some(json!({ "full_name": "Inactif", "email": "old@x.fr", "role": "cadre", "company_id": cid, "active": false })), Some(&admin)).await;
    let entries = json!([
        { "date": "2026-02-02", "period": "AM", "status": "present" },
        { "date": "2026-02-02", "period": "PM", "status": "absent" },
        { "date": "2026-02-03", "period": "AM", "status": "conge" },
        { "date": "2026-02-27", "period": "PM", "status": "rtt" },
        { "date": "2026-03-01", "period": "PM", "status": "rtt" },
    ]);
    let r = t.call("PUT", "/api/attendance/bulk", Some(json!({ "entries": entries, "user_id": alice })), Some(&admin)).await;
    assert_eq!(r.status, 200);

    let r = t.call("GET", &format!("/api/export/excel/{cid}?year=2026&month=2"), None, Some(&admin)).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.header("content-type").unwrap(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert_eq!(
        r.header("content-disposition").unwrap(),
        "attachment; filename=\"presences_Societe__Nord_2026-02.xlsx\"; filename*=UTF-8''presences_Soci%C3%A9t%C3%A9_%E2%80%94_Nord_2026-02.xlsx"
    );
    if let Ok(dir) = std::env::var("EXPORT_OUT") {
        std::fs::write(format!("{dir}/rust.xlsx"), &r.bytes).unwrap();
    }
    let s = read_xlsx(&r.bytes);
    assert_eq!(s.sheet_name, "Synthèse");
    assert_eq!(s.frozen, ("1".into(), "3".into()));
    let v = |c: &str| s.cells.get(c).map(|x| x.0.as_str()).unwrap_or("");
    let fill = |c: &str| s.cells.get(c).and_then(|x| x.1.clone());
    assert_eq!(v("A1"), "Présences — Société — Nord — Février 2026");
    assert_eq!((v("A2"), v("B2"), v("D2"), v("BD2")), ("Cadre", "1", "2", "28"));
    assert_eq!((v("B3"), v("C3")), ("AM", "PM"));
    assert_eq!((v("A4"), v("A5")), ("Alice Martin", "Zoé Bernard"));
    assert_eq!((v("D4"), v("E4"), v("F4"), v("BC4")), ("P", "NP", "CP", "RTT"));
    assert_eq!((fill("D4").as_deref(), fill("E4").as_deref()), (Some("FF2E7D32"), Some("FFC62828")));
    assert_eq!((fill("F4").as_deref(), fill("BC4").as_deref()), (Some("FFEF6C00"), Some("FF1565C0")));
    assert_eq!(fill("B4"), None);
    assert_eq!(v("A7"), "Légende : P = Présent · NP = Non-présent · CP = Congé · RTT = RTT");
    assert!(!s.cells.contains_key("A6") || v("A6").is_empty());
    assert_eq!(s.merges.len(), 29);
    assert!(s.merges.contains(&"A1:BE1".to_string()) && s.merges.contains(&"BD2:BE2".to_string()));

    let r = t.call("GET", &format!("/api/export/pdf/{cid}?year=2026&month=2"), None, Some(&admin)).await;
    assert_eq!(r.header("content-type").unwrap(), "application/pdf");
    assert!(r.header("content-disposition").unwrap().contains("presences_Societe__Nord_2026-02.pdf"));
    if let Ok(dir) = std::env::var("EXPORT_OUT") {
        std::fs::write(format!("{dir}/rust.pdf"), &r.bytes).unwrap();
    }
    let text = pdf_text(&r.bytes);
    for needle in [
        "Presencia — Récapitulatif de présences",
        "Société — Nord — Février 2026",
        "Alice Martin",
        "Zoé Bernard",
        "Après-midi (PM)",
        "Non-présent",
        "Total demi-journées — Présent: 1  ·  Non-présent: 1  ·  Congé: 1  ·  RTT: 1",
        "Total demi-journées — Présent: 0  ·  Non-présent: 0  ·  Congé: 0  ·  RTT: 0",
    ] {
        assert!(text.contains(needle), "missing {needle:?} in\n{text}");
    }
    assert!(!text.contains("Inactif"));
    assert_eq!(lopdf::Document::load_mem(&r.bytes).unwrap().get_pages().len(), 2);

    // Errors.
    let r = t.call("GET", &format!("/api/export/pdf/{cid}?year=2026"), None, Some(&admin)).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "year et month requis"));
    let r = t.call("GET", "/api/export/excel/999?year=2026&month=2", None, Some(&admin)).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (404, "Société introuvable"));
    let cadre = t.login("zoe@x.fr", "password1").await;
    assert_eq!(t.call("GET", &format!("/api/export/pdf/{cid}?year=2026&month=2"), None, Some(&cadre)).await.status, 403);
}
