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
