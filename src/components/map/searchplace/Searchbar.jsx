import React, { useState } from "react";
import { useMap } from "react-leaflet";
import { OpenStreetMapProvider } from "leaflet-geosearch";
import L from "leaflet";
import { FiSearch } from "react-icons/fi";

const SearchBar = () => {
  const map = useMap();
  const provider = new OpenStreetMapProvider();

  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(false);
  const [markerRef, setMarkerRef] = useState(null);

  // FIX: prevent Leaflet default icon bugs
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
    iconUrl: require("leaflet/dist/images/marker-icon.png"),
    shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
  });

  // SEARCH FUNCTION — FIXED
  const handleSearch = async (e) => {
    e.preventDefault();
    e.stopPropagation();   // 🔥 Stop map click

    try {
      const results = await provider.search({ query });
      if (results.length > 0) {
        const { x, y, label } = results[0];
        const latLng = [y, x];

        map.flyTo(latLng, 15);

        // remove old search marker
        if (markerRef) {
          map.removeLayer(markerRef);
        }

        // add new search marker
        const newMarker = L.marker(latLng)
          .addTo(map)
          .bindPopup(label)
          .openPopup();

        setMarkerRef(newMarker);
        setVisible(false);
        setQuery("");
      } else {
        alert("No results found.");
      }
    } catch (error) {
      console.error(error);
      alert("Search failed.");
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()} // 🔥 Prevent map click under the search bar
      style={{
        position: "absolute",
        top: 110,
        right: 10,
        zIndex: 1000,
      }}
    >
      {!visible ? (
        <button
          onClick={(e) => {
            e.stopPropagation(); // 🔥 FIX
            setVisible(true);
          }}
          style={{
            background: "white",
            border: "1px solid #ccc",
            padding: "6px",
            borderRadius: "4px",
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}
        >
          <FiSearch />
        </button>
      ) : (
        <form
          onSubmit={handleSearch}
          onClick={(e) => e.stopPropagation()} // 🔥 FIX
          style={{
            display: "flex",
            alignItems: "center",
            background: "white",
            borderRadius: "4px",
            border: "1px solid #ccc",
            padding: "2px",
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            autoFocus
            onClick={(e) => e.stopPropagation()} // 🔥 Prevent auto marker
            style={{
              border: "none",
              width: "160px",
              padding: "6px",
              outline: "none",
            }}
          />

          <button
            type="submit"
            onClick={(e) => e.stopPropagation()} // 🔥 FIX
            style={{
              background: "none",
              border: "none",
              padding: "6px",
              cursor: "pointer",
            }}
          >
            <FiSearch />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setVisible(false);
            }}
            style={{
              background: "none",
              border: "none",
              padding: "6px",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            ❌
          </button>
        </form>
      )}
    </div>
  );
};

export default SearchBar;


