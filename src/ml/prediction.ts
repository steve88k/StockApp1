import {loadTensorflowModel} from 'react-native-fast-tflite';
import {buildModelInput, FundamentalInfo, PriceBar} from './featureBuilder';
import {standardizeInput} from './scaler';

export async function predict(modelPath: any, history: PriceBar[], info: FundamentalInfo) {
  const model = await loadTensorflowModel(modelPath);
  const raw = buildModelInput(history, info);
  const input = standardizeInput(raw);
  const output = await model.run([input]);
  const score = Array.isArray(output?.[0]) ? Number(output[0][0]) : Number(output?.[0] ?? 0);
  return {score, raw, input};
}
