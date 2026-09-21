import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";

/*
 * TESTBETRIEB (GitHub Pages)
 * Solange DEMO_MODE true ist, startet die Anwendung ohne Anmeldung und speichert
 * ausschließlich in diesem Browser. Hinweise zum Produktivwechsel stehen in
 * README_FIREBASE.md.
 */
export const DEMO_MODE = true;

const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

const configured = !DEMO_MODE && Object.values(firebaseConfig).every(Boolean);
const fleetApp = configured ? initializeApp(firebaseConfig) : null;
const fleetAuth = configured ? getAuth(fleetApp) : null;
const fleetDb = configured ? getFirestore(fleetApp) : null;
const blazeFunctions = configured ? getFunctions(fleetApp, "europe-west1") : null;

export { configured, fleetApp, fleetAuth, fleetDb, blazeFunctions };
