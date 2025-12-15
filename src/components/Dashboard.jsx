// src/components/Dashboard.jsx
import React, { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

// colors that match your markers
const CATEGORY_COLORS = {
  General: "#3388ff",
  Restaurant: "#e74c3c",
  College: "#27ae60",
  Event: "#f1c40f",
  Shop: "#9b59b6",
};

const Dashboard = ({ markers, shapes }) => {
  const data = useMemo(() => {
    const counts = {};
    markers.forEach((m) => {
      const cat = m.category || "General";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({
      name,
      value,
      color: CATEGORY_COLORS[name] || "#3388ff",
    }));
  }, [markers]);

  const totalMarkers = markers.length;
  const totalShapes = shapes.length;

  // helper: stop and prevent events in capture phase
  const stopAll = (e) => {
    e.stopPropagation();
    if (e.nativeEvent) {
      // prevent browser default wheel / touch behaviors reaching map
      e.nativeEvent.stopImmediatePropagation?.();
    }
    e.preventDefault?.();
  };

  return (
    <div
      /* IMPORTANT: high zIndex + pointerEvents ensures this box intercepts input */
      style={{
        position: "absolute",
        top: 180,
        right: 10,
        zIndex: 99999,
        background: "white",
        borderRadius: "10px",
        padding: "10px 14px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        width: "260px",
        pointerEvents: "auto",
        
      }}
      /* use capture-phase handlers to intercept input before Leaflet's listeners */
      onMouseDownCapture={stopAll}
      onClickCapture={stopAll}
      onTouchStartCapture={stopAll}
      onTouchEndCapture={stopAll}
      onWheelCapture={stopAll}
    >
      <h4 style={{ margin: "0 0 8px", color: "#333" }}>📊 Dashboard</h4>

      <p style={{ margin: "4px 0" }}>
        <strong>Total Markers:</strong> {totalMarkers}
      </p>
      <p style={{ margin: "4px 0" }}>
        <strong>Total Shapes:</strong> {totalShapes}
      </p>

      <div style={{ pointerEvents: "auto" }}>
        <PieChart width={230} height={280}>
          <Pie
            data={data}
            cx={110}
            cy={90}
            outerRadius={70}
            dataKey="value"
            label
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </div>
    </div>
  );
};

export default Dashboard;

