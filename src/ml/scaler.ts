import scaler from '../assets/scaler.json';

type Scaler = { mean_: number[]; scale_: number[] };
const s = scaler as Scaler;

/**
 * Standardize input features using pre-computed mean and scale from scaler.json.
 */
export function standardizeInput(values: Float32Array): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const mean = s.mean_[i] ?? 0;
    const scale = s.scale_[i] ?? 1;
    out[i] = scale === 0 ? 0 : (values[i] - mean) / scale;
  }
  return out;
}
