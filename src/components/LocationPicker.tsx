import React, { useState, useRef, useEffect } from "react";
import { useJsApiLoader } from "@react-google-maps/api";
import { X, Check, MapPin, AlertCircle } from "lucide-react";
import { LocationParams } from "../types";

// IMPORTANT: keep this list identical to the one used in SignUp.tsx.
// @react-google-maps/api shares a single loader, and mismatched library lists
// cause it to error out / reload — which previously left this picker blank.
const LIBRARIES: "places"[] = ["places"];

interface LocationPickerProps {
  onConfirm: (location: LocationParams) => void;
  onCancel: () => void;
}

export default function LocationPicker({ onConfirm, onCancel }: LocationPickerProps) {
  const [placeLabel, setPlaceLabel] = useState<string>("Times Square, New York");
  const [lat, setLat] = useState<number>(40.7589); // Default: Times Square (good SV coverage)
  const [lng, setLng] = useState<number>(-73.9851);
  const [heading, setHeading] = useState<number>(0);
  const [pitch, setPitch] = useState<number>(0);
  const [fov, setFov] = useState<number>(90);
  const [noCoverage, setNoCoverage] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const panoDivRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY_BROWSER;

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey || "",
    libraries: LIBRARIES,
  });

  // Classic Places Autocomplete on a plain input. This uses the (enabled)
  // Places API and is the same approach the working sign-up screen uses — it
  // avoids PlaceAutocompleteElement, which requires the "Places API (New)".
  useEffect(() => {
    if (!isLoaded || !inputRef.current) return;
    const places = (window as any).google?.maps?.places;
    if (!places?.Autocomplete) {
      console.warn("Places Autocomplete unavailable.");
      return;
    }
    const ac = new places.Autocomplete(inputRef.current, {
      fields: ["geometry", "name", "formatted_address"],
    });
    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const loc = place.geometry?.location;
      if (loc) {
        setLat(loc.lat());
        setLng(loc.lng());
        setPlaceLabel(place.name || place.formatted_address || "Selected location");
        setHeading(0);
        setPitch(0);
      }
    });
    return () => {
      try { (window as any).google?.maps?.event?.removeListener?.(listener); } catch {}
    };
  }, [isLoaded]);

  // Create / move the Street View panorama imperatively on our own div.
  // Rendering it this way (instead of the <StreetViewPanorama> component, which
  // must live inside a <GoogleMap> and otherwise throws) is what fixes the
  // blank/white screen. We also probe coverage first so we never show an
  // empty grey panorama.
  useEffect(() => {
    if (!isLoaded || !panoDivRef.current) return;
    const maps = (window as any).google?.maps;
    if (!maps) return;

    const service = new maps.StreetViewService();
    service.getPanorama({ location: { lat, lng }, radius: 150 }, (data: any, status: string) => {
      if (status === "OK" && data?.location?.latLng) {
        setNoCoverage(false);
        if (!panoRef.current) {
          panoRef.current = new maps.StreetViewPanorama(panoDivRef.current, {
            position: { lat, lng },
            pov: { heading, pitch },
            zoom: 1,
            addressControl: false,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
            showRoadLabels: false,
            zoomControl: true,
          });
          panoRef.current.addListener("pov_changed", () => {
            const pov = panoRef.current!.getPov();
            if (pov) {
              setHeading(pov.heading || 0);
              setPitch(pov.pitch || 0);
            }
          });
          panoRef.current.addListener("zoom_changed", () => {
            const zoom = panoRef.current!.getZoom();
            if (zoom !== undefined && zoom !== null) {
              setFov(Math.max(20, 110 - (zoom - 1) * 20));
            }
          });
        } else {
          panoRef.current.setPosition({ lat, lng });
        }
      } else {
        // No Street View imagery near this spot — keep the location but tell the user.
        setNoCoverage(true);
      }
    });
  }, [isLoaded, lat, lng]);

  const handleConfirm = () => {
    onConfirm({ lat, lng, heading, pitch, fov, placeLabel });
  };

  // Hard failure (bad/missing key or API not enabled) — never blank.
  if (loadError || !apiKey) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-6 text-center shadow-lg max-w-sm">
        <AlertCircle className="mx-auto h-6 w-6 text-red-500" />
        <p className="text-sm font-medium text-gray-700">
          The location picker couldn&apos;t load Google Maps. Please pick one of the preset backgrounds instead.
        </p>
        <button onClick={onCancel} className="mt-1 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
          Close
        </button>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-64 w-full max-w-md items-center justify-center rounded-xl bg-white text-gray-500 shadow-lg">
        <p className="text-sm">Loading location picker…</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-gray-800">
          <MapPin className="h-5 w-5 text-blue-600" />
          Choose a Location
        </h3>
        <button
          onClick={onCancel}
          className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <p className="text-sm text-gray-600">
        Search for a place (a landmark, a city, or even your own business address), then drag the view to frame the shot.
      </p>

      <input
        ref={inputRef}
        type="text"
        placeholder="Search a place — e.g. Eiffel Tower, or 123 Main St"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
      />

      <div className="relative h-64 w-full overflow-hidden rounded-lg border border-gray-300 bg-gray-100 md:h-80">
        <div ref={panoDivRef} className="h-full w-full" />
        {noCoverage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-50/95 p-4 text-center">
            <AlertCircle className="h-6 w-6 text-amber-500" />
            <p className="text-sm font-medium text-gray-700">
              No Street View imagery right here.
            </p>
            <p className="text-xs text-gray-500">
              Try searching a nearby landmark or street — we&apos;ll still use this location for the backdrop.
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-1">
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          <Check className="h-4 w-4" />
          Use This Location
        </button>
      </div>

      <div className="text-center">
        <p className="text-[10px] text-gray-400">
          Powered by{" "}
          <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">
            Google Maps
          </a>
        </p>
      </div>
    </div>
  );
}
