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
    console.error('TFLite prediction error:', error);
    throw error;
  }
}
