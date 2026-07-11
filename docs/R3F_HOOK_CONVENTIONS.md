# React Three Fiber (R3F) Hook Conventions

**Date:** 2026-07-11
**Context:** Phase 6 Stabilization (see §6.4 in `PHASE6_IMPLEMENTATION_PLAN.md`)

## The Rule

**Any hook exported by `@react-three/fiber` or `@react-three/drei` MUST only be called inside a React component that is rendered as a child of a `<Canvas>` element.**

### Forbidden Pattern (Out-of-Canvas)

Calling R3F hooks from a screen/UI component that *wraps* the Canvas, or from a store/provider outside the Canvas tree, will cause a fatal runtime crash.

```tsx
// ❌ WRONG: Calling useFrame or useThree outside <Canvas>
import { useFrame, useThree } from '@react-three/fiber';
import { Canvas } from '@react-three/fiber';

export function AvatarScreen() {
  // CRASH: useThree needs a R3F context which only exists inside <Canvas>
  const { camera } = useThree(); 
  
  // CRASH: useFrame needs the R3F loop which only exists inside <Canvas>
  useFrame(() => { ... });

  return (
    <div className="ui-overlay">
      <Canvas>
         <MyModel />
      </Canvas>
    </div>
  );
}
```

### Correct Pattern (In-Canvas Child)

Extract the R3F logic into a dedicated child component and render it *inside* the `<Canvas>`.

```tsx
// ✅ CORRECT: Extract to a child component
import { useFrame, useThree } from '@react-three/fiber';
import { Canvas } from '@react-three/fiber';

// This component is safe because it only renders inside <Canvas>
function CameraController() {
  const { camera } = useThree();
  
  useFrame(() => {
    // animate camera
  });
  
  return null; // Logic-only components return null
}

export function AvatarScreen() {
  // UI logic goes here (React state, standard hooks)
  
  return (
    <div className="ui-overlay">
      <Canvas>
         <CameraController />
         <MyModel />
      </Canvas>
    </div>
  );
}
```

## Why this happens

R3F creates a separate React reconciler inside the `<Canvas>`. Hooks like `useThree`, `useFrame`, `useLoader`, and `useGraph` rely on a Context Provider that is only instantiated *within* that custom reconciler. When a standard DOM component (like `AvatarScreen`) calls these hooks, React looks up the tree for the R3F Context, fails to find it, and throws an exception, crashing the entire application.

## Auditing existing code

As part of Phase 6, all files in `src/three/` and `src/animator/` have been swept. If you introduce new hooks (like `useGLTF`, `useAnimations`, or `useTexture`), verify the component is exclusively instantiated inside a `<Canvas>`.
