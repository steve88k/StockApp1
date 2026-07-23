import {loadTensorflowModel} from 'react-native-fast-tflite';
import {buildModelInput, FundamentalInfo, PriceBar} from './featureBuilder';
import {standardizeInput} from './scaler';
import outputCols from '../assets/output_cols.json';

export type Horizon = '3m' | '6m' | '9m' | '12m';
export type Growth = '10' | '20' | '30';

type OutputMeta = {
  output_cols: string[];
  index_map: Record<string, number>;
};

const meta = outputCols as OutputMeta;

function toArrayBuffer(values: Float32Array): ArrayBuffer {
  return values.buffer.slice(
    values.byteOffset,
    values.byteOffset + values.byteLength,
  ) as ArrayBuffer;
}

/** Build key used in output_cols / threshold map, e.g. y_12m_30 */
export function outputKey(horizon: Horizon, growth: Growth): string {
  return `y_${horizon}_${growth}`;
}

/** Pick one probability from the 12-dim model output. */
export function pickProbability(
  probs: Float32Array,
  horizon: Horizon,
  growth: Growth,
): number {
  const key = outputKey(horizon, growth);
  const idx = meta.index_map?.[key];
  const i =
    typeof idx === 'number'
      ? idx
      : Math.max(0, meta.output_cols?.indexOf(key) ?? 0);
  const v = Number(probs[i] ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/**
 * Run TFLite multi-output inference.
 * Returns all 12 probabilities; caller selects by horizon + growth.
 */
export async function predict(
  modelPath: any,
  history: PriceBar[],
  info: FundamentalInfo,
) {
  if (!modelPath) {
    throw new Error(
      'Model asset is required. Please use require("../assets/your-model.tflite")',
    );
  }

  try {
    const model = await loadTensorflowModel(modelPath, []);
    const raw = buildModelInput(history, info);
    const input = standardizeInput(raw);
    const output = await model.run([toArrayBuffer(input)]);

    const first = output?.[0];
    const probs = first
      ? new Float32Array(first)
      : new Float32Array(meta.output_cols?.length || 12);

    return {probs, raw, input};
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'unknown error');
    console.error('TFLite prediction error:', message, error);
    throw new Error(
      `TFLite inference failed: ${message}. ` +
        'On Android release, the model must be bundled via require() (res/raw), not only copied into android/app/src/main/assets.',
    );
  }
}
