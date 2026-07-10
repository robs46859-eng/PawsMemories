import React, { useEffect, useState, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { SkeletonUtils } from "three-stdlib";
import { useGLTF, useAnimations } from "@react-three/drei";
import { fetchAvatars } from "../../api";
import { Avatar } from "../../types";

export interface SceneActorModelProps {
  actor: any;
}

export default function SceneActorModel({ actor }: SceneActorModelProps) {
  const [avatar, setAvatar] = useState<Avatar | null>(null);

  useEffect(() => {
    // In a real app we'd cache this list globally, but for now just fetch
    let canceled = false;
    fetchAvatars().then(list => {
      if (!canceled) {
        const found = list.find(a => a.id === actor.sourceAvatarId);
        if (found) setAvatar(found);
      }
    });
    return () => { canceled = true; };
  }, [actor.sourceAvatarId]);

  if (!avatar || !avatar.model_url) return null;

  return <ClonedModel url={avatar.rigged_model_url || avatar.model_url} transform={actor.transform} selectedClip={actor.selectedClip} />;
}

function ClonedModel({ url, transform, selectedClip }: { url: string, transform: any, selectedClip?: string }) {
  const { scene, animations } = useGLTF(url);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions, mixer } = useAnimations(animations, clone);

  useEffect(() => {
    if (!actions) return;
    // Play selectedClip or just the first clip if none selected
    const clipToPlay = selectedClip && actions[selectedClip] ? selectedClip : Object.keys(actions)[0];
    if (clipToPlay && actions[clipToPlay]) {
      actions[clipToPlay]?.reset().fadeIn(0.2).play();
    }
    return () => {
      if (clipToPlay && actions[clipToPlay]) actions[clipToPlay]?.fadeOut(0.2);
    };
  }, [actions, selectedClip]);

  return (
    <primitive 
      object={clone} 
      position={transform.position} 
      rotation={transform.rotation} 
      scale={transform.scale || 1} 
    />
  );
}
