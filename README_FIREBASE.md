# HOGAbusiness FleetDesk V0.2

## Aktueller Testbetrieb auf GitHub Pages

Die Anwendung startet ohne Eingabe direkt als Administrator. Fahrzeuge,
Einstellungen und Dateimetadaten werden lokal im Browser gespeichert; Dateien
liegen in IndexedDB. Ein anderer Browser oder ein anderes Gerät sieht diese
Daten nicht. Dieser Modus ist ausschließlich für Funktions- und Designtests.

GitHub Pages benötigt den Inhalt dieses Ordners. `index.html` muss dabei im
veröffentlichten Stammverzeichnis liegen.

## Wechsel zum Firebase-Blaze-Produktivbetrieb

1. In `js/firebase.js` die Web-App-Konfiguration des vorgesehenen Firebase-
   Projekts eintragen und `DEMO_MODE` auf `false` setzen.
2. Firebase Authentication (E-Mail/Passwort), Firestore, Storage und Functions
   im Projekt aktivieren.
3. Im Ordner `functions` einmal `npm install` ausführen.
4. Regeln, Hosting und Functions mit der Firebase CLI veröffentlichen.
5. Für jeden Benutzer ein Dokument `users/{uid}` anlegen, zum Beispiel:
   `{ "active": true, "role": "admin", "name": "Pascal" }`.

Vorgesehene Rollen sind `admin`, `user` und `read`. Die Storage-Regeln sperren
bewusst jeden direkten Browserzugriff. Upload, Abruf und Löschung erfolgen über
die Functions in `europe-west1`; dort werden Anmeldung, Rolle, Dateityp,
Dateigröße und Fahrzeugpfad geprüft.

Wichtig: Vor dem Produktivwechsel sollte entschieden werden, ob FleetDesk im
gleichen Firebase-Projekt wie HOGAsports oder als getrennte Anwendung innerhalb
der vorhandenen Google-Cloud-Organisation betrieben wird. Die ausgelieferte
Konfiguration funktioniert mit einem einzelnen, zentralen Blaze-Projekt.
