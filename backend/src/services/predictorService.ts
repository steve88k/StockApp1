import {getMockPrediction} from '../mockData';

export function predictStock(symbol: string) {
  return getMockPrediction(symbol);
}
