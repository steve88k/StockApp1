import {API_BASE_URL} from '../config/env';
import {PredictionResponse} from '../types/prediction';

export async function fetchPrediction(symbol: string): Promise<PredictionResponse> {
  const url = `${API_BASE_URL}/api/predict?q=${encodeURIComponent(symbol)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}
