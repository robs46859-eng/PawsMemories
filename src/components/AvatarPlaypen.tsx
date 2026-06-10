import React, { useState, useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence } from "motion/react";
import { Avatar } from "../types";

interface AvatarPlaypenProps {
  avatar: Avatar;
  actionTrigger: { type: "feed" | "water" | "treat"; timestamp: number } | null;
  onActionComplete: (actionType: "feed" | "water" | "treat", avatarId: number) => Promise<void>;
  isDarkMode: boolean;
}

interface FloatingEmoji {
  id: number;
  char: string;
  x: number;
  y: number;
}

export default function AvatarPlaypen({ avatar, actionTrigger, onActionComplete, isDarkMode }: AvatarPlaypenProps) {
  // Decay logic in playpen (calculate local levels to show warnings/states)
  const calculateDecay = (timestamp: string, currentLevel: number) => {
    const lastTime = new Date(timestamp).getTime();
    const now = Date.now();
    const hoursElapsed = (now - lastTime) / (1000 * 60 * 60);
    return Math.max(0, currentLevel - Math.floor(hoursElapsed * 5));
  };

  const currentFood = calculateDecay(avatar.last_fed, avatar.food_level);
  const currentWater = calculateDecay(avatar.last_watered, avatar.water_level);
  const isLowEnergy = currentFood < 30 || currentWater < 30;

  // 3D Parallax Hover Effect
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useTransform(mouseY, [-0.5, 0.5], [12, -12]);
  const rotateY = useTransform(mouseX, [-0.5, 0.5], [-12, 12]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const x = e.clientX - rect.left - width / 2;
    const y = e.clientY - rect.top - height / 2;
    mouseX.set(x / width);
    mouseY.set(y / height);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  // Pet movement coordinates (represented as percentages 0 to 100)
  const currentPosRef = useRef({ x: 50, y: 60 });
  const [targetPos, setTargetPos] = useState({ x: 50, y: 60 });
  const [isMoving, setIsMoving] = useState(false);
  const [facingRight, setFacingRight] = useState(true);

  // Interaction States
  const [isEating, setIsEating] = useState(false);
  const [isDoingTrick, setIsDoingTrick] = useState(false);
  const [droppedItem, setDroppedItem] = useState<{ type: "feed" | "water" | "treat"; x: number; y: number } | null>(null);
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);

  // Function to move pet to target
  const moveTo = (x: number, y: number, duration = 1200) => {
    // Determine facing direction
    if (x > currentPosRef.current.x) {
      setFacingRight(true);
    } else if (x < currentPosRef.current.x) {
      setFacingRight(false);
    }

    currentPosRef.current = { x, y };
    setTargetPos({ x, y });
    setIsMoving(true);

    setTimeout(() => {
      setIsMoving(false);
    }, duration);
  };

  // Helper to spawn floating emojis
  const spawnEmoji = (char: string, customX?: number, customY?: number) => {
    const id = Date.now() + Math.random();
    const x = customX !== undefined ? customX : currentPosRef.current.x + (Math.random() * 10 - 5);
    const y = customY !== undefined ? customY : currentPosRef.current.y - 12;
    
    setEmojis((prev) => [...prev, { id, char, x, y }]);
    
    setTimeout(() => {
      setEmojis((prev) => prev.filter((e) => e.id !== id));
    }, 1800);
  };

  // Idle Roaming Loop
  useEffect(() => {
    if (isEating || isDoingTrick || droppedItem) return;

    const walk = () => {
      // Avoid borders: X (15-85), Y (40-80)
      const newX = 15 + Math.random() * 70;
      const newY = 40 + Math.random() * 40;
      moveTo(newX, newY, isLowEnergy ? 2000 : 1200);
    };

    const interval = setInterval(walk, isLowEnergy ? 8000 : 4500);
    return () => clearInterval(interval);
  }, [isEating, isDoingTrick, !!droppedItem, isLowEnergy]);

  // Periodic sleepy emoji when low energy
  useEffect(() => {
    if (!isLowEnergy || isEating || isDoingTrick) return;
    
    const interval = setInterval(() => {
      spawnEmoji("💤");
    }, 4000);
    
    return () => clearInterval(interval);
  }, [isLowEnergy, isEating, isDoingTrick]);

  // Handle feed/water/treat action trigger from parent
  useEffect(() => {
    if (!actionTrigger) return;

    // 1. Drop item at a random spot in the active zone
    const itemX = 25 + Math.random() * 50;
    const itemY = 50 + Math.random() * 25;
    setDroppedItem({ type: actionTrigger.type, x: itemX, y: itemY });

    // 2. Pet waits 300ms, then runs/hops to the item
    const runTimeout = setTimeout(() => {
      moveTo(itemX, itemY, 1000);
    }, 3000 - 1500 > 0 ? 300 : 0);

    // 3. Pet arrives at item -> starts eating
    const eatTimeout = setTimeout(() => {
      setIsEating(true);
      setDroppedItem(null); // Eat the item
      
      // Eat animation: rapid bobbing up and down
      let eatCount = 0;
      const eatInterval = setInterval(() => {
        spawnEmoji(actionTrigger.type === "water" ? "💧" : "😋");
        eatCount++;
        if (eatCount >= 3) {
          clearInterval(eatInterval);
        }
      }, 300);

      // Finish eating
      setTimeout(async () => {
        setIsEating(false);
        spawnEmoji("❤️");
        spawnEmoji("✨");
        
        // Notify parent to update backend
        try {
          await onActionComplete(actionTrigger.type, avatar.id);
        } catch (err) {
          console.error("Failed to complete playpen action", err);
        }
      }, 1200);

    }, 1500);

    return () => {
      clearTimeout(runTimeout);
      clearTimeout(eatTimeout);
    };
  }, [actionTrigger]);

  // Trigger trick on tap
  const handleTapPet = () => {
    if (isEating || isMoving || isDoingTrick) return;
    
    setIsDoingTrick(true);
    spawnEmoji(isLowEnergy ? "🥱" : "⭐");
    
    setTimeout(() => {
      setIsDoingTrick(false);
    }, 1000);
  };

  // Hopping bounce animation while moving
  const petBounceY = isMoving 
    ? [0, -12, 0] 
    : isEating 
      ? [0, -8, 0, -8, 0] 
      : isDoingTrick 
        ? [0, -28, 0] 
        : [0, -2, 0];

  return (
    <div 
      className="relative w-full aspect-square overflow-hidden rounded-t-3xl select-none"
      style={{ perspective: 1000 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* 3D Tilting Yard */}
      <motion.div
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
        className="w-full h-full bg-gradient-to-b from-emerald-100 to-emerald-200 dark:from-emerald-950/40 dark:to-emerald-900/30 flex flex-col justify-end relative transition-all duration-300 ease-out border-b border-outline-variant/10"
      >
        {/* Backyard details for depth */}
        <div className="absolute inset-x-0 top-0 h-10 border-b-2 border-emerald-900/10 dark:border-emerald-100/5 bg-emerald-800/10 dark:bg-emerald-950/20 flex justify-between px-6 items-center">
          <span className="text-[10px] opacity-40 font-bold tracking-widest text-emerald-900 dark:text-emerald-300">PLAYPEN</span>
          <div className="flex gap-1">
            <span className="text-xs">🪵</span>
            <span className="text-xs">🪵</span>
            <span className="text-xs">🪵</span>
          </div>
        </div>

        {/* Scattered Flowers / Grass Tufts */}
        <div className="absolute top-[40%] left-[20%] text-[10px] opacity-30">🌼</div>
        <div className="absolute top-[65%] left-[80%] text-[10px] opacity-35">🌸</div>
        <div className="absolute top-[55%] left-[45%] text-[10px] opacity-20">🌱</div>
        <div className="absolute top-[75%] left-[15%] text-[10px] opacity-25">🌼</div>

        {/* Dropped Action Item */}
        <AnimatePresence>
          {droppedItem && (
            <motion.div
              initial={{ top: "-10%", left: `${droppedItem.x}%`, scale: 0.2, opacity: 0 }}
              animate={{ top: `${droppedItem.y}%`, scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 120, damping: 8 }}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-10 filter drop-shadow-md pointer-events-none"
            >
              <div className="text-3xl select-none">
                {droppedItem.type === "feed" ? "🥩" : droppedItem.type === "water" ? "💧" : "🦴"}
              </div>
              <div className="w-6 h-2 bg-black/10 rounded-full blur-[1px] mx-auto mt-0.5" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pet Shadow */}
        <motion.div
          animate={{
            left: `${targetPos.x}%`,
            top: `${targetPos.y + 4}%`,
            scale: isDoingTrick ? 0.6 : isMoving ? [1, 0.85, 1] : 1,
          }}
          transition={{
            type: "spring",
            stiffness: isLowEnergy ? 35 : 60,
            damping: 15,
          }}
          className="absolute w-12 h-3 bg-black/15 dark:bg-black/30 rounded-full blur-[2px] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        />

        {/* Pet Avatar Container */}
        <motion.div
          animate={{
            left: `${targetPos.x}%`,
            top: `${targetPos.y}%`,
          }}
          transition={{
            type: "spring",
            stiffness: isLowEnergy ? 35 : 60,
            damping: 15,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-20"
        >
          <motion.div
            animate={{
              y: petBounceY,
              rotate: isDoingTrick ? 360 : 0,
              scaleX: facingRight ? 1 : -1,
            }}
            transition={{
              y: {
                repeat: isMoving ? Infinity : isEating ? 2 : 0,
                duration: isMoving ? (isLowEnergy ? 0.8 : 0.45) : isEating ? 0.3 : 1,
                ease: "easeInOut",
              },
              rotate: {
                duration: 0.8,
                ease: "easeInOut",
              }
            }}
            onClick={handleTapPet}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-[3px] border-white dark:border-slate-800 shadow-xl overflow-hidden relative active:scale-95 transition-transform bg-slate-200"
          >
            <img 
              src={avatar.image_url} 
              alt={avatar.name} 
              className="w-full h-full object-cover pointer-events-none" 
            />
            
            {/* Sleeping Overlay Filter */}
            {isLowEnergy && (
              <div className="absolute inset-0 bg-indigo-900/10 mix-blend-multiply pointer-events-none" />
            )}
          </motion.div>
        </motion.div>

        {/* Floating Emojis */}
        <AnimatePresence>
          {emojis.map((e) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 0, scale: 0.5, x: `${e.x}%`, top: `${e.y}%` }}
              animate={{ opacity: 1, y: -45, scale: 1.2 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="absolute -translate-x-1/2 text-xl font-bold select-none z-30 pointer-events-none drop-shadow-sm"
            >
              {e.char}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
