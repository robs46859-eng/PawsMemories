export interface SequenceStep {
  timeSeconds: number;
  action: 'cut_camera' | 'set_weather' | 'play_clip';
  target?: any;
}

export interface SceneSequence {
  id: string;
  name: string;
  steps: SequenceStep[];
}

export interface EvaluatedSequenceState {
  cameraTarget?: any;
  weatherTarget?: any;
  clipTarget?: any;
}

/**
 * Evaluates a sequence at a given point in time.
 * Returns the latest state for each action type that should be active.
 * The consumer (AnimatorScreen or SceneController) compares this with current
 * state to dispatch updates.
 */
export function evaluateSequence(
  sequence: SceneSequence,
  currentTime: number
): EvaluatedSequenceState {
  let latestCamera: SequenceStep | null = null;
  let latestWeather: SequenceStep | null = null;
  let latestClip: SequenceStep | null = null;

  for (const step of sequence.steps) {
    if (step.timeSeconds <= currentTime) {
      if (step.action === 'cut_camera') latestCamera = step;
      if (step.action === 'set_weather') latestWeather = step;
      if (step.action === 'play_clip') latestClip = step;
    }
  }

  return {
    cameraTarget: latestCamera?.target,
    weatherTarget: latestWeather?.target,
    clipTarget: latestClip?.target,
  };
}

export function runScript(script: any, currentTime: number): {
  cameraTarget?: any;
  weatherTarget?: any;
  clipTargets: Record<string, any>;
  lightTarget?: any;
  soundTarget?: any;
} {
  let latestCamera: any = null;
  let latestLight: any = null;
  let latestSound: any = null;
  let latestWeather: any = null;
  const clipTargets: Record<string, any> = {};

  for (const event of script.events) {
    if (event.time <= currentTime) {
      if (event.type === 'camera') latestCamera = event.value;
      if (event.type === 'light') latestLight = event.value;
      if (event.type === 'sound') latestSound = event.value;
      if (event.type === 'weather') latestWeather = event.value;
      if (event.type === 'clip' && event.roleId) {
        clipTargets[event.roleId] = { name: event.value, blend: event.blend || 0 };
      }
    }
  }

  return {
    cameraTarget: latestCamera,
    lightTarget: latestLight,
    soundTarget: latestSound,
    weatherTarget: latestWeather,
    clipTargets,
  };
}
