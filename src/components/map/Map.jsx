import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  LayersControl,
  LayerGroup,
  Marker,
  Popup,
  useMapEvents,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import "../map/map.css";
import SearchBar from "./searchplace/Searchbar";
import Dashboard from "../Dashboard";

// external libs for reports
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import "jspdf-autotable";

/* ---------------- CONFIG ---------------- */
const CATEGORIES = [
  { key: "General", color: "#3388ff" },
  { key: "Restaurant", color: "#e74c3c" },
  { key: "College", color: "#27ae60" },
  { key: "Event", color: "#f1c40f" },
  { key: "Shop", color: "#9b59b6" },
];

const iconPath = (name) => `${process.env.PUBLIC_URL || ""}/icons/${name}`;

const getCategoryIcon = (categoryKey) => {
  let file = "marker-icon-blue.png";
  switch (categoryKey) {
    case "Restaurant":
      file = "marker-icon-red.png";
      break;
    case "College":
      file = "marker-icon-green.png";
      break;
    case "Event":
      file = "marker-icon-yellow.png";
      break;
    case "Shop":
      file = "marker-icon-violet.png";
      break;
    default:
      file = "marker-icon-blue.png";
  }
  const iconUrl = iconPath(file);
  return L.icon({
    iconUrl,
    shadowUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
};

/* ---------------- AddMarker (map click) ----------------
   Stops creating markers when clicking inside search bar container
   Also prevents duplicates (approx within 5 meters)
*/
function AddMarker({ onAdd, isDuplicate }) {
  useMapEvents({
    click(e) {
      // Prevent clicks inside the SearchBar from creating markers
      if (e.originalEvent?.target?.closest(".search-bar-container")) {
        return;
      }
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      if (isDuplicate(lat, lng)) {
        alert("A marker already exists near this location (duplicate prevented).");
        return;
      }
      onAdd(e.latlng);
    },
  });
  return null;
}

/* ---------------- ShapeDrawer ----------------
   - Integrates with Leaflet.draw
   - Option A: focus latest created shape only (fitBounds to newest)
   - Keeps shapes drawn (they persist)
   - Exposes lastFocusedBounds and reset functionality via callbacks
*/
function ShapeDrawer({ shapesState, setShapesState, onShapeFocused, setPrevView }) {
  const map = useMap();

  useEffect(() => {
    if (!map.__drawnItems) {
      map.__drawnItems = new L.FeatureGroup();
      map.addLayer(map.__drawnItems);

      const drawControl = new L.Control.Draw({
        draw: {
          polygon: true,
          polyline: true,
          rectangle: true,
          circle: true,
          marker: false,
        },
        edit: { featureGroup: map.__drawnItems },
      });
      map.addControl(drawControl);

      const updateShapes = () => {
        const all = map.__drawnItems.getLayers().map((l) => {
          const gj = l.toGeoJSON();
          if (l instanceof L.Circle) {
            gj.properties = { ...gj.properties, radius: l.getRadius() };
          }
          return gj;
        });
        setShapesState(all);
      };

      // Created: add, update state, focus newest (Option A)
      map.on(L.Draw.Event.CREATED, (e) => {
        // Save previous view (center+zoom) so we can restore
        try {
          const prev = { center: map.getCenter(), zoom: map.getZoom() };
          setPrevView(prev);
        } catch (err) {
          // ignore
        }

        map.__drawnItems.addLayer(e.layer);
        updateShapes();

        // Option A: focus only the latest created shape
        try {
          // For circle use center+radius -> bounds
          let bounds = null;
          if (e.layer instanceof L.Circle) {
            bounds = e.layer.getBounds();
          } else if (e.layer.getBounds) {
            bounds = e.layer.getBounds();
          } else if (e.layer.getLatLng) {
            const p = e.layer.getLatLng();
            bounds = L.latLngBounds(p, p);
          }

          if (bounds) {
            // slightly pad bounds
            map.fitBounds(bounds.pad(0.2));
            if (typeof onShapeFocused === "function") onShapeFocused(bounds);
          }
        } catch (err) {
          console.warn("Could not focus on created shape", err);
        }
      });

      map.on(L.Draw.Event.EDITED, () => {
        updateShapes();
      });
      map.on(L.Draw.Event.DELETED, () => {
        updateShapes();
      });
    }
  }, [map, setShapesState, onShapeFocused, setPrevView]);

  // When shapesState changes we re-render the drawn items so they persist
  useEffect(() => {
    if (!map?.__drawnItems) return;
    const fg = map.__drawnItems;
    fg.clearLayers();

    shapesState.forEach((g) => {
      if (g.geometry.type === "Point" && g.properties?.radius) {
        // stored circle representation
        const circle = L.circle(
          [g.geometry.coordinates[1], g.geometry.coordinates[0]],
          {
            radius: g.properties.radius,
            color: "orange",
            fillColor: "yellow",
            fillOpacity: 0.4,
          }
        );
        fg.addLayer(circle);
      } else {
        const layer = L.geoJSON(g, {
          style: {
            color: "orange",
            weight: 2,
            fillColor: "yellow",
            fillOpacity: 0.4,
          },
        });
        layer.eachLayer((l) => fg.addLayer(l));
      }
    });
  }, [map, shapesState]);

  return null;
}

/* ------------------ MAIN MAP COMPONENT ------------------ */
const Map = () => {
  const [geodata] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [shapes, setShapes] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [showFilter, setShowFilter] = useState(false);
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [includeCSVinPDF, setIncludeCSVinPDF] = useState(false);
  const [focusedShapeBounds, setFocusedShapeBounds] = useState(null);
  const [isViewFocused, setIsViewFocused] = useState(false);
  const prevViewRef = useRef(null);
  const mapRef = useRef();
  const fileInputRef = useRef();
  const position = [-1.2921, 36.8219];

  // ---------------- MULTI-MAP ----------------
  const [savedMaps, setSavedMaps] = useState(() => {
    const stored = localStorage.getItem("maps");
    return stored
      ? JSON.parse(stored)
      : { default: { name: "Default Map", markers: [], shapes: [] } };
  });
  const [currentMap, setCurrentMap] = useState("default");

  useEffect(() => {
    setSavedMaps((prev) => {
      const updated = {
        ...prev,
        [currentMap]: {
          ...prev[currentMap],
          markers,
          shapes,
        },
      };
      localStorage.setItem("maps", JSON.stringify(updated));
      return updated;
    });
  }, [markers, shapes, currentMap]);

  // Select map
  const handleSelectMap = (mapId) => {
    setCurrentMap(mapId);
    setMarkers(savedMaps[mapId]?.markers || []);
    setShapes(savedMaps[mapId]?.shapes || []);
    // restore view (optional) - we won't change map center automatically to avoid jarring UX
  };

  const handleCreateMap = () => {
    const newName = prompt("Enter a name for the new map:");
    if (!newName?.trim()) return;
    const newId = `map_${Date.now()}`;
    const updated = {
      ...savedMaps,
      [newId]: { name: newName.trim(), markers: [], shapes: [] },
    };
    setSavedMaps(updated);
    setCurrentMap(newId);
    setMarkers([]);
    setShapes([]);
    localStorage.setItem("maps", JSON.stringify(updated));
  };

  const handleRenameMap = () => {
    const newName = prompt("Enter a new name:", savedMaps[currentMap].name);
    if (!newName?.trim()) return;
    setSavedMaps((prev) => {
      const updated = { ...prev };
      updated[currentMap].name = newName.trim();
      localStorage.setItem("maps", JSON.stringify(updated));
      return updated;
    });
  };

  const handleDeleteMap = () => {
    if (currentMap === "default") return alert("⚠️ Can't delete default map");
    if (!window.confirm("Delete this map?")) return;
    const updated = { ...savedMaps };
    delete updated[currentMap];
    const nextMap = Object.keys(updated)[0] || "default";
    setSavedMaps(updated);
    setCurrentMap(nextMap);
    setMarkers(updated[nextMap]?.markers || []);
    setShapes(updated[nextMap]?.shapes || []);
    localStorage.setItem("maps", JSON.stringify(updated));
  };

  // ---------------- Marker handlers ----------------
  // duplicate detection (approx distance in meters)
  const isDuplicate = (lat, lng, thresholdMeters = 5) => {
    const R = 6371e3; // metres
    const toRad = (d) => (d * Math.PI) / 180;
    for (const m of markers) {
      const lat2 = m.position[0];
      const lon2 = m.position[1];
      const φ1 = toRad(lat);
      const φ2 = toRad(lat2);
      const Δφ = toRad(lat2 - lat);
      const Δλ = toRad(lon2 - lng);
      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const d = R * c;
      if (d <= thresholdMeters) return true;
    }
    return false;
  };

  const handleAddMarker = (latlng) => {
    const lat = Number(latlng.lat);
    const lng = Number(latlng.lng);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert("Invalid latitude/longitude.");
      return;
    }
    if (isDuplicate(lat, lng)) {
      alert("Duplicate marker detected — marker not added.");
      return;
    }
    const newMarker = {
      id: Date.now(),
      position: [lat, lng],
      title: "New Marker",
      description: "",
      category: "General",
      image: null,
    };
    setMarkers((prev) => [...prev, newMarker]);
  };

  const handleTextChange = (id, field, value) => {
    setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  };

  const handleImageUpload = (e, id) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, image: reader.result } : m)));
    };
    reader.readAsDataURL(file);
  };

  const filteredMarkers = markers.filter((m) => {
    const textMatch =
      m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase());
    const categoryMatch = selectedCategory === "All" || m.category === selectedCategory;
    return textMatch && categoryMatch;
  });

  // ---------------- Reporting Utilities ----------------
  const markersToCSVString = (markersArr) => {
    const headers = ["Title", "Description", "Latitude", "Longitude", "Category"];
    const rows = markersArr.map((m) => [
      `"${(m.title || "").replace(/"/g, '""')}"`,
      `"${(m.description || "").replace(/"/g, '""')}"`,
      m.position[0],
      m.position[1],
      m.category || "",
    ]);
    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  };

  const exportCSV = () => {
    const csv = markersToCSVString(markers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${savedMaps[currentMap]?.name || "map"}_markers.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMapSnapshot = async () => {
    try {
      const mapDom = document.querySelector(".leaflet-container");
      if (!mapDom) return alert("Map container not found for snapshot.");
      const canvas = await html2canvas(mapDom, { useCORS: true, logging: false });
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${savedMaps[currentMap]?.name || "map"}_snapshot.png`;
      link.click();
    } catch (err) {
      console.error("Snapshot error", err);
      alert("Failed to capture map snapshot.");
    }
  };

  const exportPDF = async () => {
    try {
      const pdf = new jsPDF("p", "pt", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 20;
      let y = 20;

      pdf.setFontSize(14);
      pdf.text("GIS Project Report", margin, y);
      y += 20;
      pdf.setFontSize(10);
      const mapName = savedMaps[currentMap]?.name || "Default Map";
      pdf.text(`Map: ${mapName}`, margin, y);
      y += 14;
      pdf.text(`Exported: ${new Date().toLocaleString()}`, margin, y);
      y += 18;

      const mapDom = document.querySelector(".leaflet-container");
      if (!mapDom) {
        alert("Map not found for PDF snapshot.");
        return;
      }

      const originalTransform = mapDom.style.transform;
      mapDom.style.transform = "none";

      const mapCanvas = await html2canvas(mapDom, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
      });

      mapDom.style.transform = originalTransform;

      const mapData = mapCanvas.toDataURL("image/png");
      const imgMaxWidth = pageWidth - margin * 2;
      const imgRatio = mapCanvas.width / mapCanvas.height;
      const imgDisplayHeight = imgMaxWidth / imgRatio;

      pdf.addImage(mapData, "PNG", margin, y, imgMaxWidth, imgDisplayHeight);
      y += imgDisplayHeight + 20;

      // Dashboard capture (if present)
      const dashboardDom = document.querySelector(".recharts-wrapper") || document.querySelector(".dashboard-chart");
      if (dashboardDom) {
        try {
          const dashCanvas = await html2canvas(dashboardDom, {
            useCORS: true,
            allowTaint: true,
            scale: 2,
            backgroundColor: "#ffffff",
            logging: false,
          });
          const dashData = dashCanvas.toDataURL("image/png");
          const dashWidth = 250;
          const dashHeight = (dashCanvas.height / dashCanvas.width) * dashWidth;
          if (y + dashHeight > pdf.internal.pageSize.height - margin) {
            pdf.addPage();
            y = margin;
          }
          pdf.addImage(dashData, "PNG", margin, y, dashWidth, dashHeight);
          y += dashHeight + 20;
        } catch (err) {
          console.warn("Dashboard capture failed", err);
        }
      }

      // Summary
      const totalMarkers = markers.length;
      const totalShapes = shapes.length;
      const catCounts = CATEGORIES.reduce((acc, c) => {
        acc[c.key] = markers.filter((m) => m.category === c.key).length;
        return acc;
      }, {});

      pdf.setFontSize(11);
      pdf.text(`Total Markers: ${totalMarkers}`, margin, y);
      y += 14;
      pdf.text(`Total Shapes: ${totalShapes}`, margin, y);
      y += 14;
      Object.keys(catCounts).forEach((cat) => {
        pdf.text(`${cat}: ${catCounts[cat]}`, margin, y);
        y += 14;
      });

      y += 10;

      // Include CSV as table if requested
      if (includeCSVinPDF) {
        const tableColumns = ["Title", "Description", "Latitude", "Longitude", "Category"];
        const tableRows = markers.map((m) => [
          (m.title || "").toString().slice(0, 50),
          (m.description || "").toString().slice(0, 80),
          m.position?.[0] ?? "",
          m.position?.[1] ?? "",
          (m.category || "").toString(),
        ]);
        try {
          pdf.autoTable({
            head: [tableColumns],
            body: tableRows,
            startY: y,
            margin: { left: margin, right: margin },
            styles: { fontSize: 8, cellWidth: "wrap" },
            headStyles: { fillColor: [60, 141, 188] },
          });
        } catch (err) {
          console.error("AutoTable failed", err);
          alert("CSV could not be included in the PDF. Try again.");
        }
      }

      pdf.save(`${mapName}_report.pdf`);
    } catch (err) {
      console.error("PDF export error:", err);
      alert("Failed to generate PDF. Check console for details.");
    }
  };

  // ---------------- CSV IMPORT with validation ----------------
  const handleImportClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const parseCSV = (text) => {
    // Basic CSV parse — split lines, handle quoted values simply
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const rows = lines.slice(1).map((ln) => {
      // naive CSV splitting that supports quoted commas
      const values = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < ln.length; i++) {
        const ch = ln[i];
        if (ch === '"' && ln[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        } else if (ch === '"') {
          inQuotes = !inQuotes;
          continue;
        } else if (ch === "," && !inQuotes) {
          values.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      values.push(cur);
      return values.map((v) => v.trim());
    });
    return { headers, rows };
  };

  const onFileSelected = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const { headers, rows } = parseCSV(text);

        // map header indices
        const idx = {
          title: headers.findIndex((h) => /^title$/i.test(h)),
          desc: headers.findIndex((h) => /^(description|desc)$/i.test(h)),
          lat: headers.findIndex((h) => /^(latitude|lat)$/i.test(h)),
          lng: headers.findIndex((h) => /^(longitude|lon|lng|long)$/i.test(h)),
          cat: headers.findIndex((h) => /^(category|cat)$/i.test(h)),
        };

        // required: lat & lng
        if (idx.lat === -1 || idx.lng === -1) {
          alert("CSV must include 'Latitude' and 'Longitude' columns.");
          return;
        }

        let imported = 0;
        const errors = [];
        const newMarkers = [];

        rows.forEach((r, i) => {
          try {
            const title = idx.title !== -1 ? (r[idx.title] || "") : "";
            const desc = idx.desc !== -1 ? (r[idx.desc] || "") : "";
            const latRaw = r[idx.lat];
            const lngRaw = r[idx.lng];
            const cat = idx.cat !== -1 ? (r[idx.cat] || "General") : "General";

            if (!latRaw || !lngRaw) {
              errors.push(`Row ${i + 2}: missing coordinates`);
              return;
            }
            const lat = Number(latRaw);
            const lng = Number(lngRaw);
            if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
              errors.push(`Row ${i + 2}: invalid lat/lng (${latRaw}, ${lngRaw})`);
              return;
            }

            if (isDuplicate(lat, lng)) {
              errors.push(`Row ${i + 2}: duplicate marker skipped`);
              return;
            }

            const nm = {
              id: Date.now() + i,
              position: [lat, lng],
              title: title || "Imported Marker",
              description: desc || "",
              category: CATEGORIES.some((c) => c.key === cat) ? cat : "General",
              image: null,
            };
            newMarkers.push(nm);
            imported++;
          } catch (errRow) {
            errors.push(`Row ${i + 2}: parse error`);
          }
        });

        if (newMarkers.length) {
          setMarkers((prev) => [...prev, ...newMarkers]);
        }

        let msg = `Import complete. ${imported} markers added.`;
        if (errors.length) {
          msg += `\nWarnings:\n${errors.slice(0, 20).join("\n")}`;
        }
        alert(msg);
      } catch (err) {
        console.error("CSV parse error", err);
        alert("Failed to parse CSV.");
      } finally {
        // reset file input
        e.target.value = "";
      }
    };
    reader.readAsText(f);
  };

  // ---------------- Shape focus / reset view ----------------
  const onShapeFocused = (bounds) => {
    setFocusedShapeBounds(bounds);
    setIsViewFocused(true);
  };

  const setPrevView = (prev) => {
    prevViewRef.current = prev;
  };

  const resetView = () => {
    const map = mapRef.current?.leafletElement || mapRef.current;
    if (!map) return;
    // restore previous view if saved, otherwise fly to default
    if (prevViewRef.current) {
      try {
        map.setView(prevViewRef.current.center, prevViewRef.current.zoom);
      } catch (err) {
        map.setView(position, 13);
      }
    } else {
      map.setView(position, 13);
    }
    setIsViewFocused(false);
    setFocusedShapeBounds(null);
  };

  // ---------------- UI ----------------
  return (
    <>
      {/* Multi-Map Manager */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 60,
          zIndex: 1000,
          background: "white",
          padding: "10px 12px",
          borderRadius: "8px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          width: "220px",
        }}
      >
        <h4 style={{ margin: 0, marginBottom: 6, fontSize: "14px", textAlign: "center", fontWeight: 600 }}>
          🗺️ My Maps
        </h4>

        <select
          value={currentMap}
          onChange={(e) => handleSelectMap(e.target.value)}
          style={{ width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px", marginBottom: "6px" }}
        >
          {Object.keys(savedMaps).map((mapKey) => (
            <option key={mapKey} value={mapKey}>
              {savedMaps[mapKey].name}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={handleCreateMap}
            style={{ flex: 1, background: "#27ae60", color: "#fff", border: "none", padding: "6px", borderRadius: "4px", cursor: "pointer" }}
          >
            + New
          </button>

          <button
            onClick={handleRenameMap}
            style={{ flex: 1, background: "#f39c12", color: "#fff", border: "none", padding: "6px", borderRadius: "4px", cursor: "pointer" }}
          >
            ✏️ Rename
          </button>

          <button
            onClick={handleDeleteMap}
            style={{ flex: 1, background: "#e74c3c", color: "#fff", border: "none", padding: "6px", borderRadius: "4px", cursor: "pointer" }}
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Report Panel (with import button & hidden file input) */}
      {!showReportPanel ? (
        <button
          onClick={() => setShowReportPanel(true)}
          style={{
            position: "absolute",
            top: 360,
            left: 10,
            zIndex: 1000,
            background: "white",
            border: "1px solid #ccc",
            padding: "6px 8px",
            borderRadius: "6px",
            cursor: "pointer",
          }}
          title="Open Report Panel"
        >
          📄
        </button>
      ) : (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 330,
            zIndex: 1000,
            background: "white",
            padding: "10px 12px",
            borderRadius: "8px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
            width: "300px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0, fontSize: "14px" }}>📄 Reports</h4>
            <button onClick={() => setShowReportPanel(false)} style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer" }} title="Close">
              ❌
            </button>
          </div>

          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={exportCSV} style={{ padding: "8px", borderRadius: 6, border: "none", background: "#3498db", color: "white", cursor: "pointer" }}>
              Export CSV
            </button>

            <button onClick={handleImportClick} style={{ padding: "8px", borderRadius: 6, border: "none", background: "#6c5ce7", color: "white", cursor: "pointer" }}>
              Import CSV
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={onFileSelected}
            />

            <button onClick={exportMapSnapshot} style={{ padding: "8px", borderRadius: 6, border: "none", background: "#2ecc71", color: "white", cursor: "pointer" }}>
              Export Map Snapshot (PNG)
            </button>

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={includeCSVinPDF} onChange={(e) => setIncludeCSVinPDF(e.target.checked)} />
              <span style={{ fontSize: 13 }}>Include CSV in PDF</span>
            </label>

            <button onClick={exportPDF} style={{ padding: "8px", borderRadius: 6, border: "none", background: "#e67e22", color: "white", cursor: "pointer" }}>
              Download PDF Report
            </button>
          </div>
        </div>
      )}

      {/* Filter Panel */}
      {!showFilter ? (
        <button
          onClick={() => setShowFilter(true)}
          style={{
            position: "absolute",
            top: 320,
            left: 10,
            zIndex: 1000,
            background: "white",
            border: "1px solid #ccc",
            padding: "6px 8px",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          🔍
        </button>
      ) : (
        <div
          style={{
            position: "absolute",
            top: 270,
            left: 55,
            zIndex: 1000,
            background: "white",
            padding: "10px 12px",
            borderRadius: "8px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
            width: "220px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0, fontSize: "14px" }}>🔍 Filter & Search</h4>
            <button onClick={() => setShowFilter(false)} style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer" }}>
              ❌
            </button>
          </div>

          <input
            type="text"
            placeholder="Search markers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: "100%", padding: "6px", marginTop: "8px", marginBottom: "6px", border: "1px solid #ccc", borderRadius: "4px" }}
          />

          <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} style={{ width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px", marginBottom: "6px" }}>
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.key}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setSearchTerm("");
              setSelectedCategory("All");
            }}
            style={{ width: "100%", background: "#f0f0f0", border: "none", padding: "6px", borderRadius: "4px", cursor: "pointer" }}
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Dashboard */}
      <Dashboard markers={markers} shapes={shapes} />

      {/* Reset view cross when focused */}
      {isViewFocused && (
        <button
          onClick={resetView}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 1500,
            background: "rgba(255,255,255,0.95)",
            border: "1px solid #ccc",
            padding: "6px 8px",
            borderRadius: "6px",
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}
          title="Reset view (restore previous map view)"
        >
          ✖ Reset View
        </button>
      )}

      {/* Map */}
      <div style={{ height: "750px", width: "100%" }}>
        <MapContainer center={position} zoom={13} scrollWheelZoom ref={mapRef} style={{ height: "100%", width: "100%" }}>
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="OpenStreetMap">
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Esri Satellite">
              <LayerGroup>
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
              </LayerGroup>
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Carto Dark">
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            </LayersControl.BaseLayer>
          </LayersControl>

          {/* SearchBar container must have class 'search-bar-container' so clicks are detected by AddMarker */}
          <div className="search-bar-container" style={{ position: "absolute", zIndex: 1200 }}>
            <SearchBar />
          </div>

          <AddMarker onAdd={handleAddMarker} isDuplicate={(lat, lng) => isDuplicate(lat, lng)} />
          <ShapeDrawer shapesState={shapes} setShapesState={setShapes} onShapeFocused={onShapeFocused} setPrevView={setPrevView} />

          {geodata && <GeoJSON data={geodata} />}

          {shapes.map((s, i) => (
            <GeoJSON key={i} data={s} />
          ))}

          {filteredMarkers.map((m) => (
            <Marker key={m.id} position={m.position} icon={getCategoryIcon(m.category)}>
              <Popup>
                <input type="text" value={m.title} onChange={(e) => handleTextChange(m.id, "title", e.target.value)} style={{ width: "100%", marginBottom: "5px" }} />
                <textarea value={m.description} onChange={(e) => handleTextChange(m.id, "description", e.target.value)} style={{ width: "100%", height: "50px" }} />
                <select value={m.category} onChange={(e) => handleTextChange(m.id, "category", e.target.value)} style={{ width: "100%", marginTop: "6px" }}>
                  {CATEGORIES.map((c) => (
                    <option key={c.key}>{c.key}</option>
                  ))}
                </select>
                <input type="file" onChange={(e) => handleImageUpload(e, m.id)} style={{ marginTop: 6 }} />
                {m.image && <img src={m.image} alt="uploaded" style={{ width: "100px", marginTop: 6 }} />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setMarkers((prev) => prev.filter((x) => x.id !== m.id));
                  }}
                  style={{ background: "red", color: "white", border: "none", marginTop: "6px", padding: "6px 10px", borderRadius: "4px", cursor: "pointer" }}
                >
                  Delete Marker
                </button>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </>
  );
};

export default Map;







