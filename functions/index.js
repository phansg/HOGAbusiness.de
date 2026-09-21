const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { randomUUID } = require("crypto");

initializeApp();
const region = "europe-west1";
const allowedTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain",
  "text/csv", "application/rtf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

async function requireRole(request, roles) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Anmeldung erforderlich.");
  const snap = await getFirestore().doc(`users/${request.auth.uid}`).get();
  const profile = snap.data();
  if (!snap.exists || profile.active !== true || !roles.includes(profile.role))
    throw new HttpsError("permission-denied", "Keine Berechtigung.");
  return profile;
}
function safeVehicleId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpsError("invalid-argument", "Ungültige Fahrzeug-ID.");
  return id;
}
function safeFileName(value) {
  return String(value || "Datei").replace(/[^A-Za-z0-9ÄÖÜäöüß._ -]/g, "_").slice(0, 140);
}
function assertOwnedPath(vehicleId, path) {
  const prefix = `fleet/${vehicleId}/`;
  if (!String(path || "").startsWith(prefix)) throw new HttpsError("permission-denied", "Ungültiger Dateipfad.");
  return String(path);
}

exports.uploadFleetVehicleFile = onCall({ region, memory: "512MiB", timeoutSeconds: 60 }, async (request) => {
  await requireRole(request, ["admin", "user"]);
  const vehicleId = safeVehicleId(request.data?.vehicleId);
  const contentType = String(request.data?.contentType || "application/octet-stream");
  if (!allowedTypes.has(contentType)) throw new HttpsError("invalid-argument", "Dieser Dateityp ist nicht erlaubt.");
  const buffer = Buffer.from(String(request.data?.base64Data || ""), "base64");
  const max = contentType.startsWith("image/") ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
  if (!buffer.length || buffer.length > max) throw new HttpsError("invalid-argument", "Die Datei ist leer oder zu groß.");
  const id = randomUUID();
  const name = safeFileName(request.data?.fileName);
  const path = `fleet/${vehicleId}/${id}_${name}`;
  await getStorage().bucket().file(path).save(buffer, { resumable: false, contentType, metadata: { cacheControl: "private,no-store" } });
  return { file: { id, path, name, contentType, size: buffer.length, uploadedAt: new Date().toISOString() } };
});

exports.getFleetVehicleFileUrls = onCall({ region }, async (request) => {
  await requireRole(request, ["admin", "user", "read"]);
  const vehicleId = safeVehicleId(request.data?.vehicleId);
  const paths = Array.isArray(request.data?.paths) ? request.data.paths.slice(0, 20) : [];
  const bucket = getStorage().bucket();
  const files = await Promise.all(paths.map(async (candidate) => {
    const path = assertOwnedPath(vehicleId, candidate);
    const [url] = await bucket.file(path).getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000 });
    return { path, url };
  }));
  return { files };
});

exports.deleteFleetVehicleFile = onCall({ region }, async (request) => {
  await requireRole(request, ["admin", "user"]);
  const vehicleId = safeVehicleId(request.data?.vehicleId);
  const path = assertOwnedPath(vehicleId, request.data?.path);
  await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
  return { ok: true };
});
