import React, { useState, useRef, useCallback } from "react";
import { useJsApiLoader, Autocomplete, StreetViewPanorama } from "@react-google-maps/api";
import { X, Check, MapPin } from "lucide-react";
import { LocationParams } from "../types";

const LIBRARIES: ("places" | "streetView")[] = ["places", "streetView"];

interface LocationPickerProps {
  onConfirm: (location: LocationParams) => void;
  onCancel: () => void;
}

export default function LocationPicker({ onConfirm, onCancel }: LocationPickerProps) {
  const [placeLabel, setPlaceLabel] = useState<string>("My Favorite Location");
  const [lat, setLat] = useState<number>(40.7589); // Default: Times Square
  const [lng, setLng] = useState<number>(-73.9851);
  const [heading, setHeading] = useState<number>(0);
  const [pitch, setPitch] = useState<number>(0);
  const [fov, setFov] = useState<number>(90);
  
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY_BROWSER;

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey || "",
    libraries: LIBRARIES,
  });

  const onLoadAutocomplete = useCallback((autocomplete: google.maps.places.Autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const onPlaceChanged = useCallback(() => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();
      if (place.geometry && place.geometry.location) {
        const newLat = place.geometry.location.lat();
        const newLng = place.geometry.location.lng();
        setLat(newLat);
        setLng(newLng);
        setPlaceLabel(place.name || "Selected Location");
        
        // Reset POV when location changes
        setHeading(0);
        setPitch(0);
      }
    }
  }, []);

  const onPanoramaInit = useCallback((pano: google.maps.StreetViewPanorama | null) => {
    if (pano) {
      panoramaRef.current = pano;
      
      // Listen to POV changes (heading, pitch)
      pano.addListener("pov_changed", () => {
        const pov = pano.getPov();
        if (pov) {
          setHeading(pov.heading || 0);
          setPitch(pov.pitch || 0);
        }
      });

      // Listen to zoom changes (fov)
      pano.addListener("zoom_changed", () => {
        const zoom = pano.getZoom();
        if (zoom !== undefined) {
          // Google Maps Street View zoom roughly maps to FOV: 
          // zoom 1 ~ FOV 110, zoom 2 ~ FOV 90, zoom 3 ~ FOV 70, zoom 4 ~ FOV 50, zoom 5 ~ FOV 30
          const calculatedFov = Math.max(20, 110 - (zoom - 1) * 20);
          setFov(calculatedFov);
        }
      });
    }
  }, []);

  const handleConfirm = () => {
    onConfirm({
      lat,
      lng,
      heading,
      pitch,
      fov,
      placeLabel,
    });
  };

  if (loadError) {
    return (
      <div className="p-6 text-center text-red-500">
        <p>Failed to load Google Maps. Please check your browser API key.</p>
        <button onClick={onCancel} className="mt-4 text-sm underline">Close</button>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
        <p>Loading location picker...</p>
      </div>
    );
  }

  const position = { lat, lng };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
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
        Search for a place, then drag the panorama to frame your perfect shot.
      </p>

      <div className="w-full">
        <Autocomplete
          onLoad={onLoadAutocomplete}
          onPlaceChanged={onPlaceChanged}
          options={{
            types: ["geocode", "establishment"],
          }}
        >
          <input
            type="text"
            placeholder="Search for a location (e.g., Grand Canyon, Eiffel Tower)..."
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            defaultValue={placeLabel}
          />
        </Autocomplete>
      </div>

      <div className="relative h-64 w-full overflow-hidden rounded-lg border border-gray-300 bg-gray-50 md:h-80">
        <StreetViewPanorama
          position={position}
          onLoad={onPanoramaInit}
          options={{
            zoomControl: true,
            motionTracking: false,
            motionTrackingControl: false,
            addressControl: false,
            fullscreenControl: false,
            showRoadLabels: false,
          }}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
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

      {/* Phase 4: Google Maps ToS Attribution */}
      <div className="pt-2 text-center">
        <p className="text-[10px] text-gray-400">
          Powered by <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">Google Maps</a>
        </p>
      </div>
    </div>
  );
}
