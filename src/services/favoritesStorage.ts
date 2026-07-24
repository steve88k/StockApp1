import AsyncStorage from '@react-native-async-storage/async-storage';
import {Growth, Horizon} from '../ml/prediction';
import {FavoriteStock} from '../types/favorite';

const STORAGE_KEY = '@stockapp/favorites';

function cleanSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export async function loadFavorites(): Promise<FavoriteStock[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is FavoriteStock =>
          item != null &&
          typeof item.symbol === 'string' &&
          item.symbol.trim().length > 0,
      )
      .map(item => ({
        symbol: cleanSymbol(item.symbol),
        addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
        horizon: (item.horizon as Horizon) || '12m',
        growth: (item.growth as Growth) || '30',
      }));
  } catch {
    return [];
  }
}

async function saveFavorites(favorites: FavoriteStock[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export async function isFavorite(symbol: string): Promise<boolean> {
  const upper = cleanSymbol(symbol);
  if (!upper) {
    return false;
  }
  const favorites = await loadFavorites();
  return favorites.some(f => f.symbol === upper);
}

export async function addFavorite(
  symbol: string,
  horizon: Horizon = '12m',
  growth: Growth = '30',
): Promise<FavoriteStock[]> {
  const upper = cleanSymbol(symbol);
  if (!upper) {
    throw new Error('Please enter the ticker symbol first.');
  }

  const favorites = await loadFavorites();
  const existing = favorites.findIndex(f => f.symbol === upper);
  if (existing >= 0) {
    favorites[existing] = {
      ...favorites[existing],
      horizon,
      growth,
    };
  } else {
    favorites.unshift({
      symbol: upper,
      addedAt: Date.now(),
      horizon,
      growth,
    });
  }

  await saveFavorites(favorites);
  return favorites;
}

export async function removeFavorite(symbol: string): Promise<FavoriteStock[]> {
  const upper = cleanSymbol(symbol);
  const favorites = await loadFavorites();
  const next = favorites.filter(f => f.symbol !== upper);
  await saveFavorites(next);
  return next;
}

export async function toggleFavorite(
  symbol: string,
  horizon: Horizon = '12m',
  growth: Growth = '30',
): Promise<{favorites: FavoriteStock[]; isFavorite: boolean}> {
  const upper = cleanSymbol(symbol);
  const favorites = await loadFavorites();
  const exists = favorites.some(f => f.symbol === upper);

  if (exists) {
    const next = await removeFavorite(upper);
    return {favorites: next, isFavorite: false};
  }

  const next = await addFavorite(upper, horizon, growth);
  return {favorites: next, isFavorite: true};
}
