// MultiAnki — Google Apps Script
// Paste this into Extensions > Apps Script in your Google Sheet.
// Then: Deploy > New deployment > Web app
//   - Execute as: Me
//   - Who has access: Anyone
// Copy the deployment URL and paste it into src/config.ts in the app.

const SHEET_NAME = "Results";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Create the Results sheet if it doesn't exist
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        "Timestamp",
        "Student",
        "Session",
        "Lesson",
        "Correct",
        "Total",
        "Mistakes",
      ]);
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date().toLocaleString(),
      data.student   ?? "",
      data.session   ?? "",   // "lesson" or "review"
      data.lesson    ?? "",   // e.g. "Lesson 1" or "Review"
      data.correct   ?? 0,
      data.total     ?? 0,
      (data.mistakes ?? []).map((m) => `${m.a}×${m.b}`).join(", "),
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
