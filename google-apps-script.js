// MultiAnki — Google Apps Script
// Paste this into Extensions > Apps Script in your Google Sheet.
// Then: Deploy > New deployment > Web app
//   - Execute as: Me
//   - Who has access: Anyone
// Copy the deployment URL and paste it into src/config.ts in the app.
//
// Two sheets are written:
//   "Facts"   — one row per question attempt (every submit / I don't know)
//   "Sessions"— one row per completed session (summary)

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.type === "fact") {
      writeFact(ss, data);
    } else if (data.type === "session-summary") {
      writeSession(ss, data);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writeFact(ss, data) {
  const sheet = getOrCreateSheet(ss, "Facts", [
    "Timestamp", "Student", "Lesson", "Fact", "A", "B", "Answer Given", "Correct",
  ]);
  sheet.appendRow([
    new Date().toLocaleString(),
    data.student  ?? "",
    data.lesson   ?? "",
    data.fact     ?? "",          // e.g. "7×8"
    data.a        ?? "",          // 7
    data.b        ?? "",          // 8
    data.answer   ?? "skipped",
    data.correct  ? "Yes" : "No",
  ]);
}

function writeSession(ss, data) {
  const sheet = getOrCreateSheet(ss, "Sessions", [
    "Timestamp", "Student", "Session Type", "Lesson", "Correct", "Total", "Mistakes",
  ]);
  sheet.appendRow([
    new Date().toLocaleString(),
    data.student  ?? "",
    data.session  ?? "",
    data.lesson   ?? "",
    data.correct  ?? 0,
    data.total    ?? 0,
    (data.mistakes ?? []).join(", "),
  ]);
}
