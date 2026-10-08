# Wetter v2.3 – die Essenz aus drei Modellen

PWA im Stil der Apple-Wetter-App (iPhone & Mac). Kein Build-Schritt, keine API-Keys.

## Datenquellen & Verdichtung
| Was | Quelle | Wie verdichtet |
|---|---|---|
| Stunden & 10 Tage | Open-Meteo: DWD ICON, NOAA GFS, ECMWF IFS | Mittelwert aller verfügbaren Modelle (ICON reicht ~7,5 Tage, danach Ø aus 2 Modellen – im Tagesdetail sichtbar) |
| Höchst-/Tiefstwerte | dito | Mittelwert der drei Modelle; heute zusätzlich so, dass die aktuelle Temperatur innerhalb liegt |
| Wettersymbol | dito | Mehrheitsentscheid der Modelle, sonst Median nach Wetterschwere; „Regen"-Symbol nur, wenn die gemittelte Menge es trägt |
| Aktuelle Werte | Bright Sky / DWD-Messstation | Jedes Feld nur, wenn seine Station ≤ 15 km entfernt, ≤ 120 m Höhenunterschied, ≤ 100 min alt – sonst DWD ICON |
| Radar & Nowcast | Bright Sky / DWD RADOLAN | 5-Min-Frames (≈ 1 h zurück, 1 h Vorhersage), Nowcast = 3×3 km um den Standort |
| Warnungen | Bright Sky / DWD | nach Schwere sortiert |
| Luftqualität | Open-Meteo (CAMS) | Europäischer AQI |
| Windkarte | Open-Meteo, Raster aus 9 × 11 Punkten (±5° Breite, ±8° Länge) | bilinear interpoliert, nach Geschwindigkeit eingefärbt, animierte Partikel; lädt erst beim Hinscrollen, Cache 30 min |
| Modell-Einigkeit | eigene Auswertung | Spanne der Modell-Höchstwerte über 5 Tage → hoch / mittel / gering |

Radar und Warnungen gibt es nur für Deutschland; außerhalb werden die Karten ausgeblendet.

## Dateien
- `js/data.js` – API-Aufrufe (Timeout, Retry)
- `js/essence.js` – Mittelung, Konsens, Texte („Regen ab etwa 15 Uhr …")
- `js/app.js` – Oberfläche, Ortsliste, Kacheln
- `js/detail.js` – Ansichten Niederschlag (Intensität · Wahrscheinlichkeit) und Wind (Geschwindigkeit · Böen)
- `js/windmap.js` – Windkarte mit Partikeln
- `js/radar.js` – Radar-Karte (Leaflet + Esri-Graukarte)
- `js/sky.js` – animierter Himmel · `js/icons.js` – Symbole
- `sw.js` – Offline: App-Shell & letzte Wetterdaten

## Lokal starten
```bash
cd ~/Claude-Code/Wetter && python3 -m http.server 5180
```
→ http://localhost:5180

## Aufs iPhone / den Mac
Die PWA braucht HTTPS. Ordner z. B. auf **GitHub Pages**, **Netlify Drop** (Ordner per Drag & Drop auf app.netlify.com/drop) oder **Cloudflare Pages** hochladen.
- **iPhone:** Safari → Teilen → „Zum Home-Bildschirm"
- **Mac:** Safari → Ablage → „Zum Dock hinzufügen"

Bedienung: Umschalter oben rechts in der Stundenkarte (Wetter / Niederschlag / Wind) schaltet Stunden- und 10-Tage-Ansicht um. Wischen links/rechts wechselt Orte (iPhone), ⌘←/⌘→ und ⌘R am Mac, Tagesszeile antippen zeigt die Werte jedes Modells.
