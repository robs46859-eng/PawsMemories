import React, { createContext, useContext, useState, ReactNode } from "react";

interface CreateFlowState {
  sessionId?: string;
  species: string;
  breed?: string;
  petName?: string;
  intent?: string; // "memorial", "figurine", "avatar"
  inputPhotoUrl?: string; // Base64 or object URL of user's uploaded photo
  /** "image" = from a photo, "text" = from a written description. The server
   *  has supported both since the original create dialog; the newer create flow
   *  dropped the text branch, orphaning a paid, working code path. */
  inputMode?: "image" | "text";
  /** Free-text subject description, used when inputMode === "text". */
  textPrompt?: string;
  candidateImageUrl?: string; // Generated AI reference image
  customizationState?: any; // Poses, colors, etc.
  validationState?: { passed: boolean; checks: { rule: string; pass: boolean; detail: string; }[] };
  style?: string; // e.g. "Realistic", "Cartoon"
}

interface CreateFlowContextValue {
  state: CreateFlowState;
  setState: React.Dispatch<React.SetStateAction<CreateFlowState>>;
  resetState: () => void;
}

const CreateFlowContext = createContext<CreateFlowContextValue | undefined>(undefined);

export function CreateFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CreateFlowState>({ species: "dog", inputMode: "image" });

  const resetState = () => {
    setState({ species: "dog", inputMode: "image" });
  };

  return (
    <CreateFlowContext.Provider value={{ state, setState, resetState }}>
      {children}
    </CreateFlowContext.Provider>
  );
}

export function useCreateFlow() {
  const ctx = useContext(CreateFlowContext);
  if (!ctx) {
    throw new Error("useCreateFlow must be used within a CreateFlowProvider");
  }
  return ctx;
}
