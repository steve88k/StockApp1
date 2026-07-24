import {Growth, Horizon} from '../ml/prediction';

export type FavoriteStock = {
  symbol: string;
  addedAt: number;
  horizon: Horizon;
  growth: Growth;
};

export type FavoriteLiveItem = {
  symbol: string;
  horizon: Horizon;
  growth: Growth;
  price: number | null;
  currency?: string;
  /** Model probability 0–1 */
  probability: number | null;
  error?: string;
};
