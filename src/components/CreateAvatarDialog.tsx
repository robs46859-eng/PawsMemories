import React, { useState } from "react";
import { Terminal, X, Check, Code } from "lucide-react";

interface CreateAvatarDialogProps {
  onClose: () => void;
  onSubmit: (name: string, python_script: string) => void;
  isDarkMode: boolean;
}

const DEFAULT_SCRIPT = `import bpy
import math
import os
import mathutils

# --- 1. Setup Camera ---
scene = bpy.context.scene
cam_data = bpy.data.cameras.new("AnimalCam")
cam_obj = bpy.data.objects.new("AnimalCam", cam_data)
scene.collection.objects.link(cam_obj)
scene.camera = cam_obj

# Position and point camera at the origin (0,0,0)
cam_obj.location = (0, -8, 3)
look_at = (0, 0, 0)
direction = mathutils.Vector(look_at) - cam_obj.location
rot_quat = direction.to_track_quat('-Z', 'Y')
cam_obj.rotation_euler = rot_quat.to_euler()

# --- 2. Setup Lighting ---
# Add a Sun Lamp
light_data = bpy.data.lights.new(name="StudioSun", type='SUN')
light_obj = bpy.data.objects.new(name="StudioSun", object_data=light_data)
scene.collection.objects.link(light_obj)
light_obj.location = (5, -5, 10)
light_data.energy = 5.0

# --- 3. Render Settings ---
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100

# output_path will be automatically overridden by the server for safe temp storage
output_path = os.path.join(os.path.expanduser('~'), 'Desktop', 'planet_zoo_render.png')
scene.render.filepath = output_path

# --- 4. Execute Render ---
print("Rendering... please wait.")
bpy.ops.render.render(write_still=True)
print(f"Render saved to: {output_path}")
`;

export default function CreateAvatarDialog({ onClose, onSubmit, isDarkMode }: CreateAvatarDialogProps) {
  const [name, setName] = useState("");
  const [script, setScript] = useState(DEFAULT_SCRIPT);

  const handleSave = () => {
    if (!name.trim()) {
      alert("Please enter a name for your avatar.");
      return;
    }
    if (!script.trim()) {
      alert("Please enter a valid python script.");
      return;
    }
    onSubmit(name.trim(), script);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className={`bg-[#1E1E1E] rounded-3xl p-6 max-w-3xl w-full shadow-2xl border border-outline-variant/30 flex flex-col h-[85vh] text-slate-200`}>
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-extrabold flex items-center gap-2 text-white">
            <Terminal className="text-primary" size={24} /> Avatar Configuration Console
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-4 flex-grow overflow-hidden">
          
          {/* Info Banner */}
          <div className="bg-blue-500/10 border border-blue-500/20 text-blue-200 rounded-xl p-4 text-sm flex gap-3 items-start">
            <Code size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold mb-1">Advanced 3D Avatar Generation</p>
              <p className="opacity-80 text-xs">
                Write a Blender Python script (<code>bpy</code>) to procedurally generate your avatar. 
                The server will execute this script via Blender CLI. The `output_path` will be safely overridden.
              </p>
            </div>
          </div>

          {/* Name Input */}
          <div>
            <label className="block text-xs font-bold mb-1.5 opacity-60 uppercase tracking-wider text-slate-400">Avatar Identifier</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. planet_zoo_dog_1"
              className="w-full bg-[#2D2D2D] border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-white font-mono"
            />
          </div>

          {/* Script Editor */}
          <div className="flex-grow flex flex-col">
            <label className="block text-xs font-bold mb-1.5 opacity-60 uppercase tracking-wider text-slate-400">Blender Python Script</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="w-full flex-grow bg-[#0D0D0D] border border-white/10 rounded-lg p-4 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-[#D4D4D4] font-mono resize-none"
              spellCheck="false"
            />
          </div>

        </div>

        {/* Action Button */}
        <div className="mt-6 pt-4 border-t border-white/10">
          <button
            onClick={handleSave}
            disabled={!name.trim() || !script.trim()}
            className="w-full bg-primary text-white py-3.5 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg active:scale-95"
          >
            <Check size={18} />
            Execute Script & Build Avatar
          </button>
        </div>

      </div>
    </div>
  );
}
