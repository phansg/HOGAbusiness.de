import { DEMO_MODE, configured, fleetAuth, fleetDb, blazeFunctions } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";

const STORAGE_KEY = "hogabusiness.fuhrpark.vehicles.v02";
const SETTINGS_KEY = "hogabusiness.fuhrpark.settings.v02";
const DEMO_USER = { uid: "github-test", email: "testbetrieb@hogabusiness.local", name: "Testbetrieb", role: "admin" };
const tabs = [
  ["stammdaten", "Fahrzeug-Stammdaten"],
  ["eigentum", "Eigentum & Nutzen"],
  ["finanzierung", "Anschaffung / Finanzierung"],
  ["laufleistung", "Laufleistung"],
  ["verbrauch", "Kraftstoff & Energie"],
  ["versicherung", "Versicherung"],
  ["steuern", "Steuern"],
  ["wartung", "Wartung / Reparatur / Pflege / Zubehör"],
  ["termine", "Terminübersicht"],
  ["dokumente", "Dokumente und Fotos"],
  ["schaden", "Schadenregulierung"],
  ["kosten", "Kostenübersicht & €/km"],
];
const monthlyTabs = new Set([
  "laufleistung",
  "verbrauch",
  "versicherung",
  "steuern",
  "wartung",
  "kosten",
]);
const textAreaCols = new Set(["D", "AL", "CS", "CW", "DA", "DE"]);
const dateCols = new Set(["M", "R", "U", "X", "AX", "AY", "AZ"]);
const moneyCols = new Set(["AV", "AD", "BA", "BB", "BY", "BZ", "CB", "CD", "CE", "CN", "CO", "CQ", "CU", "CY", "DC", "DG", "DH", "BR", "BQ", "DJ", "DK", "DL", "DM", "DN", "DO", "DP", "DQ", "DR", "DS", "DT", "DU", "DW"]);
const calculatedCols = new Set(["AP", "BL", "BM", "BP", "BQ", "BS", "CD", "CE", "CN", "CO", "DH", "DJ", "DK", "DL", "DM", "DN", "DO", "DP", "DQ", "DR", "DS", "DT", "DU", "DW"]);

const dropdowns = {
  K: [
    "PKW",
    "Transporter",
    "LKW",
    "Pritsche",
    "Anhänger",
    "Kasten offen",
    "Kasten Hochdach",
    "Kasten normal",
    "Kasten geschlossen",
    "LKW Plane + Sprigel",
    "Pritsche Plane",
    "Plane hoch + Ladebordwand",
    "Kasten Hochdach lang",
  ],
  N: ["Diesel", "Benzin", "Elektro", "Hybrid-Benzin", "Hybrid-Diesel", "LPG"],
  AN: [""],
  AO: [""],
  AW: ["Kauf", "Leasing/Mietkauf", "Miete"],
  Y: ["nur Sommer", "nur Winter", "Sommer+Winter", "Ganzjahres"],
  AF: [""],
  AG: [
    "Fahrzeug",
    "Tresor",
    "Schlüsseltresor",
    
  ],
  AH: ["Tresor", "nicht vorhanden", "Fahrer"],
  Q: ["ja", "nein"],
  T: ["ja", "nein"],
  W: ["ja", "nein"],
  AC: ["ja", "nein"],
  AI: ["ja", "nein"],
  CI: ["ja", "nein"],
  CJ: ["ja", "nein"],
  CK: ["ja", "nein"],
};
const costDefaults = {
  financing: true,
  shelf: true,
  insurance: true,
  tax: true,
  service: true,
  workshop: true,
  fuel: false,
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
const n = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};
const round2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const money = (v) =>
  round2(v).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x)
    ? x.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : v || "–";
};
const isoToday = () => new Date().toISOString().slice(0, 10);
const defaultSettings = {
  remindFirstAid: true,
  firstAidDays: 30,
  remindHu: true,
  huDays: 60,
  remindUvv: true,
  uvvDays: 60,
  remindAppointments: true,
  appointmentDays: 30,
  remindLeasing: true,
  leasingDays: 120,
};
let baseData,
  vehicles,
  headers,
  sections,
  selectedId = null,
  activeTab = "stammdaten",
  year = String(new Date().getFullYear()),
  editing = false,
  draft = null,
  currentUser = null,
  currentView = "all",
  rolodexIndex = 0,
  filteredVehicles = [],
  settings = { ...defaultSettings };

let loadingVisible = false;

function showLoading(title = "Bitte warten …", message = "Daten werden verarbeitet.", progress = null) {
  const overlay = $("#loadingOverlay");
  if (!overlay) return;
  loadingVisible = true;
  overlay.classList.remove("hidden");
  $("#loadingTitle").textContent = title;
  updateLoading(message, progress);
}

function updateLoading(message = "", progress = null) {
  if (!loadingVisible) return;
  const text = $("#loadingMessage");
  const bar = $("#loadingProgress");
  const percent = $("#loadingPercent");
  if (text) text.textContent = message;
  if (!bar || !percent) return;
  if (Number.isFinite(progress)) {
    const value = Math.max(0, Math.min(100, Number(progress)));
    bar.classList.remove("indeterminate");
    bar.style.width = `${value}%`;
    percent.textContent = `${Math.round(value)} %`;
  } else {
    bar.classList.add("indeterminate");
    bar.style.width = "";
    percent.textContent = "";
  }
}

function hideLoading() {
  loadingVisible = false;
  const overlay = $("#loadingOverlay");
  if (overlay) overlay.classList.add("hidden");
}

function waitForLoadingPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function withLoading(title, message, task) {
  showLoading(title, message);
  try {
    return await task();
  } finally {
    hideLoading();
  }
}

async function init() {
  baseData = await fetch("data/vehicles.json").then((r) => {
    if (!r.ok) throw new Error("Fahrzeugdaten konnten nicht geladen werden.");
    return r.json();
  });
  headers = baseData.headers;
  sections = baseData.sections;
  sections.dokumente = [];
  bindStatic();
  if (DEMO_MODE) {
    showLoading("HOGAbusiness FleetDesk", "Lokaler Teststand wird vorbereitet …");
    currentUser = DEMO_USER;
    await loadDemoData();
    login(currentUser);
    hideLoading();
    return;
  }
  if (!configured) throw new Error("Die Firebase-Konfiguration ist noch nicht vollständig.");
  onAuthStateChanged(fleetAuth, async (user) => {
    if (!user) {
      currentUser = null;
      hideLoading();
      showLogin();
      return;
    }
    showLoading("Anmeldung wird geladen", "Benutzerprofil wird geprüft …");
    try {
      const profileSnap = await getDoc(doc(fleetDb, "users", user.uid));
      if (!profileSnap.exists())
        throw new Error(
          "Für diesen Benutzer fehlt das Firestore-Profil unter users/" +
            user.uid +
            ".",
        );
      const profile = profileSnap.data();
      if (profile.active === false)
        throw new Error("Dieser Benutzer ist deaktiviert.");
      if (!["admin", "user", "read"].includes(profile.role))
        throw new Error("Ungültige Benutzerrolle.");
      currentUser = {
        uid: user.uid,
        email: user.email || profile.email || "",
        name: profile.name || user.displayName || "",
        role: profile.role,
      };
      updateLoading("Fahrzeugdaten und Einstellungen werden geladen …");
      await loadCloudData();
      login(currentUser);
      hideLoading();
    } catch (err) {
      console.error(err);
      await signOut(fleetAuth).catch(() => {});
      hideLoading();
      showLogin();
      $("#loginMessage").textContent =
        err.message || "Anmeldung konnte nicht abgeschlossen werden.";
    }
  });
}
async function loadDemoData() {
  const stored = localStorage.getItem(STORAGE_KEY);
  vehicles = stored ? JSON.parse(stored) : structuredClone(baseData.vehicles);
  if (!Array.isArray(vehicles)) vehicles = structuredClone(baseData.vehicles);
  normalizeVehicles();
  settings = { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  await saveDemoData();
}
async function saveDemoData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicles));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function normalizeVehicles() {
  vehicles.forEach((v) => {
    v.archived = Boolean(v.archived);
    v.active = v.archived ? false : v.active !== false;
    v.leasingReminderDismissed = Boolean(v.leasingReminderDismissed);
    v.costSettings = { ...costDefaults, ...(v.costSettings || {}) };
    v.documents = v.documents || [];
    v.damageFiles = v.damageFiles || [];
    v.appointments = v.appointments || [];
    v.history = v.history || [];
    v.annual = v.annual || {};
    v.master.LENGTH = v.master.LENGTH || "";
    v.master.WIDTH = v.master.WIDTH || "";
    v.master.HEIGHT = v.master.HEIGHT || "";
    for (const y of [2025, 2026, 2027, 2028, 2029, 2030]) {
      v.monthly[String(y)] = v.monthly[String(y)] || createMonths(y);
      const ys = String(y),
        rows = v.monthly[ys];
      rows.forEach((r) => {
        if (r.taxMonthly === undefined || r.taxMonthly === null) r.taxMonthly = "";
      });
      v.annual[ys] = v.annual[ys] || {
        insuranceAnnual: n((rows.find((r) => n(r.CD) > 0) || {}).CD),
        taxAnnual: n((rows.find((r) => n(r.CN) > 0) || {}).CN),
      };
    }
  });
}
function createMonths(y) {
  return [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ].map((monthName, i) => ({ year: y, month: i + 1, monthName }));
}
function bindStatic() {
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#loginMessage").textContent = "";
    $("#loginMessage").classList.remove("success-text");
    $("#loginMessage").classList.add("error-text");
    const email = $("#loginEmail").value.trim(),
      pw = $("#loginPassword").value;
    try {
      showLoading("Anmeldung", "Zugangsdaten werden geprüft …");
      await signInWithEmailAndPassword(fleetAuth, email, pw);
      updateLoading("Anmeldung erfolgreich. Daten werden geladen …");
    } catch (err) {
      hideLoading();
      console.error(err);
      $("#loginMessage").textContent =
        "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.";
    }
  };
  $("#forgotPasswordBtn").onclick = async () => {
    const email = $("#loginEmail").value.trim();
    $("#loginMessage").textContent = "";
    if (!email) {
      $("#loginMessage").textContent =
        "Bitte zuerst die E-Mail-Adresse eingeben, für die das Passwort zurückgesetzt werden soll.";
      $("#loginEmail").focus();
      return;
    }
    try {
      showLoading("Passwort zurücksetzen", "E-Mail zum Zurücksetzen des Passworts wird angefordert …");
      fleetAuth.languageCode = "de";
      await sendPasswordResetEmail(fleetAuth, email);
      $("#loginMessage").classList.remove("error-text");
      $("#loginMessage").classList.add("success-text");
      $("#loginMessage").textContent =
        "Die E-Mail zum Zurücksetzen des Passworts wurde versendet. Bitte auch den Spam-Ordner prüfen.";
    } catch (err) {
      console.error(err);
      $("#loginMessage").classList.remove("success-text");
      $("#loginMessage").classList.add("error-text");
      $("#loginMessage").textContent =
        "Die E-Mail zum Zurücksetzen des Passworts konnte nicht versendet werden. Bitte E-Mail-Adresse prüfen.";
    } finally {
      hideLoading();
    }
  };
  $("#logoutBtn").onclick = () => DEMO_MODE ? alert("Im GitHub-Testbetrieb ist keine Abmeldung erforderlich.") : signOut(fleetAuth);
  $("#mainMenuBtn").onclick = (e) => {
    e.stopPropagation();
    $("#mainMenu").classList.toggle("hidden");
  };
  $("#vehiclesBtn").onclick = showVehicleBrowser;
  $("#browserAddVehicleBtn").onclick = () => openModal("vehicleModal");
  $("#rolodexUp").onclick = () => moveRolodex(-1);
  $("#rolodexDown").onclick = () => moveRolodex(1);
  $("#openVehicleBtn").onclick = () => {
    const vehicle = filteredVehicles[rolodexIndex];
    if (vehicle) selectVehicle(vehicle.id);
  };
  $("#searchInput").oninput = renderList;
  $("#viewSwitch").onclick = (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    currentView = b.dataset.view;
    $$("#viewSwitch button").forEach((x) =>
      x.classList.toggle("active", x === b),
    );
    renderList();
  };
  $("#dashboardBtn").onclick = showDashboard;
  $("#historyBtn").onclick = () => openHistory();
  $("#vehicleHistoryBtn").onclick = () => openHistory(selectedId);
  $("#addVehicleBtn").onclick = () => openModal("vehicleModal");
  $("#vehicleForm").onsubmit = addVehicle;
  $("#editBtn").onclick = () => {
    if (!canWrite()) return;
    editing = true;
    draft = structuredClone(current());
    toggleEdit();
    renderHeader();
    renderContent();
  };
  $("#vehiclePhotoButton").onclick = () => {
    if (!editing || !canWrite()) return;
    $("#vehiclePhotoInput").click();
  };
  $("#vehiclePhotoInput").onchange = changeVehiclePhoto;
  $("#cancelBtn").onclick = () => {
    editing = false;
    draft = null;
    toggleEdit();
    renderHeader();
    renderContent();
  };
  $("#saveBtn").onclick = saveEdits;
  $("#archiveBtn").onclick = archiveVehicle;
  $("#deleteVehicleBtn").onclick = deleteVehicle;
  $("#backupBtn").onclick = downloadBackup;
  $("#restoreBtn").onclick = () => $("#restoreInput").click();
  $("#restoreInput").onchange = restoreBackup;
  $("#settingsBtn").onclick = openSettings;
  $("#settingsForm").onsubmit = saveSettings;
  $("#chargeExportForm").onsubmit = submitChargeExport;
  $("#csvBtn").onclick = (e) => {
    e.stopPropagation();
    $("#exportMenu").classList.toggle("hidden");
  };
  document.onclick = () => {
    $("#exportMenu").classList.add("hidden");
    $("#mainMenu").classList.add("hidden");
    $("#tabs").classList.add("hidden");
  };
  $("#exportMenu").onclick = (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-export]");
    if (!b) return;
    exportCsv(b.dataset.export);
    $("#exportMenu").classList.add("hidden");
  };
  $("#yearSelect").onchange = (e) => {
    year = e.target.value;
    renderContent();
  };
  $("#tabMenuBtn").onclick = (e) => {
    e.stopPropagation();
    $("#tabs").classList.toggle("hidden");
  };
  $("#appointmentForm").onsubmit = addAppointment;
  $$("[data-close]").forEach(
    (b) => (b.onclick = () => closeModal(b.dataset.close)),
  );
}
function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}
function login(user) {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  const roleLabels = {
    admin: "Administrator",
    user: "Benutzer",
    read: "Lesemodus",
  };
  $("#roleBadge").textContent = DEMO_MODE ? "● Testbetrieb · lokal" : (roleLabels[user.role] || user.role);
  $("#logoutBtn").classList.remove("hidden");
  const readOnly = isReadOnly();
  $("#addVehicleBtn").classList.toggle("hidden", readOnly);
  $("#deleteVehicleBtn").classList.toggle("hidden", user.role !== "admin");
  $("#settingsBtn").classList.toggle("hidden", user.role !== "admin");
  $("#restoreBtn").classList.toggle("hidden", user.role !== "admin");
  renderTabs();
  renderList();
  showDashboard();
}
function isAdmin() {
  return currentUser?.role === "admin";
}
function isReadOnly() {
  return currentUser?.role === "read";
}
function canWrite() {
  return currentUser?.role === "admin" || currentUser?.role === "user";
}
async function loadCloudData() {
  updateLoading("Fahrzeuge werden aus Firestore geladen …");
  const snaps = await getDocs(collection(fleetDb, "vehicles"));
  vehicles = snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!vehicles.length) {
    if (!isAdmin())
      throw new Error(
        "Noch keine Fahrzeuge vorhanden. Der erste Datenimport muss durch einen Administrator erfolgen.",
      );
    const localVehicles = await dbGetState("vehicles").catch(() => null);
    const source =
      Array.isArray(localVehicles) && localVehicles.length
        ? localVehicles
        : baseData.vehicles;
    const sourceText =
      source === localVehicles
        ? "dem bisherigen lokalen Teststand"
        : "der Excel-Migration";
    const ok = confirm(
      `In Firestore sind noch keine Fahrzeuge vorhanden. Sollen jetzt ${source.length} Fahrzeuge aus ${sourceText} importiert werden?`,
    );
    if (ok) {
      vehicles = structuredClone(source);
      normalizeVehicles();
      await importInitialVehicles();
    }
  }
  normalizeVehicles();
  updateLoading(`${vehicles.length} Fahrzeuge geladen. Einstellungen werden geprüft …`);
  const settingsSnap = await getDoc(doc(fleetDb, "settings", "general"));
  const localSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  settings = {
    ...defaultSettings,
    ...localSettings,
    ...(settingsSnap.exists() ? settingsSnap.data() : {}),
  };
  if (!settingsSnap.exists() && isAdmin())
    await setDoc(doc(fleetDb, "settings", "general"), settings, {
      merge: true,
    });
}
async function importInitialVehicles() {
  const chunks = [];
  for (let i = 0; i < vehicles.length; i += 400)
    chunks.push(vehicles.slice(i, i + 400));
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    updateLoading(
      `Erstimport: Datenblock ${chunkIndex + 1} von ${chunks.length} wird gespeichert …`,
      ((chunkIndex + 1) / chunks.length) * 95,
    );
    const batch = writeBatch(fleetDb);
    for (const v of chunk) {
      batch.set(doc(fleetDb, "vehicles", v.id), cleanForFirestore(v));
    }
    await batch.commit();
  }
  await setDoc(doc(fleetDb, "settings", "general"), settings, { merge: true });
}
function cleanForFirestore(value) {
  if (Array.isArray(value)) return value.map(cleanForFirestore);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = cleanForFirestore(v);
    }
    return out;
  }
  return value;
}
async function persistVehicle(v) {
  if (DEMO_MODE) return saveDemoData();
  await setDoc(doc(fleetDb, "vehicles", v.id), cleanForFirestore(v));
}
async function persist() {
  if (DEMO_MODE) return saveDemoData();
  for (const v of vehicles) await persistVehicle(v);
}
function current() {
  return vehicles.find((v) => v.id === selectedId);
}
function working() {
  return editing ? draft : current();
}
function renderList() {
  const q = $("#searchInput").value.toLowerCase();
  const list = vehicles.filter((v) => {
    const hay = [v.displayName, ...Object.values(v.master)]
      .join(" ")
      .toLowerCase();
    const view =
      currentView === "all"
        ? !v.archived
        : currentView === "archive"
          ? v.archived
          : currentView === "active"
            ? !v.archived && v.active
            : !v.archived && !v.active;
    return hay.includes(q) && view;
  });
  filteredVehicles = list;
  if (rolodexIndex >= list.length) rolodexIndex = Math.max(0, list.length - 1);
  if (selectedId) {
    const selectedIndex = list.findIndex((v) => v.id === selectedId);
    if (selectedIndex >= 0) rolodexIndex = selectedIndex;
  }
  const v = list[rolodexIndex];
  $("#vehicleCount").textContent =
    `${list.length} von ${vehicles.length} Fahrzeugen`;
  $("#vehicleList").innerHTML = v
    ? `<button class="vehicle-item rolodex-card" data-id="${v.id}"><span class="vehicle-list-photo">${v.vehiclePhoto ? `<img src="${esc(v.vehiclePhoto)}" alt="Fahrzeugfoto ${esc(v.displayName || "")}">` : '<span class="vehicle-photo-placeholder" aria-hidden="true">🚗</span>'}</span><span class="vehicle-item-copy"><span class="rolodex-position">${rolodexIndex + 1} / ${list.length}</span><strong><span class="dot ${v.archived ? "archive" : v.active ? "on" : ""}"></span>${esc(v.displayName || "Ohne Kennzeichen")}</strong><small>${esc(v.master.I || "")} ${esc(v.master.J || "")}</small><span class="rolodex-meta">${esc(v.master.K || "Fahrzeug")} · ${esc(v.master.AO || v.master.AN || "Ohne Zuordnung")}</span></span></button>`
    : '<div class="rolodex-empty"><strong>Keine Fahrzeuge gefunden</strong><span>Bitte Suche oder Filter ändern.</span></div>';
  $("#rolodexUp").disabled = list.length < 2;
  $("#rolodexDown").disabled = list.length < 2;
  $("#openVehicleBtn").disabled = !v;
  $("#vehicleList").onclick = (e) => {
    const b = e.target.closest("[data-id]");
    if (b) selectVehicle(b.dataset.id);
  };
}
function moveRolodex(direction) {
  if (!filteredVehicles.length) return;
  rolodexIndex = (rolodexIndex + direction + filteredVehicles.length) % filteredVehicles.length;
  selectedId = filteredVehicles[rolodexIndex].id;
  renderList();
}
function showVehicleBrowser() {
  editing = false;
  $("#dashboard").classList.add("hidden");
  $("#vehicleCard").classList.add("hidden");
  $("#emptyState").classList.add("hidden");
  $("#vehicleBrowser").classList.remove("hidden");
  renderList();
}
function selectVehicle(id) {
  selectedId = id;
  editing = false;
  draft = null;
  $("#dashboard").classList.add("hidden");
  $("#vehicleBrowser").classList.add("hidden");
  $("#emptyState").classList.add("hidden");
  $("#vehicleCard").classList.remove("hidden");
  toggleEdit();
  renderList();
  renderHeader();
  renderContent();
}
function showDashboard() {
  selectedId = null;
  editing = false;
  $("#vehicleCard").classList.add("hidden");
  $("#vehicleBrowser").classList.add("hidden");
  $("#emptyState").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  renderList();
  renderDashboard();
}
function renderHeader() {
  const v = current(),
    m = v.master;
  $("#vehicleTitle").textContent = v.displayName;
  $("#vehicleSubtitle").textContent = [m.I, m.J, m.K, m.L]
    .filter(Boolean)
    .join(" · ");
  const status = v.archived ? "Archiv" : v.active ? "Aktiv" : "Inaktiv";
  $("#activeBadge").textContent = status;
  $("#activeBadge").className =
    "badge " + (v.archived ? "archived" : v.active ? "active" : "inactive");
  $("#archiveBtn").textContent = v.archived
    ? "Aus Archiv holen"
    : "Archivieren";
  renderVehiclePhoto(v);
}
function renderVehiclePhoto(v = working() || current()) {
  const button = $("#vehiclePhotoButton");
  const image = $("#vehiclePhotoImage");
  const placeholder = $("#vehiclePhotoPlaceholder");
  if (!button || !image || !placeholder || !v) return;
  const hasPhoto = Boolean(v.vehiclePhoto);
  image.src = hasPhoto ? v.vehiclePhoto : "";
  image.alt = hasPhoto ? `Fahrzeugfoto ${v.displayName || ""}` : "";
  image.classList.toggle("hidden", !hasPhoto);
  placeholder.classList.toggle("hidden", hasPhoto);
  button.classList.toggle("editable", editing && canWrite());
  button.disabled = !(editing && canWrite());
  button.title = editing && canWrite()
    ? hasPhoto
      ? "Fahrzeugfoto ändern"
      : "Fahrzeugfoto hochladen"
    : "Fahrzeugfoto";
}

async function changeVehiclePhoto(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !editing || !draft || !canWrite()) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    alert("Bitte ein Foto im Format JPG, PNG oder WEBP auswählen.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert("Das Ausgangsfoto darf maximal 10 MB groß sein.");
    return;
  }
  try {
    showLoading("Fahrzeugfoto", "Foto wird verkleinert und vorbereitet …");
    await waitForLoadingPaint();
    draft.vehiclePhoto = await createVehicleThumbnail(file);
    addHistory(draft, "Fahrzeugfoto geändert", file.name);
    renderVehiclePhoto(draft);
  } catch (error) {
    console.error(error);
    alert(error.message || "Das Fahrzeugfoto konnte nicht verarbeitet werden.");
  } finally {
    hideLoading();
  }
}

function createVehicleThumbnail(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Das Foto konnte nicht gelesen werden."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Das Fotoformat konnte nicht verarbeitet werden."));
      image.onload = () => {
        const maxWidth = 640;
        const maxHeight = 400;
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function toggleEdit() {
  const writable = canWrite();
  $("#vehicleHistoryBtn").classList.toggle("hidden", !selectedId);
  $("#editBtn").classList.toggle("hidden", editing || !writable);
  $("#saveBtn").classList.toggle("hidden", !editing || !writable);
  $("#cancelBtn").classList.toggle("hidden", !editing || !writable);
  $("#archiveBtn").classList.toggle("hidden", !editing || !writable);
  $("#deleteVehicleBtn").classList.toggle("hidden", !editing || !isAdmin());
  renderVehiclePhoto();
}
function renderTabs() {
  $("#tabs").innerHTML = tabs
    .map(
      ([id, label]) =>
        `<button class="tab-btn ${id === activeTab ? "active" : ""}" data-tab="${id}">${label}</button>`,
    )
    .join("");
  $("#tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    activeTab = b.dataset.tab;
    $("#tabs").classList.add("hidden");
    renderTabs();
    renderContent();
  };
  const label = tabs.find(([id]) => id === activeTab)?.[1] || "Bereich auswählen";
  $("#tabMenuBtn").textContent = `${label} ▾`;
  $("#yearSelect").innerHTML = [2025, 2026, 2027, 2028, 2029, 2030]
    .map((y) => `<option ${String(y) === year ? "selected" : ""}>${y}</option>`)
    .join("");
}
function renderContent() {
  if (!selectedId) return;
  $("#yearTools").classList.toggle("hidden", !monthlyTabs.has(activeTab));
  if (activeTab === "termine") renderAppointments();
  else if (activeTab === "dokumente") renderDocuments();
  else if (activeTab === "schaden") renderDamageRegulation();
  else if (activeTab === "versicherung" || activeTab === "steuern")
    renderAnnualMonthly();
  else if (monthlyTabs.has(activeTab)) renderMonthly();
  else renderMaster();
}
function inputFor(col, val, path, disabled = false) {
  if (dropdowns[col])
    return `<select data-path="${path}" ${disabled ? "disabled" : ""}><option value=""></option>${dropdowns[col].map((x) => `<option ${String(val) === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  if (textAreaCols.has(col))
    return `<textarea data-path="${path}" rows="3" ${disabled ? "disabled" : ""}>${esc(val)}</textarea>`;
  const type = dateCols.has(col)
    ? "date"
    : moneyCols.has(col) || ["S", "U", "V", "X", "AA", "AE", "BF"].includes(col)
      ? "number"
      : "text";
  const shown =
    type === "number" && val !== "" && val !== null && val !== undefined
      ? round2(val)
      : val;
  return `<input data-path="${path}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(shown)}" ${disabled ? "disabled" : ""}>`;
}
function renderMaster() {
  const v = working(),
    cols = [...(sections[activeTab] || [])];
  if (activeTab === "stammdaten")
    cols.splice(cols.indexOf("X") + 1, 0, "LENGTH", "WIDTH", "HEIGHT");
  if (activeTab === "eigentum") {
    const now = new Date(),
      cy = String(now.getFullYear()),
      cm = now.getMonth();
    if (v.monthly[cy]) {
      recalc(v, cy);
      v.master.AP = v.monthly[cy][cm]?.DW || 0;
    }
  }
  let html = '<div class="content-panel"><div class="field-grid">';
  if (editing && activeTab === "stammdaten")
    html += `<div class="status-editor"><strong>Fahrzeugstatus:</strong><label><input type="radio" name="vehicleStatus" value="active" ${v.active && !v.archived ? "checked" : ""}> Aktiv</label><label><input type="radio" name="vehicleStatus" value="inactive" ${!v.active && !v.archived ? "checked" : ""}> Inaktiv</label></div>`;
  for (const col of cols) {
    if (col === "H") continue;
    const val = v.master[col],
      calc = calculatedCols.has(col);
    const label =
      {
        LENGTH: "Länge (mm)",
        WIDTH: "Breite (mm)",
        HEIGHT: "Höhe (mm)",
        AP: "Interner Verrechnungsbetrag (€/Monat) für aktuellen Monat/Jahr",
      }[col] ||
      headers[col] ||
      col;
    html += `<div class="field ${["AL", "D"].includes(col) ? "wide" : ""} ${calc ? "calculated" : ""}"><label>${esc(label)}${calc ? " · berechnet" : ""}</label>${editing ? inputFor(col, val, `master.${col}`, calc) : `<div class="value">${formatValue(col, val)}</div>`}</div>`;
  }
  if (activeTab === "eigentum") html += chargeBreakdown(v);
  html += "</div></div>";
  $("#tabContent").innerHTML = html;
  bindInputs();
  $$("[name=vehicleStatus]").forEach(
    (r) =>
      (r.onchange = () => {
        draft.active = r.value === "active";
        draft.archived = false;
      }),
  );
}

function chargeBreakdown(v) {
  const now = new Date(),
    y = String(now.getFullYear()),
    r = v.monthly[y]?.[now.getMonth()];
  if (!r) return "";
  recalc(v, y);
  if ((v.master.AN || "") === (v.master.AO || ""))
    return `<div class="charge-breakdown"><h3>Zusammensetzung aktueller Verrechnungsbetrag</h3><p>Eigentümer und Nutzer sind identisch; es erfolgt keine interne Verrechnung.</p></div>`;
  const s = v.costSettings || costDefaults,
    items = [];
  if (s.financing) {
    const finance =
      n(v.master.BA) > 0
        ? ["Leasingrate", n(v.master.BA)]
        : n(v.master.BB) > 0
          ? ["Interne Miete", n(v.master.BB)]
          : null;
    if (finance) items.push(finance);
  }
  if (
    s.shelf &&
    String(v.master.AC).toLowerCase() === "ja" &&
    n(v.master.AE) > 0
  )
    items.push([
      "Regalsystem (Wert ÷ Abschreibungsdauer)",
      n(v.master.AD) / n(v.master.AE),
    ]);
  if (s.insurance) items.push(["Versicherung", n(r.CE)]);
  if (s.tax) items.push(["Steuer", n(r.CO)]);
  if (s.service) items.push(["Wartungs-/Servicevertrag", n(r.CQ)]);
  if (s.workshop)
    items.push(["Werkstattbesuche", n(r.CU) + n(r.CY) + n(r.DC) + n(r.DG)]);
  if (s.fuel) items.push(["Kraftstoff/Energie", n(r.BR)]);
  const subtotal = items.reduce((a, x) => a + n(x[1]), 0),
    surcharge = n(r.DV);
  return `<div class="charge-breakdown wide"><h3>Zusammensetzung aktueller Verrechnungsbetrag (${r.monthName} ${y})</h3>${items.map(([l, v]) => `<div><span>${esc(l)}</span><strong>${money(v)}</strong></div>`).join("")}<div><span>Zwischensumme</span><strong>${money(subtotal)}</strong></div>${surcharge ? `<div><span>Aufschlag (${num(surcharge)} %)</span><strong>${money((subtotal * surcharge) / 100)}</strong></div>` : ""}<div class="charge-total"><span>Interner Verrechnungsbetrag</span><strong>${money(r.DW)}</strong></div></div>`;
}
function renderAnnualMonthly() {
  const v = working();
  recalc(v, year);
  const rows = v.monthly[year],
    isInsurance = activeTab === "versicherung",
    annual =
      v.annual[year] || (v.annual[year] = { insuranceAnnual: 0, taxAnnual: 0 });
  const annualKey = isInsurance ? "insuranceAnnual" : "taxAnnual",
    annualLabel = isInsurance
      ? "Versicherungsbeitrag pro Jahr (€)"
      : "Steuer pro Jahr (€)",
    monthlyCols = isInsurance
      ? sections.versicherung.filter((c) => c !== "CD")
      : ["taxMonthly"];
  const hasMonthly = isInsurance
      ? rows.some((r) => n(r.BY) + n(r.BZ) + n(r.CB) > 0)
      : rows.some((r) => n(r.taxMonthly) > 0),
    hasAnnual = n(annual[annualKey]) > 0;

  const hint = hasMonthly
    ? `${isInsurance ? "Jahresbeitrag" : "Jahressteuer"} gesperrt, da monatliche Werte vorhanden sind.`
    : hasAnnual
      ? `Alle monatlichen ${isInsurance ? "Versicherungsfelder" : "Steuerfelder"} dieses Jahres sind gesperrt.`
      : `Alternativ kann der Betrag monatlich erfasst werden.`;

  let html = `<div class="content-panel"><div class="annual-entry ${hasMonthly ? "locked" : ""}"><label>${annualLabel}</label>${editing ? `<input id="annualValue" type="number" step="0.01" value="${round2(annual[annualKey])}" ${hasMonthly ? "disabled" : ""}>` : `<strong>${money(annual[annualKey])}</strong>`}<small>${hint}</small></div><div class="monthly-wrap"><table class="monthly-table"><thead><tr><th>Feld</th>${rows.map((r) => `<th>${r.monthName}</th>`).join("")}<th>Jahr</th></tr></thead><tbody>`;

  for (const col of monthlyCols) {
    const isTaxMonthly = col === "taxMonthly";
    const calc = !isTaxMonthly && calculatedCols.has(col);
    const label = isTaxMonthly ? "Steuer pro Monat (€)" : (headers[col] || col);
    html += `<tr class="${calc ? "calculated-row" : ""}"><td>${esc(label)}${calc ? " · berechnet" : ""}</td>`;
    let sum = 0;
    rows.forEach((r, i) => {
      const value = isTaxMonthly ? r.taxMonthly : r[col];
      sum += n(value);
      const lock = calc || (hasAnnual && (isTaxMonthly || ["BY", "BZ", "CB"].includes(col)));
      if (isTaxMonthly) {
        html += `<td>${editing ? `<input type="number" step="0.01" data-tax-month="${i}" value="${value === "" || value === null || value === undefined ? "" : esc(round2(value))}" ${lock ? "disabled" : ""}>` : money(r.CO)}</td>`;
      } else {
        html += `<td>${editing ? monthlyInput(col, value, i, lock) : displayMonthly(col, value)}</td>`;
      }
    });
    const annualSum = isTaxMonthly && hasAnnual ? n(annual.taxAnnual) : sum;
    html += `<td>${money(annualSum)}</td></tr>`;
  }
  html += "</tbody></table></div></div>";
  $("#tabContent").innerHTML = html;
  bindInputs();

  $$('[data-tax-month]').forEach((el) => {
    const handler = () => {
      const row = v.monthly?.[year]?.[Number(el.dataset.taxMonth)];
      if (!row) return;
      row.taxMonthly = el.value === "" ? "" : round2(el.value);
      recalc(v, year);
    };
    el.oninput = handler;
    el.onchange = () => {
      handler();
      renderAnnualMonthly();
    };
  });

  const inp = $("#annualValue");
  if (inp) {
    const updateAnnual = () => {
      annual[annualKey] = inp.value === "" ? 0 : round2(inp.value);
      recalc(v, year);
      renderAnnualMonthly();
    };
    inp.oninput = () => {
      annual[annualKey] = inp.value === "" ? 0 : round2(inp.value);
      recalc(v, year);
    };
    inp.onchange = updateAnnual;
  }
  applyMutualLocks();
}

function bindInputs() {
  if (!editing || !draft) return;
  $$("[data-path]").forEach((el) => {
    const handler = () => {
      const parts = el.dataset.path.split(".");
      if (parts[0] !== "master" || !parts[1]) return;
      const col = parts[1];
      draft.master[col] = el.value;
      if (col === "BA" && n(el.value) > 0) draft.master.BB = "";
      if (col === "BB" && n(el.value) > 0) draft.master.BA = "";
      for (const y of [2025, 2026, 2027, 2028, 2029, 2030])
        recalc(draft, String(y));
      if (["BA", "BB"].includes(col)) renderContent();
    };
    el.oninput = handler;
    el.onchange = handler;
  });
  $$("[data-month]").forEach((el) => {
    const handler = () => {
      const rows = draft.monthly?.[year];
      if (!rows) return;
      const row = rows[Number(el.dataset.month)],
        col = el.dataset.col;
      if (!row || !col) return;
      row[col] = el.value;
      recalc(draft, year);
    };
    el.oninput = handler;
    el.onchange = handler;
  });
  applyMutualLocks();
}
function applyMutualLocks() {
  if (!editing || !draft) return;
  if (activeTab === "finanzierung") {
    const leasing = $('[data-path="master.BA"]'),
      rent = $('[data-path="master.BB"]');
    if (leasing && rent) {
      leasing.disabled = n(draft.master.BB) > 0;
      rent.disabled = n(draft.master.BA) > 0;
    }
  }
  if (activeTab === "versicherung") {
    const annual = n(draft.annual?.[year]?.insuranceAnnual);
    const hasMonthly = (draft.monthly?.[year] || []).some(
      (r) => n(r.BY) + n(r.BZ) + n(r.CB) > 0,
    );
    const annualInput = $("#annualValue");
    if (annualInput) annualInput.disabled = hasMonthly;
    $$("[data-month]").forEach((el) => {
      if (["BY", "BZ", "CB"].includes(el.dataset.col)) el.disabled = annual > 0;
    });
  }
  if (activeTab === "steuern") {
    const annual = n(draft.annual?.[year]?.taxAnnual);
    const hasMonthly = (draft.monthly?.[year] || []).some((r) => n(r.taxMonthly) > 0);
    const annualInput = $("#annualValue");
    if (annualInput) annualInput.disabled = hasMonthly;
    $$("[data-tax-month]").forEach((el) => {
      el.disabled = annual > 0;
    });
  }
}

function formatValue(col, v) {
  if (v === "" || v === null || v === undefined) return "–";
  if (dateCols.has(col) && /^\d{4}-\d{2}-\d{2}$/.test(String(v)))
    return new Date(v + "T00:00:00").toLocaleDateString("de-DE");
  if (moneyCols.has(col)) return money(v);
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  return esc(v);
}
function recalc(v, y) {
  const rows = v.monthly[y] || [],
    annual = v.annual?.[y] || { insuranceAnnual: 0, taxAnnual: 0 };
  const prevRows = v.monthly[String(Number(y) - 1)] || [];
  let lastKnown =
    n([...prevRows].reverse().find((r) => n(r.BJ) > 0)?.BJ) || n(v.master.BH);
  rows.forEach((r, i) => {
    const km = n(r.BJ);
    r.BL = round2(km > 0 ? Math.max(0, km - lastKnown) : 0);
    if (km > 0) lastKnown = km;
    r.BP = round2(r.BL > 0 ? (n(r.BO) / r.BL) * 100 : 0);
    r.BQ = round2(r.BL > 0 ? n(r.BR) / r.BL : 0);
    const annualInsurance = n(annual.insuranceAnnual);
    r.CD = annualInsurance;
    r.CE = round2(
      annualInsurance > 0 ? annualInsurance / 12 : n(r.BY) + n(r.BZ) + n(r.CB),
    );
    const annualTax = n(annual.taxAnnual);
    r.CN = annualTax;
    r.CO = round2(annualTax > 0 ? annualTax / 12 : n(r.taxMonthly));
    r.DH = round2(n(r.CU) + n(r.CY) + n(r.DC) + n(r.DG));
    const ownerSame = (v.master.AN || "") === (v.master.AO || "");
    const shelf =
      String(v.master.AC).toLowerCase() === "ja" && n(v.master.AE) > 0
        ? n(v.master.AD) / n(v.master.AE)
        : 0;
    const buy = n(v.master.BF) > 0 ? n(v.master.AV) / n(v.master.BF) : 0;
    const fixedBuy = buy + shelf + r.CE + r.CO + n(r.CQ),
      fixedLease = n(v.master.BA) + shelf + r.CE + r.CO + n(r.CQ),
      fixedRent = n(v.master.BB) + shelf + r.CE + r.CO + n(r.CQ);
    r.DS = round2(fixedBuy);
    r.DT = round2(fixedLease);
    r.DU = round2(fixedRent);
    const workshop = n(r.CU) + n(r.CY) + n(r.DC) + n(r.DG),
      fuel = n(r.BR);
    r.DJ = round2(ownerSame && buy > 0 ? fixedBuy + workshop + fuel : 0);
    r.DK = round2(
      ownerSame && n(v.master.BA) > 0 ? fixedLease + workshop + fuel : 0,
    );
    r.DL = round2(
      ownerSame && n(v.master.BB) > 0 ? fixedRent + workshop + fuel : 0,
    );
    const baseCharge = calcCharge(v, r);
    r.DW = round2(baseCharge);
    r.DM = round2(!ownerSame ? baseCharge : 0);
    r.DN = round2(
      !ownerSame && buy > 0 ? Math.max(0, fixedBuy - baseCharge) : 0,
    );
    r.DO = round2(
      !ownerSame && n(v.master.BA) > 0
        ? Math.max(0, fixedLease - baseCharge)
        : 0,
    );
    r.DP = round2(
      !ownerSame && n(v.master.BB) > 0
        ? Math.max(0, fixedRent - baseCharge)
        : 0,
    );
    const ownerCost = r.DL || r.DK || r.DJ;
    r.DQ = round2(r.BL > 0 ? ownerCost / r.BL : 0);
    r.DR = round2(r.BL > 0 ? r.DM / r.BL : 0);
  });
  const annualKm = round2(rows.reduce((a, r) => a + n(r.BL), 0)),
    annualFuel = round2(rows.reduce((a, x) => a + n(x.BR), 0));
  rows.forEach((r) => {
    r.BM = annualKm;
    r.BS = annualFuel;
  });
  const now = new Date();
  if (String(now.getFullYear()) === String(y))
    v.master.AP = rows[now.getMonth()]?.DW || 0;
}
function calcCharge(v, r) {
  if ((v.master.AN || "") === (v.master.AO || "")) return 0;
  const s = v.costSettings || costDefaults;
  let base = 0;
  if (s.financing)
    base +=
      n(v.master.BA) > 0
        ? n(v.master.BA)
        : n(v.master.BB) > 0
          ? n(v.master.BB)
          : 0;
  if (
    s.shelf &&
    String(v.master.AC).toLowerCase() === "ja" &&
    n(v.master.AE) > 0
  )
    base += n(v.master.AD) / n(v.master.AE);
  if (s.insurance) base += n(r.CE);
  if (s.tax) base += n(r.CO);
  if (s.service) base += n(r.CQ);
  if (s.workshop) base += n(r.CU) + n(r.CY) + n(r.DC) + n(r.DG);
  if (s.fuel) base += n(r.BR);
  return round2(base * (1 + n(r.DV) / 100));
}
function renderMonthly() {
  const v = working();
  recalc(v, year);
  const rows = v.monthly[year];
  if (activeTab === "wartung") return renderWorkshopMonthly(v, rows);
  const cols =
    activeTab === "verbrauch"
      ? sections[activeTab].filter((c) => c !== "BS")
      : sections[activeTab];
  let html = '<div class="content-panel">';
  if (activeTab === "kosten") {
    html += costSettings(v);
    const diff = (v.master.AN || "") !== (v.master.AO || "");
    html += `<div class="notice ${diff ? "" : "ok"}">${diff ? "Eigentümer und Nutzer sind unterschiedlich. Monatliche Verrechnungsbeträge werden berechnet." : "Eigentümer und Nutzer sind identisch. Ein interner Verrechnungsbetrag ist nicht erforderlich."}</div>`;
  }
  html +=
    '<div class="monthly-wrap"><table class="monthly-table"><thead><tr><th>Feld</th>' +
    rows.map((r) => `<th>${r.monthName}</th>`).join("") +
    "<th>Jahr</th></tr></thead><tbody>";
  for (const col of cols) {
    const calc = calculatedCols.has(col);
    html += `<tr class="${calc ? "calculated-row" : ""}"><td>${esc(headers[col] || col)}${calc ? " · berechnet" : ""}</td>`;
    let sum = 0;
    rows.forEach((r, i) => {
      sum += n(r[col]);
      html += `<td>${editing ? monthlyInput(col, r[col], i, calc) : displayMonthly(col, r[col])}</td>`;
    });
    html += `<td>${moneyCols.has(col) ? money(sum) : num(sum)}</td></tr>`;
  }
  html += "</tbody></table></div>";
  if (activeTab === "kosten") html += costSummary(v, rows);
  html += "</div>";
  $("#tabContent").innerHTML = html;
  bindInputs();
  bindCostSettings();
  applyMutualLocks();
}
function renderWorkshopMonthly(v, rows) {
  const groups = [
    ["CR", "CS", "CU"],
    ["CV", "CW", "CY"],
    ["CZ", "DA", "DC"],
    ["DD", "DE", "DG"],
  ];
  let html =
    '<div class="content-panel"><div class="monthly-wrap"><table class="monthly-table workshop-table"><thead><tr><th>Werkstattbesuch / Feld</th>' +
    rows.map((r) => `<th>${r.monthName}</th>`).join("") +
    "<th>Jahr</th></tr></thead><tbody>";
  html += workshopRow("CQ", "Wartungs-/Servicevertrag €/Monat", rows, false);
  groups.forEach((g, idx) => {
    html += `<tr class="workshop-divider"><td colspan="14">Werkstattbesuch ${idx + 1}</td></tr>`;
    html += workshopRow(g[0], "Name der Werkstatt", rows, false);
    html += workshopRow(g[1], "Kurzbeschreibung", rows, false);
    html += workshopRow(g[2], "Kosten netto (€)", rows, false);
  });
  html += workshopRow("DH", "Werkstattkosten gesamt (€)", rows, true);
  html += "</tbody></table></div></div>";
  $("#tabContent").innerHTML = html;
  bindInputs();
}
function workshopRow(col, label, rows, calc) {
  let sum = 0,
    html = `<tr class="${calc ? "calculated-row" : ""}"><td>${esc(label)}${calc ? " · berechnet" : ""}</td>`;
  rows.forEach((r, i) => {
    sum += n(r[col]);
    html += `<td>${editing ? monthlyInput(col, r[col], i, calc) : displayMonthly(col, r[col])}</td>`;
  });
  return html + `<td>${moneyCols.has(col) ? money(sum) : num(sum)}</td></tr>`;
}
function monthlyInput(col, val, i, disabled) {
  if (dropdowns[col])
    return `<select data-month="${i}" data-col="${col}" ${disabled ? "disabled" : ""}><option value=""></option>${dropdowns[col].map((x) => `<option ${String(val) === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const type = dateCols.has(col)
    ? "date"
    : moneyCols.has(col) || ["BH", "BJ", "BL", "BM", "BO", "BP"].includes(col)
      ? "number"
      : "text";
  const shown =
    type === "number" && val !== "" && val !== null && val !== undefined
      ? round2(val)
      : val;
  return `<input data-month="${i}" data-col="${col}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(shown)}" ${disabled ? "disabled" : ""}>`;
}
function displayMonthly(col, v) {
  if (v === "" || v === null || v === undefined) return "–";
  return moneyCols.has(col) ? money(v) : num(v);
}
function costSettings(v) {
  const s = v.costSettings || costDefaults;
  return `<div class="cost-settings"><h3>Zu verrechnende Kosten auswählen</h3><div class="cost-options">${[
    ["financing", "Anschaffung / Finanzierung"],
    ["shelf", "Regalsystem"],
    ["insurance", "Versicherung"],
    ["tax", "Steuern"],
    ["service", "Wartungs-/Servicevertrag"],
    ["workshop", "Werkstattkosten"],
    ["fuel", "Kraftstoff & Energie"],
  ]
    .map(
      ([k, l]) =>
        `<label><input type="checkbox" data-cost="${k}" ${s[k] ? "checked" : ""} ${editing ? "" : "disabled"}>${l}</label>`,
    )
    .join("")}</div></div>`;
}
function costSummary(v, rows) {
  const charges = rows.map((r) => n(r.DW)),
    km = rows.reduce((a, r) => a + n(r.BL), 0),
    ownerCosts = rows.reduce(
      (a, r) => a + n(r.DJ) + n(r.DK) + n(r.DL) + n(r.DN) + n(r.DO) + n(r.DP),
      0,
    ),
    userCosts = rows.reduce((a, r) => a + n(r.DM), 0),
    avg = km ? (ownerCosts + userCosts) / km : 0;
  return `<div class="summary-box"><div>Interne Verrechnung ${year}<strong>${money(charges.reduce((a, b) => a + b, 0))}</strong></div><div>Kosten Eigentümer / km<strong>${km ? money(ownerCosts / km) : money(0)}</strong></div><div>Gesamtlaufleistung<strong>${num(km)} km</strong></div><div>Durchschnittliche Gesamtkosten / Jahr / km<strong>${money(avg)}</strong></div><div>Kosten Nutzer / km<strong>${km ? money(userCosts / km) : money(0)}</strong></div></div>`;
}
function bindCostSettings() {
  $$("[data-cost]").forEach(
    (el) =>
      (el.onchange = () => {
        draft.costSettings = {
          ...(draft.costSettings || costDefaults),
          [el.dataset.cost]: el.checked,
        };
        recalc(draft, year);
        renderContent();
      }),
  );
}
async function saveEdits() {
  showLoading("Fahrzeug speichern", "Änderungen werden geprüft und gespeichert …");
  await waitForLoadingPaint();
  try {
    if (!canWrite())
      throw new Error("Für diese Aktion fehlt die Berechtigung.");
    if (!editing || !draft)
      throw new Error("Es ist kein Bearbeitungsdatensatz vorhanden.");
    const index = vehicles.findIndex((v) => v.id === selectedId);
    if (index < 0) throw new Error("Das Fahrzeug wurde nicht gefunden.");
    for (const y of [2025, 2026, 2027, 2028, 2029, 2030])
      recalc(draft, String(y));
    draft.displayName =
      [draft.master.F, draft.master.G].filter(Boolean).join("-") ||
      draft.master.G ||
      draft.master.L ||
      "Neues Fahrzeug";
    draft.ownerDiffers = Boolean(
      draft.master.AN && draft.master.AO && draft.master.AN !== draft.master.AO,
    );
    addHistory(
      draft,
      "Fahrzeugdaten gespeichert",
      `Änderungen im Reiter ${tabs.find((t) => t[0] === activeTab)?.[1] || activeTab}`,
    );
    vehicles[index] = structuredClone(draft);
    await persistVehicle(vehicles[index]);
    editing = false;
    draft = null;
    toggleEdit();
    renderHeader();
    renderList();
    renderContent();
  } catch (err) {
    console.error(err);
    alert("Die Änderungen konnten nicht gespeichert werden: " + err.message);
  } finally {
    hideLoading();
  }
}
function archiveVehicle() {
  if (!canWrite()) return alert("Für diese Aktion fehlt die Berechtigung.");
  const v = draft;
  v.archived = !v.archived;
  if (v.archived) v.active = false;
  addHistory(
    v,
    v.archived ? "Fahrzeug archiviert" : "Fahrzeug aus Archiv geholt",
    "Statusänderung",
  );
  saveEdits();
  currentView = v.archived ? "archive" : "all";
  $$("#viewSwitch button").forEach((x) =>
    x.classList.toggle("active", x.dataset.view === currentView),
  );
  renderList();
}
async function deleteVehicle() {
  if (!isAdmin()) return alert("Nur Administratoren dürfen Fahrzeuge löschen.");
  if (
    !confirm(
      "Fahrzeug endgültig löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.",
    )
  )
    return;
  showLoading("Fahrzeug löschen", "Fahrzeug wird entfernt …");
  try {
    if (!DEMO_MODE) await deleteDoc(doc(fleetDb, "vehicles", selectedId));
    vehicles = vehicles.filter((v) => v.id !== selectedId);
    if (DEMO_MODE) await saveDemoData();
    showDashboard();
  } finally {
    hideLoading();
  }
}
async function addVehicle(e) {
  e.preventDefault();
  if (!canWrite()) return alert("Für diese Aktion fehlt die Berechtigung.");
  const f = new FormData(e.target),
    master = {
      F: f.get("prefix"),
      G: f.get("plate"),
      I: f.get("brand"),
      J: f.get("model"),
      K: f.get("type"),
      L: f.get("vin"),
          };
  const v = {
    id: crypto.randomUUID(),
    position: vehicles.length + 1,
    active: true,
    archived: false,
    displayName: [master.F, master.G].filter(Boolean).join("-") || master.G,
    master,
    monthly: {},
    appointments: [],
    documents: [],
    history: [],
    annual: {},
    costSettings: { ...costDefaults },
  };
  for (const y of [2025, 2026, 2027, 2028, 2029, 2030]) {
    v.monthly[String(y)] = createMonths(y);
    v.annual[String(y)] = { insuranceAnnual: 0, taxAnnual: 0 };
  }
  addHistory(v, "Fahrzeug angelegt", "Neuer Fahrzeugdatensatz");
  showLoading("Fahrzeug anlegen", "Neuer Fahrzeugdatensatz wird gespeichert …");
  try {
    vehicles.unshift(v);
    await persistVehicle(v);
    closeModal("vehicleModal");
    e.target.reset();
    selectVehicle(v.id);
    editing = true;
    draft = structuredClone(v);
    toggleEdit();
    renderContent();
  } finally {
    hideLoading();
  }
}
function renderAppointments() {
  const v = working(),
    list = [...(v.appointments || [])].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    ),
    today = isoToday();
  const writable = canWrite();
  $("#tabContent").innerHTML =
    `<div class="content-panel"><div class="appointments-head"><div><h3>Termine</h3><small>${list.filter((x) => !x.done).length} offen · ${list.filter((x) => x.done).length} erledigt</small></div>${writable ? '<button id="addAppointment">+ Termin</button>' : ""}</div><div class="appointment-list">${list.length ? list.map((a) => `<div class="appointment ${a.done ? "done" : ""} ${!a.done && a.date < today ? "overdue" : ""}"><div><strong>${formatDate(a.date)}</strong><small>${esc(a.type || "Termin")}</small></div><div class="desc"><strong>${esc(a.description || "Ohne Beschreibung")}</strong><small>${esc(a.workshop || "Keine Werkstatt")}</small></div><div>${a.mileage ? num(a.mileage) + " km" : "–"}</div>${writable ? `<div class="appointment-actions"><button class="success" data-done="${a.id}">${a.done ? "Öffnen" : "Erledigt"}</button><button class="danger" data-delete="${a.id}">Löschen</button></div>` : "<div></div>"}</div>`).join("") : "<p>Noch keine Termine vorhanden.</p>"}</div></div>`;
  if (writable)
    $("#addAppointment").onclick = () => openModal("appointmentModal");
  $$("[data-done]").forEach(
    (b) =>
      (b.onclick = async () => {
        const target = working();
        const a = target.appointments.find((x) => x.id === b.dataset.done);
        if (!a) return;
        a.done = !a.done;
        addHistory(
          target,
          a.done ? "Termin erledigt" : "Termin wieder geöffnet",
          `${a.type} am ${formatDate(a.date)}`,
        );
        if (!editing) {
          showLoading("Termin aktualisieren", "Terminstatus wird gespeichert …");
          try {
            await persistVehicle(target);
          } finally {
            hideLoading();
          }
        }
        renderAppointments();
      }),
  );
  $$("[data-delete]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("Termin wirklich löschen?")) return;
        const target = working(),
          a = target.appointments.find((x) => x.id === b.dataset.delete);
        target.appointments = target.appointments.filter(
          (x) => x.id !== b.dataset.delete,
        );
        addHistory(
          target,
          "Termin gelöscht",
          a ? `${a.type} am ${formatDate(a.date)}` : "",
        );
        if (!editing) {
          showLoading("Termin löschen", "Termin wird gespeichert …");
          try {
            await persistVehicle(target);
          } finally {
            hideLoading();
          }
        }
        renderAppointments();
      }),
  );
}
async function addAppointment(e) {
  e.preventDefault();
  if (!canWrite()) return alert("Für diese Aktion fehlt die Berechtigung.");
  const f = new FormData(e.target),
    v = working();
  if (!v) return alert("Bitte zuerst ein Fahrzeug auswählen.");
  const date = String(f.get("date") || "");
  if (!date) return alert("Bitte ein Termindatum eingeben.");
  const a = {
    id: crypto.randomUUID(),
    type: String(f.get("type") || "Termin"),
    date,
    workshop: String(f.get("workshop") || ""),
    mileage: round2(f.get("mileage")),
    description: String(f.get("description") || ""),
    done: false,
  };
  v.appointments = v.appointments || [];
  v.appointments.push(a);
  addHistory(v, "Termin angelegt", `${a.type} am ${formatDate(a.date)}`);
  showLoading("Termin speichern", "Termin wird übernommen …");
  try {
    if (!editing) await persistVehicle(v);
    e.target.reset();
    closeModal("appointmentModal");
    renderAppointments();
  } finally {
    hideLoading();
  }
}
function formatDate(v) {
  return v
    ? new Date(v + "T00:00:00").toLocaleDateString("de-DE")
    : "Ohne Datum";
}
async function renderDamageRegulation() {
  const v = current(),
    files = v.damageFiles || [];
  const writable = canWrite();
  $("#tabContent").innerHTML =
    `<div class="content-panel"><div class="documents-head"><div><h3>Schadenregulierung</h3><small>${files.length} Datei(en) zum Schadenfall, gespeichert im zentralen KalkPro-Storage</small></div></div>${writable ? '<div class="upload-box"><strong>Dokumente und Fotos zur Schadenregulierung hinzufügen</strong><p>Fotos bis 5 MB sowie PDF-, Word-, Excel-, PowerPoint- und Textdateien bis 10 MB.</p><input id="damageFileUpload" type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp"></div>' : ""}<div class="document-list">${files.length ? files.map((f) => `<div class="document-row"><div class="${String(f.contentType || "").startsWith("image/") ? "" : "doc-icon"}">${String(f.contentType || "").startsWith("image/") ? "🖼️" : "📄"}</div><div><strong>${esc(f.name)}</strong><small>${new Date(f.uploadedAt).toLocaleString("de-DE")} · ${Math.round(n(f.size) / 1024)} KB</small></div><div>${esc(f.category || "Schadendokument")}</div><div class="document-actions"><button data-open-damage-file="${f.id}">Öffnen</button>${writable ? `<button class="danger" data-delete-damage-file="${f.id}">Löschen</button>` : ""}</div></div>`).join("") : "<p>Noch keine Dokumente oder Fotos zur Schadenregulierung vorhanden.</p>"}</div></div>`;

  if (writable) $("#damageFileUpload").onchange = uploadDamageFiles;
  $$('[data-open-damage-file]').forEach((b) =>
    (b.onclick = async () => {
      try {
        const file = v.damageFiles.find((x) => x.id === b.dataset.openDamageFile);
        if (!file) return;
        showLoading("Datei öffnen", `${file.name} wird vorbereitet …`);
        await openVehicleFile(v.id, file);
      } catch (err) {
        console.error(err);
        alert(err.message || "Datei konnte nicht geöffnet werden.");
      } finally {
        hideLoading();
      }
    }),
  );
  $$('[data-delete-damage-file]').forEach((b) =>
    (b.onclick = async () => {
      if (!confirm("Datei zur Schadenregulierung wirklich löschen?")) return;
      try {
        const file = v.damageFiles.find((x) => x.id === b.dataset.deleteDamageFile);
        if (!file) return;
        showLoading("Datei löschen", `${file.name} wird gelöscht …`);
        await removeVehicleFile(v.id, file);
        v.damageFiles = v.damageFiles.filter((x) => x.id !== file.id);
        addHistory(v, "Schadendatei gelöscht", file.name);
        await persistVehicle(v);
        renderDamageRegulation();
      } catch (err) {
        console.error(err);
        alert(err.message || "Datei konnte nicht gelöscht werden.");
      } finally {
        hideLoading();
      }
    }),
  );
}

async function uploadDamageFiles(e) {
  if (!canWrite()) return alert("Für diese Aktion fehlt die Berechtigung.");
  const input = e.target;
  input.disabled = true;
  const filesToUpload = Array.from(input.files || []);
  showLoading("Schadendateien hochladen", `${filesToUpload.length} Datei(en) werden vorbereitet …`, 0);
  await waitForLoadingPaint();
  try {
    const v = current();
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      updateLoading(`Datei ${i + 1} von ${filesToUpload.length}: ${file.name}`, (i / Math.max(1, filesToUpload.length)) * 90);
      if (DEMO_MODE) {
        const meta = await storeDemoFile(v.id, file, "damage");
        meta.category = String(meta.contentType || "").startsWith("image/") ? "Schadenfoto" : "Schadendokument";
        v.damageFiles = v.damageFiles || [];
        v.damageFiles.push(meta);
        addHistory(v, "Schadendatei hochgeladen", file.name);
        continue;
      }
      const base64Data = await fileToBase64(file);
      const upload = httpsCallable(blazeFunctions, "uploadFleetVehicleFile");
      const result = await upload({
        idToken: await fleetAuth.currentUser.getIdToken(),
        vehicleId: v.id,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        base64Data,
      });
      const meta = result.data?.file;
      if (!meta) throw new Error(`Upload von ${file.name} ohne Rückmeldung.`);
      meta.category = String(meta.contentType || "").startsWith("image/") ? "Schadenfoto" : "Schadendokument";
      v.damageFiles = v.damageFiles || [];
      v.damageFiles.push(meta);
      addHistory(v, "Schadendatei hochgeladen", file.name);
    }
    updateLoading("Dateimetadaten werden gespeichert …", 95);
    await persistVehicle(v);
    updateLoading("Upload abgeschlossen.", 100);
    await renderDamageRegulation();
  } catch (err) {
    console.error(err);
    alert(err.message || "Upload fehlgeschlagen.");
  } finally {
    input.disabled = false;
    input.value = "";
    hideLoading();
  }
}

async function renderDocuments() {
  const v = current(),
    files = v.documents || [];
  const writable = canWrite();
  $("#tabContent").innerHTML =
    `<div class="content-panel"><div class="documents-head"><div><h3>Dokumente und Fotos</h3><small>${files.length} Datei(en), gespeichert im zentralen KalkPro-Storage</small></div></div>${writable ? '<div class="upload-box"><strong>Dateien hinzufügen</strong><p>Fotos bis 5 MB sowie PDF-, Word-, Excel-, PowerPoint- und Textdateien bis 10 MB.</p><input id="fileUpload" type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp"></div>' : ""}<div class="document-list">${files.length ? files.map((f) => `<div class="document-row"><div class="${String(f.contentType || "").startsWith("image/") ? "" : "doc-icon"}">${String(f.contentType || "").startsWith("image/") ? "🖼️" : "📄"}</div><div><strong>${esc(f.name)}</strong><small>${new Date(f.uploadedAt).toLocaleString("de-DE")} · ${Math.round(n(f.size) / 1024)} KB</small></div><div>${esc(f.category || "Dokument")}</div><div class="document-actions"><button data-open-file="${f.id}">Öffnen</button>${writable ? `<button class="danger" data-delete-file="${f.id}">Löschen</button>` : ""}</div></div>`).join("") : "<p>Noch keine Dokumente oder Fotos vorhanden.</p>"}</div></div>`;
  if (writable) $("#fileUpload").onchange = uploadFiles;
  $$("[data-open-file]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const file = v.documents.find((x) => x.id === b.dataset.openFile);
          if (!file) return;
          showLoading("Datei öffnen", `${file.name} wird vorbereitet …`);
          await openVehicleFile(v.id, file);
        } catch (err) {
          console.error(err);
          alert(err.message || "Datei konnte nicht geöffnet werden.");
        } finally {
          hideLoading();
        }
      }),
  );
  $$("[data-delete-file]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("Datei wirklich löschen?")) return;
        try {
          const file = v.documents.find((x) => x.id === b.dataset.deleteFile);
          if (!file) return;
          showLoading("Datei löschen", `${file.name} wird gelöscht …`);
          await removeVehicleFile(v.id, file);
          v.documents = v.documents.filter((x) => x.id !== file.id);
          addHistory(v, "Datei gelöscht", file.name);
          await persistVehicle(v);
          renderDocuments();
        } catch (err) {
          console.error(err);
          alert(err.message || "Datei konnte nicht gelöscht werden.");
        } finally {
          hideLoading();
        }
      }),
  );
}
async function uploadFiles(e) {
  if (!canWrite()) return alert("Für diese Aktion fehlt die Berechtigung.");
  const input = e.target;
  input.disabled = true;
  const filesToUpload = Array.from(input.files || []);
  showLoading("Dateien hochladen", `${filesToUpload.length} Datei(en) werden vorbereitet …`, 0);
  await waitForLoadingPaint();
  try {
    const v = current();
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      updateLoading(`Datei ${i + 1} von ${filesToUpload.length}: ${file.name}`, (i / Math.max(1, filesToUpload.length)) * 90);
      if (DEMO_MODE) {
        const meta = await storeDemoFile(v.id, file, "documents");
        v.documents = v.documents || [];
        v.documents.push(meta);
        addHistory(v, "Datei hochgeladen", file.name);
        continue;
      }
      const base64Data = await fileToBase64(file);
      const upload = httpsCallable(blazeFunctions, "uploadFleetVehicleFile");
      const result = await upload({
        idToken: await fleetAuth.currentUser.getIdToken(),
        vehicleId: v.id,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        base64Data,
      });
      const meta = result.data?.file;
      if (!meta) throw new Error(`Upload von ${file.name} ohne Rückmeldung.`);
      v.documents = v.documents || [];
      v.documents.push(meta);
      addHistory(v, "Datei hochgeladen", file.name);
    }
    updateLoading("Dateimetadaten werden gespeichert …", 95);
    await persistVehicle(v);
    updateLoading("Upload abgeschlossen.", 100);
    await renderDocuments();
  } catch (err) {
    console.error(err);
    alert(err.message || "Upload fehlgeschlagen.");
  } finally {
    input.disabled = false;
    input.value = "";
    hideLoading();
  }
}
async function storeDemoFile(vehicleId, file, area) {
  const id = crypto.randomUUID();
  await dbPut({ id, vehicleId, area, blob: file, name: file.name, contentType: file.type });
  return { id, path: `local/${vehicleId}/${id}`, name: file.name, contentType: file.type || "application/octet-stream", size: file.size, uploadedAt: new Date().toISOString(), local: true };
}
async function openVehicleFile(vehicleId, file) {
  if (DEMO_MODE || file.local) {
    const stored = await dbGet(file.id);
    if (!stored?.blob) throw new Error("Die lokale Testdatei ist in diesem Browser nicht mehr vorhanden.");
    const url = URL.createObjectURL(stored.blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  const getUrls = httpsCallable(blazeFunctions, "getFleetVehicleFileUrls");
  const result = await getUrls({ vehicleId, paths: [file.path] });
  const url = result.data?.files?.[0]?.url;
  if (!url) throw new Error("Datei konnte nicht geöffnet werden.");
  window.open(url, "_blank", "noopener");
}
async function removeVehicleFile(vehicleId, file) {
  if (DEMO_MODE || file.local) return dbDelete(file.id);
  const del = httpsCallable(blazeFunctions, "deleteFleetVehicleFile");
  await del({ vehicleId, path: file.path });
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () =>
      reject(reader.error || new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function addHistory(v, action, details = "") {
  v.history = v.history || [];
  v.history.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    user: currentUser?.email || "System",
    action,
    details,
  });
  if (v.history.length > 500) v.history.length = 500;
}
function openHistory(vehicleId = null) {
  const list = (
    vehicleId
      ? vehicles.find((v) => v.id === vehicleId)?.history || []
      : vehicles.flatMap((v) =>
          (v.history || []).map((h) => ({
            ...h,
            vehicle: v.displayName,
            vehicleId: v.id,
          })),
        )
  ).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  $("#historyTitle").textContent = vehicleId
    ? `Historie – ${vehicles.find((v) => v.id === vehicleId)?.displayName || ""}`
    : "Gesamte Historie";
  $("#historyList").innerHTML = list.length
    ? list
        .map(
          (h) =>
            `<div class="history-row"><div><strong>${esc(h.action)}</strong><small>${new Date(h.timestamp).toLocaleString("de-DE")} · ${esc(h.user || "")}</small></div><div>${vehicleId ? "" : `<button class="link-btn" data-history-vehicle="${h.vehicleId}">${esc(h.vehicle || "")}</button>`}<p>${esc(h.details || "")}</p></div></div>`,
        )
        .join("")
    : "<p>Noch keine Historieneinträge vorhanden.</p>";
  openModal("historyModal");
  $$("[data-history-vehicle]").forEach(
    (b) =>
      (b.onclick = () => {
        closeModal("historyModal");
        selectVehicle(b.dataset.historyVehicle);
      }),
  );
}
function dashboardPeriodLabel(date) {
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}
function dashboardMonthData(date) {
  const y = String(date.getFullYear()),
    m = date.getMonth();
  let charge = 0,
    workshop = 0;
  for (const v of vehicles.filter((x) => !x.archived)) {
    if (!v.monthly?.[y]) continue;
    recalc(v, y);
    const r = v.monthly[y][m];
    if (!r) continue;
    charge += n(r.DW);
    workshop += n(r.CU) + n(r.CY) + n(r.DC) + n(r.DG);
  }
  return { charge: round2(charge), workshop: round2(workshop) };
}
function dashboardLastTwelveMonths() {
  const out = [],
    now = new Date();
  for (let offset = 11; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1),
      data = dashboardMonthData(d);
    out.push({
      date: d,
      label: d.toLocaleDateString("de-DE", { month: "short" }),
      ...data,
    });
  }
  return out;
}
function dashboardLatestChanges() {
  return vehicles
    .flatMap((v) =>
      (v.history || []).map((h) => ({
        ...h,
        vehicleId: v.id,
        vehicle: v.displayName,
      })),
    )
    .sort((a, b) =>
      String(b.timestamp || "").localeCompare(String(a.timestamp || "")),
    )
    .slice(0, 8);
}
function dashboardLatestFiles(limit = 8) {
  const list = vehicles
    .flatMap((v) =>
      (v.documents || []).map((f) => ({
        ...f,
        vehicleId: v.id,
        vehicle: v.displayName,
      })),
    )
    .sort((a, b) =>
      String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")),
    );
  return Number.isFinite(limit) ? list.slice(0, limit) : list;
}
function dashboardAlerts() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const alerts = [];
  const addAlert = (v, type, date, days, enabled, source = "master") => {
    if (!enabled || !date) return;
    const d = new Date(date + "T00:00:00");
    if (Number.isNaN(d.getTime())) return;
    const limit = new Date(today);
    limit.setDate(limit.getDate() + Number(days || 0));
    if (d <= limit) {
      const diff = Math.round((d - today) / 86400000);
      alerts.push({
        vehicle: v,
        type,
        date,
        status: d < today ? "overdue" : "soon",
        source,
        daysDifference: diff,
      });
    }
  };
  for (const v of vehicles.filter((x) => !x.archived)) {
    addAlert(v, "HU / TÜV", v.master.P, settings.huDays, settings.remindHu);
    addAlert(v, "UVV", v.master.R, settings.uvvDays, settings.remindUvv);
    addAlert(
      v,
      "Verbandkasten",
      v.master.AK,
      settings.firstAidDays,
      settings.remindFirstAid,
    );
    for (const a of v.appointments || []) {
      if (a.done) continue;
      addAlert(
        v,
        a.type || "Termin",
        a.date,
        settings.appointmentDays,
        settings.remindAppointments,
        "appointment",
      );
    }
  }
  return alerts.sort((a, b) => a.date.localeCompare(b.date));
}

function parseIsoDateLocal(value) {
  if (!value) return null;
  const parts = String(value).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return null;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}
function addMonthsClamped(date, months) {
  const result = new Date(date.getFullYear(), date.getMonth(), 1);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  result.setHours(23, 59, 59, 999);
  return result;
}
function dashboardLeasingContracts() {
  if (!settings.remindLeasing) return [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + Math.max(0, Number(settings.leasingDays) || 0));
  horizon.setHours(23, 59, 59, 999);
  return vehicles
    .filter((v) => {
      if (v.archived) return false;
      const financing = String(v.master?.AW || "").toLowerCase();
      if (!financing.includes("leasing")) return false;
      const endDate = parseIsoDateLocal(v.master?.AZ);
      return endDate && endDate <= horizon;
    })
    .map((v) => {
      const endDate = parseIsoDateLocal(v.master.AZ);
      const diffMs = endDate.getTime() - today.getTime();
      const daysDifference = Math.ceil(diffMs / 86400000);
      return {
        vehicle: v,
        endDate,
        daysDifference,
        status: daysDifference < 0 ? "overdue" : "soon",
        dismissed: Boolean(v.leasingReminderDismissed),
      };
    })
    .sort((a, b) => a.endDate - b.endDate);
}
async function setLeasingReminderDismissed(vehicleId, dismissed) {
  if (!canWrite()) return;
  const v = vehicles.find((x) => x.id === vehicleId);
  if (!v) return;
  v.leasingReminderDismissed = Boolean(dismissed);
  addHistory(
    v,
    dismissed ? "Leasing-Erinnerung ausgeblendet" : "Leasing-Erinnerung aktiviert",
    v.master.AZ ? `Leasingende: ${formatDate(v.master.AZ)}` : "",
  );
  showLoading(
    dismissed ? "Erinnerung ausblenden" : "Erinnerung aktivieren",
    "Einstellung wird gespeichert …",
  );
  await waitForLoadingPaint();
  try {
    await persistVehicle(v);
    renderDashboardLeasingDetail();
    renderDashboard();
  } catch (err) {
    v.leasingReminderDismissed = !dismissed;
    console.error(err);
    alert("Die Einstellung konnte nicht gespeichert werden: " + (err.message || err));
    renderDashboardLeasingDetail();
  } finally {
    hideLoading();
  }
}
function renderDashboardLeasingDetail() {
  const rows = dashboardLeasingContracts();
  const activeRows = rows.filter((x) => !x.dismissed);
  const hiddenRows = rows.filter((x) => x.dismissed);
  dashboardDetailBase(
    "Auslaufende/ausgelaufene Leasingverträge",
    `${activeRows.length} aktive Erinnerung(en) · ${hiddenRows.length} ausgeblendet`,
  );
  $("#dashboardDetailContent").innerHTML = rows.length
    ? `<div class="dashboard-detail-table leasing-detail-table">
        <div class="dashboard-detail-head leasing-detail-head">
          <span>Fahrzeug</span><span>Leasingende</span><span>Status</span><span>Nicht mehr erinnern</span><span></span>
        </div>
        ${rows.map((x) => {
          const statusText = x.daysDifference < 0
            ? `${Math.abs(x.daysDifference)} Tag(e) ausgelaufen`
            : x.daysDifference === 0
              ? "läuft heute aus"
              : `läuft in ${x.daysDifference} Tag(en) aus`;
          return `<div class="dashboard-detail-row leasing-detail-row ${x.dismissed ? "dismissed" : x.status}">
            <span><strong>${esc(x.vehicle.displayName || "Fahrzeug")}</strong><small>${esc(x.vehicle.master.I || "")} ${esc(x.vehicle.master.J || "")}</small></span>
            <span>${formatDate(x.vehicle.master.AZ)}</span>
            <span><strong>${esc(statusText)}</strong>${x.dismissed ? "<small>Erinnerung ausgeblendet</small>" : ""}</span>
            <span class="leasing-dismiss-cell"><label><input type="checkbox" data-leasing-dismiss="${x.vehicle.id}" ${x.dismissed ? "checked" : ""} ${canWrite() ? "" : "disabled"}> nicht mehr erinnern</label></span>
            <span><button data-dashboard-open="${x.vehicle.id}" data-dashboard-tab="finanzierung">Öffnen</button></span>
          </div>`;
        }).join("")}
      </div>`
    : `<p class="empty-dashboard">${settings.remindLeasing
      ? `Keine ausgelaufenen oder innerhalb der nächsten ${Number(settings.leasingDays) || 0} Tage auslaufenden Leasingverträge vorhanden.`
      : "Die Erinnerung an Leasingenden ist in den allgemeinen Einstellungen deaktiviert."}</p>`;
  $$("[data-dashboard-open]").forEach(
    (b) => (b.onclick = () => openDashboardVehicle(b.dataset.dashboardOpen, b.dataset.dashboardTab)),
  );
  $$("[data-leasing-dismiss]").forEach(
    (el) => (el.onchange = () => setLeasingReminderDismissed(el.dataset.leasingDismiss, el.checked)),
  );
}

function dashboardSeverity(count) {
  return count === 0
    ? "status-good"
    : count <= 5
      ? "status-warning"
      : "status-danger";
}
function setVehicleView(view) {
  currentView = view;
  $$("#viewSwitch button").forEach((x) =>
    x.classList.toggle("active", x.dataset.view === view),
  );
  renderList();
}
function openDashboardVehicle(vehicleId, tab = "stammdaten") {
  selectVehicle(vehicleId);
  activeTab = tab;
  renderTabs();
  renderContent();
  closeModal("dashboardDetailModal");
}
function dashboardDetailBase(title, subtitle = "") {
  $("#dashboardDetailTitle").textContent = title;
  $("#dashboardDetailSubtitle").textContent = subtitle;
  $("#dashboardDetailFilters").classList.add("hidden");
  $("#dashboardDetailFilters").innerHTML = "";
  $("#dashboardDetailContent").innerHTML = "";
  openModal("dashboardDetailModal");
}
function alertTypeKey(type) {
  return type === "HU / TÜV"
    ? "hu"
    : type === "UVV"
      ? "uvv"
      : type === "Verbandkasten"
        ? "firstaid"
        : "other";
}
function alertTargetTab(alert) {
  return alert.type === "Verbandkasten" ? "stammdaten" : "termine";
}
function renderDashboardAlertDetail(status = "all", typeFilter = "all") {
  const all = dashboardAlerts();
  let rows = all.filter((a) => status === "all" || a.status === status);
  if (typeFilter !== "all")
    rows = rows.filter((a) => alertTypeKey(a.type) === typeFilter);
  const title =
    status === "overdue"
      ? "Überfällige Hinweise"
      : status === "soon"
        ? "Demnächst fällige Hinweise"
        : "Hinweise und Fälligkeiten";
  dashboardDetailBase(title, `${rows.length} Eintrag/Einträge`);
  const filters = [
    ["all", "Alle"],
    ["hu", "HU / TÜV"],
    ["uvv", "UVV"],
    ["firstaid", "Verbandkasten"],
    ["other", "Sonstige Termine"],
  ];
  const box = $("#dashboardDetailFilters");
  box.classList.remove("hidden");
  box.innerHTML = filters
    .map(
      ([key, label]) =>
        `<button class="dashboard-filter ${key === typeFilter ? "active" : ""}" data-alert-filter="${key}">${label}</button>`,
    )
    .join("");
  $("#dashboardDetailContent").innerHTML = rows.length
    ? `<div class="dashboard-detail-table"><div class="dashboard-detail-head"><span>Fahrzeug</span><span>Hinweis</span><span>Fälligkeit</span><span>Status</span><span></span></div>${rows.map((a) => `<div class="dashboard-detail-row ${a.status}"><span><strong>${esc(a.vehicle.displayName || "Fahrzeug")}</strong><small>${esc(a.vehicle.master.I || "")} ${esc(a.vehicle.master.J || "")}</small></span><span>${esc(a.type)}</span><span>${formatDate(a.date)}</span><span><strong>${a.status === "overdue" ? `${Math.abs(a.daysDifference)} Tag(e) überfällig` : `in ${a.daysDifference} Tag(en)`}</strong></span><span><button data-dashboard-open="${a.vehicle.id}" data-dashboard-tab="${alertTargetTab(a)}">Öffnen</button></span></div>`).join("")}</div>`
    : '<p class="empty-dashboard">Keine passenden Hinweise vorhanden.</p>';
  $$("[data-alert-filter]").forEach(
    (b) =>
      (b.onclick = () =>
        renderDashboardAlertDetail(status, b.dataset.alertFilter)),
  );
  $$("[data-dashboard-open]").forEach(
    (b) =>
      (b.onclick = () =>
        openDashboardVehicle(b.dataset.dashboardOpen, b.dataset.dashboardTab)),
  );
}
function renderDashboardMoneyDetail(kind) {
  const now = new Date(),
    y = String(now.getFullYear()),
    m = now.getMonth(),
    label = dashboardPeriodLabel(now);
  const rows = [];
  for (const v of vehicles.filter((x) => !x.archived)) {
    if (!v.monthly?.[y]) continue;
    recalc(v, y);
    const r = v.monthly[y][m];
    if (!r) continue;
    const value =
      kind === "charge" ? n(r.DW) : n(r.CU) + n(r.CY) + n(r.DC) + n(r.DG);
    if (value !== 0) rows.push({ v, value });
  }
  rows.sort((a, b) => b.value - a.value);
  dashboardDetailBase(
    kind === "charge" ? "Interne Verrechnung" : "Werkstattkosten",
    `${label} · ${rows.length} Fahrzeug(e)`,
  );
  $("#dashboardDetailContent").innerHTML = rows.length
    ? `<div class="dashboard-detail-table compact"><div class="dashboard-detail-head"><span>Fahrzeug</span><span>Eigentümer</span><span>Nutzer</span><span>Betrag</span><span></span></div>${rows.map((x) => `<div class="dashboard-detail-row"><span><strong>${esc(x.v.displayName)}</strong><small>${esc(x.v.master.I || "")} ${esc(x.v.master.J || "")}</small></span><span>${esc(x.v.master.AN || "–")}</span><span>${esc(x.v.master.AO || "–")}</span><span><strong>${money(x.value)}</strong></span><span><button data-dashboard-open="${x.v.id}" data-dashboard-tab="${kind === "charge" ? "kosten" : "wartung"}">Öffnen</button></span></div>`).join("")}</div>`
    : '<p class="empty-dashboard">Für diesen Monat sind keine Beträge vorhanden.</p>';
  $$("[data-dashboard-open]").forEach(
    (b) =>
      (b.onclick = () =>
        openDashboardVehicle(b.dataset.dashboardOpen, b.dataset.dashboardTab)),
  );
}
function renderDashboardFilesDetail() {
  const files = dashboardLatestFiles(Infinity);
  dashboardDetailBase(
    "Dokumente und Fotos",
    `${files.length} Datei(en) in allen Fahrzeugkarten`,
  );
  $("#dashboardDetailContent").innerHTML = files.length
    ? `<div class="dashboard-file-grid">${files.map((f) => `<button class="dashboard-file-card" data-dashboard-open="${f.vehicleId}" data-dashboard-tab="dokumente"><span class="recent-file-icon">${String(f.contentType || "").startsWith("image/") ? "🖼️" : "📄"}</span><span><strong>${esc(f.name || "Datei")}</strong><small>${esc(f.vehicle || "")} · ${f.uploadedAt ? new Date(f.uploadedAt).toLocaleString("de-DE") : "–"}</small></span></button>`).join("")}</div>`
    : '<p class="empty-dashboard">Noch keine Dateien hochgeladen.</p>';
  $$("[data-dashboard-open]").forEach(
    (b) =>
      (b.onclick = () =>
        openDashboardVehicle(b.dataset.dashboardOpen, b.dataset.dashboardTab)),
  );
}
function renderDashboard() {
  const alerts = dashboardAlerts();
  const leasingContracts = dashboardLeasingContracts();
  const leasingReminders = leasingContracts.filter((x) => !x.dismissed);
  const expiredLeasing = leasingReminders.filter((x) => x.status === "overdue").length;
  const upcomingLeasing = leasingReminders.filter((x) => x.status === "soon").length;
  const currentDate = new Date(),
    currentData = dashboardMonthData(currentDate),
    series = dashboardLastTwelveMonths(),
    maxSeries = Math.max(1, ...series.flatMap((x) => [x.charge, x.workshop]));
  const active = vehicles.filter((v) => !v.archived && v.active).length,
    inactive = vehicles.filter((v) => !v.archived && !v.active).length,
    archived = vehicles.filter((v) => v.archived).length,
    total = vehicles.length;
  const overdue = alerts.filter((a) => a.status === "overdue").length,
    soon = alerts.filter((a) => a.status === "soon").length;
  const huCount = alerts.filter((a) => a.type === "HU / TÜV").length,
    uvvCount = alerts.filter((a) => a.type === "UVV").length,
    firstAidCount = alerts.filter((a) => a.type === "Verbandkasten").length,
    otherCount = alerts.filter(
      (a) => !["HU / TÜV", "UVV", "Verbandkasten"].includes(a.type),
    ).length;
  const allDocs = vehicles.reduce(
      (sum, v) => sum + (v.documents || []).length,
      0,
    ),
    photoCount = vehicles.reduce(
      (sum, v) =>
        sum +
        (v.documents || []).filter((f) =>
          String(f.contentType || "").startsWith("image/"),
        ).length,
      0,
    );
  const nextAppointments = alerts.slice(0, 10),
    latestChanges = dashboardLatestChanges(),
    latestFiles = dashboardLatestFiles();
  $("#dashboard").innerHTML = `
 <div class="dashboard-title"><div><h2>Dashboard</h2><p>Übersicht für ${dashboardPeriodLabel(currentDate)}</p></div><button id="refreshDashboardBtn" class="secondary">Aktualisieren</button></div>
 <div class="kpi-grid dashboard-kpis">
  <button class="kpi kpi-main kpi-clickable" data-dashboard-action="vehicles-all"><span>Fahrzeuge gesamt</span><strong>${total}</strong><small>${active} aktiv · ${inactive} inaktiv · ${archived} archiviert</small></button>
  <button class="kpi kpi-clickable" data-dashboard-action="charges"><span>Interne Verrechnung</span><strong>${money(currentData.charge)}</strong><small>${dashboardPeriodLabel(currentDate)}</small></button>
  <button class="kpi kpi-clickable" data-dashboard-action="workshop"><span>Werkstattkosten</span><strong>${money(currentData.workshop)}</strong><small>${dashboardPeriodLabel(currentDate)}</small></button>
  <button class="kpi kpi-clickable ${dashboardSeverity(overdue)}" data-dashboard-action="overdue"><span>Überfällige Hinweise</span><strong>${overdue}</strong><small>${soon} weitere demnächst fällig</small></button>
  <button class="kpi kpi-clickable ${leasingReminders.length === 0 ? "status-good" : expiredLeasing > 0 ? "status-danger" : "status-warning"}" data-dashboard-action="leasing"><span>Auslaufende/ausgelaufene Leasingverträge</span><strong>${leasingReminders.length}</strong><small>${settings.remindLeasing ? `${expiredLeasing} ausgelaufen · ${upcomingLeasing} in den nächsten ${Number(settings.leasingDays) || 0} Tagen` : "Erinnerung deaktiviert"}</small></button>
  <button class="kpi kpi-clickable" data-dashboard-action="files"><span>Dokumente und Fotos</span><strong>${allDocs}</strong><small>${photoCount} Foto(s)</small></button>
 </div>
 <div class="dashboard-status-grid">
  <button class="${dashboardSeverity(huCount)}" data-dashboard-alert-type="hu"><span>HU / TÜV</span><strong>${huCount}</strong></button><button class="${dashboardSeverity(uvvCount)}" data-dashboard-alert-type="uvv"><span>UVV</span><strong>${uvvCount}</strong></button><button class="${dashboardSeverity(firstAidCount)}" data-dashboard-alert-type="firstaid"><span>Verbandkasten</span><strong>${firstAidCount}</strong></button><button class="${dashboardSeverity(otherCount)}" data-dashboard-alert-type="other"><span>Sonstige Termine</span><strong>${otherCount}</strong></button>
 </div>
 <div class="dashboard-vehicle-shortcuts"><button data-vehicle-view="active"><span>Aktive Fahrzeuge</span><strong>${active}</strong></button><button data-vehicle-view="inactive"><span>Inaktive Fahrzeuge</span><strong>${inactive}</strong></button><button data-vehicle-view="archive"><span>Archiv</span><strong>${archived}</strong></button><button data-dashboard-action="soon"><span>Demnächst fällig</span><strong>${soon}</strong></button></div>
 <div class="dashboard-grid">
  <section class="dashboard-panel dashboard-wide"><div class="panel-head"><div><h3>Kostenentwicklung der letzten 12 Monate</h3><small>Interne Verrechnung und Werkstattkosten</small></div></div><div class="cost-chart">${series.map((x) => `<div class="chart-month"><div class="chart-bars"><span class="chart-bar charge" style="height:${Math.max(2, (x.charge / maxSeries) * 120)}px" title="Verrechnung: ${money(x.charge)}"></span><span class="chart-bar workshop" style="height:${Math.max(2, (x.workshop / maxSeries) * 120)}px" title="Werkstatt: ${money(x.workshop)}"></span></div><small>${esc(x.label)}</small></div>`).join("")}</div><div class="chart-legend"><span><i class="legend-charge"></i>Interne Verrechnung</span><span><i class="legend-workshop"></i>Werkstattkosten</span></div></section>
  <section class="dashboard-panel"><div class="panel-head"><div><h3>Nächste Termine und Fälligkeiten</h3><small>Die nächsten 10 von ${alerts.length} Einträgen</small></div><button class="panel-link" data-dashboard-action="alerts-all">Alle anzeigen</button></div><div class="dashboard-list">${nextAppointments.length ? nextAppointments.map((a) => `<button class="dashboard-list-row ${a.status}" data-open-vehicle="${a.vehicle.id}" data-open-tab="${alertTargetTab(a)}"><span><strong>${esc(a.type)}</strong><small>${esc(a.vehicle.displayName)} · ${esc(a.vehicle.master.I || "")} ${esc(a.vehicle.master.J || "")}</small></span><time>${formatDate(a.date)}</time></button>`).join("") : '<p class="empty-dashboard">Keine fälligen Hinweise.</p>'}</div></section>
  <section class="dashboard-panel"><div class="panel-head"><div><h3>Zuletzt geänderte Fahrzeuge</h3><small>Aus der Fahrzeughistorie</small></div></div><div class="dashboard-list">${latestChanges.length ? latestChanges.map((h) => `<button class="dashboard-list-row" data-open-vehicle="${h.vehicleId}"><span><strong>${esc(h.vehicle || "Fahrzeug")}</strong><small>${esc(h.action || "Änderung")} · ${esc(h.user || "")}</small></span><time>${h.timestamp ? new Date(h.timestamp).toLocaleDateString("de-DE") : "–"}</time></button>`).join("") : '<p class="empty-dashboard">Noch keine Änderungen protokolliert.</p>'}</div></section>
  <section class="dashboard-panel dashboard-wide"><div class="panel-head"><div><h3>Zuletzt hochgeladene Dokumente und Fotos</h3><small>Dateimetadaten aus den Fahrzeugkarten</small></div><button class="panel-link" data-dashboard-action="files">Alle anzeigen</button></div><div class="recent-files">${latestFiles.length ? latestFiles.map((f) => `<button class="recent-file" data-open-file-vehicle="${f.vehicleId}"><span class="recent-file-icon">${String(f.contentType || "").startsWith("image/") ? "🖼️" : "📄"}</span><span><strong>${esc(f.name || "Datei")}</strong><small>${esc(f.vehicle || "")} · ${f.uploadedAt ? new Date(f.uploadedAt).toLocaleString("de-DE") : "–"}</small></span></button>`).join("") : '<p class="empty-dashboard">Noch keine Dateien hochgeladen.</p>'}</div></section>
 </div>`;
  $$("[data-open-vehicle]").forEach(
    (b) =>
      (b.onclick = () =>
        openDashboardVehicle(
          b.dataset.openVehicle,
          b.dataset.openTab || "stammdaten",
        )),
  );
  $$("[data-open-file-vehicle]").forEach(
    (b) =>
      (b.onclick = () =>
        openDashboardVehicle(b.dataset.openFileVehicle, "dokumente")),
  );
  $$("[data-vehicle-view]").forEach(
    (b) => (b.onclick = () => setVehicleView(b.dataset.vehicleView)),
  );
  $$("[data-dashboard-alert-type]").forEach(
    (b) =>
      (b.onclick = () =>
        renderDashboardAlertDetail("all", b.dataset.dashboardAlertType)),
  );
  $$("[data-dashboard-action]").forEach(
    (b) =>
      (b.onclick = () => {
        const a = b.dataset.dashboardAction;
        if (a === "vehicles-all") setVehicleView("all");
        else if (a === "overdue") renderDashboardAlertDetail("overdue");
        else if (a === "soon") renderDashboardAlertDetail("soon");
        else if (a === "alerts-all") renderDashboardAlertDetail("all");
        else if (a === "charges") renderDashboardMoneyDetail("charge");
        else if (a === "workshop") renderDashboardMoneyDetail("workshop");
        else if (a === "leasing") renderDashboardLeasingDetail();
        else if (a === "files") renderDashboardFilesDetail();
      }),
  );
  $("#refreshDashboardBtn").onclick = renderDashboard;
}
function exportCsv(type) {
  if (type === "vehicles")
    downloadCsv("HOGA-Fuhrparkmanagement_Fahrzeuge.csv", vehicleCsv());
  else {
    const f = $("#chargeExportForm");
    f.elements.mode.value = type;
    f.elements.year.innerHTML = [2025, 2026, 2027, 2028, 2029, 2030]
      .map(
        (y) =>
          `<option ${y === new Date().getFullYear() ? "selected" : ""}>${y}</option>`,
      )
      .join("");
    f.elements.month.value = String(new Date().getMonth() + 1);
    openModal("chargeExportModal");
  }
}
function submitChargeExport(e) {
  e.preventDefault();
  const f = new FormData(e.target),
    y = String(f.get("year")),
    m = Number(f.get("month")),
    mode = f.get("mode");
  if (mode === "both")
    downloadCsv("HOGA-Fuhrparkmanagement_Fahrzeuge.csv", vehicleCsv());
  setTimeout(
    () =>
      downloadCsv(
        `HOGA-Fuhrparkmanagement_Verrechnungsbetraege_${y}-${String(m).padStart(2, "0")}.csv`,
        chargeCsv(y, m),
      ),
    mode === "both" ? 250 : 0,
  );
  closeModal("chargeExportModal");
}
function vehicleCsv() {
  const cols = [
    "Status",
    "F",
    "G",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "P",
    "R",
    "AK",
    "AN",
    "AO",
    "AQ",
    "AR",
    "AS",
    "AW",
    "AX",
    "AY",
    "AZ",
    "BA",
    "BB",
  ];
  const labels = { Status: "Status", ...headers };
  return [
    cols.map((c) => labels[c] || c),
    ...vehicles.map((v) =>
      cols.map((c) =>
        c === "Status"
          ? v.archived
            ? "Archiv"
            : v.active
              ? "Aktiv"
              : "Inaktiv"
          : (v.master[c] ?? ""),
      ),
    ),
  ];
}
function chargeCsv(y, m) {
  const out = [
    [
      "Fahrzeug",
      "Eigentümer",
      "Nutzer",
      "Jahr",
      "Monat",
      "Verrechnungsbetrag",
      "Kosten Nutzer €/km",
      "Kosten Eigentümer €/km",
    ],
  ];
  for (const v of vehicles) {
    recalc(v, y);
    const r = v.monthly[y]?.[m - 1];
    if (r)
      out.push([
        v.displayName,
        v.master.AN || "",
        v.master.AO || "",
        y,
        r.monthName,
        round2(r.DW),
        round2(r.DR),
        round2(r.DQ),
      ]);
  }
  return out;
}
function downloadCsv(name, rows) {
  const csv =
    "\uFEFF" +
    rows
      .map((r) =>
        r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";"),
      )
      .join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadBackup() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            version: "1.6",
            exportedAt: new Date().toISOString(),
            settings,
            vehicles,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  a.download = `HOGA-Fuhrparkmanagement_Backup_${isoToday()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function restoreBackup(e) {
  if (!isAdmin())
    return alert("Nur Administratoren dürfen Backups einspielen.");
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.vehicles))
      throw new Error("Die Datei enthält keine gültigen Fahrzeugdaten.");
    if (
      !confirm(
        `Backup vom ${data.exportedAt ? new Date(data.exportedAt).toLocaleString("de-DE") : "unbekannten Zeitpunkt"} mit ${data.vehicles.length} Fahrzeugen einspielen? Die aktuellen Firestore-Daten werden ersetzt.`,
      )
    )
      return;
    showLoading("Backup einspielen", "Vorhandene Fahrzeugdaten werden ersetzt …", 5);
    await waitForLoadingPaint();
    vehicles = data.vehicles;
    settings = { ...defaultSettings, ...(data.settings || {}) };
    normalizeVehicles();
    if (DEMO_MODE) await saveDemoData();
    else {
      await replaceAllCloudData();
      await setDoc(doc(fleetDb, "settings", "general"), settings, { merge: true });
    }
    selectedId = null;
    showDashboard();
    renderList();
    updateLoading("Backup wurde vollständig eingespielt.", 100);
    alert(`Backup wurde erfolgreich ${DEMO_MODE ? "im Testbrowser" : "in Firestore"} eingespielt.`);
  } catch (err) {
    alert("Backup konnte nicht eingespielt werden: " + err.message);
  } finally {
    hideLoading();
  }
}
async function replaceAllCloudData() {
  const current = await getDocs(collection(fleetDb, "vehicles"));
  const groups = [];
  current.docs.forEach((d, i) => {
    const idx = Math.floor(i / 400);
    groups[idx] = groups[idx] || [];
    groups[idx].push(d);
  });
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    updateLoading(`Alte Daten werden entfernt: Block ${groupIndex + 1} von ${groups.length} …`, 5 + ((groupIndex + 1) / Math.max(1, groups.length)) * 30);
    const batch = writeBatch(fleetDb);
    group.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  updateLoading("Neue Fahrzeugdaten werden geschrieben …", 40);
  await importInitialVehicles();
}
function openSettings() {
  if (!isAdmin()) return;
  const f = $("#settingsForm");
  for (const [k, v] of Object.entries(settings)) {
    if (!f.elements[k]) continue;
    if (f.elements[k].type === "checkbox") f.elements[k].checked = Boolean(v);
    else f.elements[k].value = v;
  }
  openModal("settingsModal");
}
async function saveSettings(e) {
  if (!isAdmin()) return;
  e.preventDefault();
  const f = e.target;
  settings = {
    remindFirstAid: f.remindFirstAid.checked,
    firstAidDays: Number(f.firstAidDays.value || 0),
    remindHu: f.remindHu.checked,
    huDays: Number(f.huDays.value || 0),
    remindUvv: f.remindUvv.checked,
    uvvDays: Number(f.uvvDays.value || 0),
    remindAppointments: f.remindAppointments.checked,
    appointmentDays: Number(f.appointmentDays.value || 0),
    remindLeasing: f.remindLeasing.checked,
    leasingDays: Number(f.leasingDays.value || 0),
  };
  showLoading("Einstellungen speichern", "Erinnerungseinstellungen werden gespeichert …");
  try {
    if (DEMO_MODE) await saveDemoData();
    else await setDoc(doc(fleetDb, "settings", "general"), settings, { merge: true });
    closeModal("settingsModal");
    if (!$("#dashboard").classList.contains("hidden")) renderDashboard();
  } finally {
    hideLoading();
  }
}
function openModal(id) {
  $("#" + id).classList.remove("hidden");
}
function closeModal(id) {
  $("#" + id).classList.add("hidden");
}

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("HOGA-fuhrpark-files", 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("files"))
        db.createObjectStore("files", { keyPath: "id" });
      if (!db.objectStoreNames.contains("state"))
        db.createObjectStore("state", { keyPath: "key" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbPutState(key, value) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction("state", "readwrite");
    t.objectStore("state").put({
      key,
      value,
      updatedAt: new Date().toISOString(),
    });
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
async function dbGetState(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = db.transaction("state").objectStore("state").get(key);
    r.onsuccess = () => res(r.result?.value ?? null);
    r.onerror = () => rej(r.error);
  });
}
async function dbPut(o) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction("files", "readwrite");
    t.objectStore("files").put(o);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}
async function dbGet(id) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = db.transaction("files").objectStore("files").get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGetByVehicle(vehicleId) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = db.transaction("files").objectStore("files").getAll();
    r.onsuccess = () => res(r.result.filter((x) => x.vehicleId === vehicleId));
    r.onerror = () => rej(r.error);
  });
}
async function dbDelete(id) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction("files", "readwrite");
    t.objectStore("files").delete(id);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

showLoading("HOGAbusiness FleetDesk", "Anwendung wird gestartet …");
init().catch((err) => {
  hideLoading();
  document.body.innerHTML = `<div class="empty-state"><h2>Fehler beim Laden</h2><p>${esc(err.message)}</p><p>Bitte über einen lokalen Webserver oder GitHub Pages öffnen.</p></div>`;
});
