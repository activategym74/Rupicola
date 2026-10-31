"use client";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Circle, Polygon, useMapEvents, useMap } from "react-leaflet";
import { useEffect } from "react";

type Zone = { polygon: [number, number][] | null; center_lat: number | null; center_lng: number | null; radius_km: number | null };
const TILES = process.env.NEXT_PUBLIC_MAP_TILES_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

function Clicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], Math.max(map.getZoom(), 15)); }, [lat, lng, map]);
  return null;
}

/** Selección de ubicación en mapa (OpenStreetMap). Muestra las zonas de cobertura. */
export default function MapPicker({ value, onChange, zones, center }: {
  value: { lat: number; lng: number } | null; onChange: (lat: number, lng: number) => void; zones: Zone[]; center: [number, number];
}) {
  return (
    <MapContainer center={value ? [value.lat, value.lng] : center} zoom={13} className="h-64 w-full rounded-xl" scrollWheelZoom={false}>
      <TileLayer url={TILES} attribution="&copy; OpenStreetMap" />
      {zones.map((z, i) => z.radius_km && z.center_lat ? (
        <Circle key={i} center={[z.center_lat, z.center_lng!]} radius={Number(z.radius_km) * 1000} pathOptions={{ color: "#791522", weight: 1, fillOpacity: 0.06 }} />
      ) : z.polygon ? (
        <Polygon key={i} positions={z.polygon.map(([lng, lat]) => [lat, lng])} pathOptions={{ color: "#791522", weight: 1, fillOpacity: 0.06 }} />
      ) : null)}
      {value && <><CircleMarker center={[value.lat, value.lng]} radius={10} pathOptions={{ color: "#fff", weight: 3, fillColor: "#791522", fillOpacity: 1 }} /><Recenter lat={value.lat} lng={value.lng} /></>}
      <Clicker onPick={onChange} />
    </MapContainer>
  );
}
