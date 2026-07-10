import React, { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { ANIMATOR_DEFAULTS } from "../../defaults.ts";

export type WeatherType = "clear" | "rain" | "snow" | "fog" | "overcast";

interface WeatherSystemProps {
  weather: WeatherType;
}

export function WeatherSystem({ weather }: WeatherSystemProps) {
  const pointsRef = useRef<THREE.Points>(null);
  
  const particleCount = ANIMATOR_DEFAULTS.weather.maxParticles;
  
  // Generate random positions
  const [positions, velocities] = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const vel = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20; // x
      pos[i * 3 + 1] = Math.random() * 20;     // y
      pos[i * 3 + 2] = (Math.random() - 0.5) * 20; // z
      vel[i] = 0.1 + Math.random() * 0.1;      // base fall speed
    }
    
    return [pos, vel];
  }, [particleCount]);

  // Update particles
  useFrame((state, delta) => {
    if (!pointsRef.current || (weather !== "rain" && weather !== "snow")) return;
    
    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
    const speedMult = weather === "rain" ? 15 : 2; // Rain is faster
    
    for (let i = 0; i < particleCount; i++) {
      let y = positions[i * 3 + 1];
      y -= velocities[i] * speedMult * delta * ANIMATOR_DEFAULTS.weather.speed;
      
      // Reset to top if it hits bottom
      if (y < 0) {
        y = 20;
        positions[i * 3] = (Math.random() - 0.5) * 20;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      }
      
      positions[i * 3 + 1] = y;
      
      // Rain has slight wind
      if (weather === "rain") {
        positions[i * 3] -= 2 * delta; 
        if (positions[i * 3] < -10) positions[i * 3] += 20;
      }
    }
    
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  if (weather === "clear" || weather === "fog" || weather === "overcast") {
    // Fog and overcast don't have particles, they just affect the scene fog and lighting
    return null;
  }

  // Visual differences between rain and snow
  const color = weather === "snow" ? "#ffffff" : "#aaaaff";
  const size = weather === "snow" ? 0.05 : 0.02;
  const opacity = weather === "snow" ? 0.8 : 0.4;
  const sizeAttenuation = true;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        color={color}
        transparent
        opacity={opacity}
        sizeAttenuation={sizeAttenuation}
        depthWrite={false}
      />
    </points>
  );
}
