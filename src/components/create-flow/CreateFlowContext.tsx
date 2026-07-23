import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { RigJobResponse } from "../../api";
import {
  activeModelJobStorageKey,
  createInitialCreateFlowState,
} from "./createFlowPersistence";

export interface CreateFlowState {
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
  activeJobUuid?: string;
  rigJobUuid?: string;
  rigJob?: RigJobResponse;
  buildQuote?: any;
  buildJobDetail?: any;
}

interface CreateFlowContextValue {
  state: CreateFlowState;
  setState: React.Dispatch<React.SetStateAction<CreateFlowState>>;
  resetState: () => void;
  rigJobUuid?: string;
  rigJob?: RigJobResponse;
  setRigJobUuid: (uuid: string) => void;
  setRigJob: (job: RigJobResponse) => void;
}

const CreateFlowContext = createContext<CreateFlowContextValue | undefined>(undefined);

export function CreateFlowProvider({
  children,
  ownerKey,
}: {
  children: ReactNode;
  ownerKey?: string | null;
}) {
  const [state, setState] = useState<CreateFlowState>(() => {
    const storage = typeof window !== "undefined" ? window.sessionStorage : undefined;
    return createInitialCreateFlowState(ownerKey, storage);
  });

  useEffect(() => {
    const storage = typeof window !== "undefined" ? window.sessionStorage : undefined;
    setState(createInitialCreateFlowState(ownerKey, storage));
  }, [ownerKey]);

  const handleSetState: React.Dispatch<React.SetStateAction<CreateFlowState>> = (action) => {
    setState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      if (typeof window !== "undefined") {
        const key = activeModelJobStorageKey(ownerKey);
        if (ownerKey && next.activeJobUuid) sessionStorage.setItem(key, next.activeJobUuid);
        else sessionStorage.removeItem(key);
      }
      return next;
    });
  };

  const resetState = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(activeModelJobStorageKey(ownerKey));
    }
    setState(createInitialCreateFlowState(ownerKey));
  };

  const setRigJobUuid = (uuid: string) => {
    setState((prev) => ({ ...prev, rigJobUuid: uuid }));
  };

  const setRigJob = (job: RigJobResponse) => {
    setState((prev) => ({ ...prev, rigJob: job, rigJobUuid: job?.jobUuid || prev.rigJobUuid }));
  };

  return (
    <CreateFlowContext.Provider
      value={{
        state,
        setState: handleSetState,
        resetState,
        rigJobUuid: state.rigJobUuid,
        rigJob: state.rigJob,
        setRigJobUuid,
        setRigJob,
      }}
    >
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
