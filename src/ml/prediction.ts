import {loadTensorflowModel} from 'react-native-fast-tflite';
import {buildModelInput, FundamentalInfo, PriceBar} from './featureBuilder';
import {standardizeInput} from './scaler';

function toArrayBuffer(values: Float32Array): ArrayBuffer {
  return values.buffer.slice(
    values.byteOffset,
    values.byteOffset + values.byteLength,
  ) as ArrayBuffer;
}

function scoreFromOutput(output: ArrayBuffer[]): number {
  const first = output?.[0];
  if (!first) return 0;
  const values = new Float32Array(first);
  const score = Number(values[0]);
  return Number.isFinite(score) ? score : 0;
}

/**
 * Run TFLite model inference for stock prediction.
 * @param modelPath - The required model asset (use require('../assets/xxx.tflite'))
 * @param history - Historical price bars
 * @param info - Fundamental information
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
    const score = scoreFromOutput(output);
    return {score, raw, input};
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
