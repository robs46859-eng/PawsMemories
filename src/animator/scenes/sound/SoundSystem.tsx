import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { WeatherType } from "../weather/WeatherSystem.tsx";

interface SoundSystemProps {
  ambientUrl?: string;
  weather: WeatherType;
  volume?: number;
}

// Maps weather states to common CC0 sound URLs (placeholders or real if available)
// In a real app these would be bundled or bucket URLs
const WEATHER_SFX: Record<string, string> = {
  rain: "/animator-files/sounds/rain_loop.mp3",
  snow: "/animator-files/sounds/wind_snow_loop.mp3",
};

export function SoundSystem({ ambientUrl, weather, volume = 0.5 }: SoundSystemProps) {
  const { camera } = useThree();
  const [listener] = useState(() => new THREE.AudioListener());
  
  const ambientAudio = useRef<THREE.Audio | null>(null);
  const weatherAudio = useRef<THREE.Audio | null>(null);
  
  useEffect(() => {
    camera.add(listener);
    return () => {
      camera.remove(listener);
    };
  }, [camera, listener]);

  useEffect(() => {
    if (!ambientUrl) return;

    const audioLoader = new THREE.AudioLoader();
    const audio = new THREE.Audio(listener);
    ambientAudio.current = audio;

    audioLoader.load(ambientUrl, (buffer) => {
      audio.setBuffer(buffer);
      audio.setLoop(true);
      audio.setVolume(volume);
      audio.play();
    }, undefined, (err) => {
      console.warn("Failed to load ambient sound:", err);
    });

    return () => {
      if (audio.isPlaying) audio.stop();
      ambientAudio.current = null;
    };
  }, [ambientUrl, listener, volume]);

  useEffect(() => {
    const sfxUrl = WEATHER_SFX[weather];
    if (!sfxUrl) {
      if (weatherAudio.current && weatherAudio.current.isPlaying) {
        weatherAudio.current.stop();
      }
      return;
    }

    const audioLoader = new THREE.AudioLoader();
    const audio = new THREE.Audio(listener);
    weatherAudio.current = audio;

    audioLoader.load(sfxUrl, (buffer) => {
      audio.setBuffer(buffer);
      audio.setLoop(true);
      audio.setVolume(volume * 0.8); // weather SFX slightly quieter than ambient
      audio.play();
    }, undefined, (err) => {
      console.warn("Failed to load weather SFX:", err);
    });

    return () => {
      if (audio.isPlaying) audio.stop();
      weatherAudio.current = null;
    };
  }, [weather, listener, volume]);

  // Handle live volume updates
  useEffect(() => {
    if (ambientAudio.current && ambientAudio.current.isPlaying) {
      ambientAudio.current.setVolume(volume);
    }
    if (weatherAudio.current && weatherAudio.current.isPlaying) {
      weatherAudio.current.setVolume(volume * 0.8);
    }
  }, [volume]);

  return null; // Purely logical component, no visual output
}
