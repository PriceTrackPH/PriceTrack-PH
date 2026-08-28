const MAX_ARCHIVE_BYTES = 6 * 1024 * 1024;

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeFilename(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function doPost(event) {
  try {
    const body = JSON.parse((event.postData && event.postData.contents) || "{}");
    const properties = PropertiesService.getScriptProperties();
    const expectedSecret = properties.getProperty("ARCHIVE_SECRET") || "";
    if (!expectedSecret || String(body.secret || "") !== expectedSecret) {
      return jsonResponse({ ok: false, error: "unauthorized" });
    }

    const destination = String(body.destination || "").toLowerCase();
    const folderProperty = destination === "exports" ? "EXPORT_FOLDER_ID" : destination === "imports" ? "IMPORT_FOLDER_ID" : "";
    if (!folderProperty) return jsonResponse({ ok: false, error: "invalid_destination" });

    const folderId = properties.getProperty(folderProperty) || "";
    const filename = safeFilename(body.filename);
    const mimeType = String(body.mimeType || "application/octet-stream");
    if (!folderId || !filename || typeof body.base64 !== "string") {
      return jsonResponse({ ok: false, error: "invalid_request" });
    }

    const bytes = Utilities.base64Decode(body.base64);
    if (bytes.length > MAX_ARCHIVE_BYTES) return jsonResponse({ ok: false, error: "file_too_large" });

    const blob = Utilities.newBlob(bytes, mimeType, filename);
    const file = DriveApp.getFolderById(folderId).createFile(blob);
    return jsonResponse({ ok: true, fileId: file.getId(), name: file.getName() });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: "archive_failed" });
  }
}
