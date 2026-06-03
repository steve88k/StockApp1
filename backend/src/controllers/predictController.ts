import {Request, Response} from 'express';
import {predictStock} from '../services/predictorService';

export function getPrediction(req: Request, res: Response) {
  const query = String(req.query.q ?? '').trim();

  if (!query) {
    return res.status(400).json({error: 'Missing q parameter'});
  }

  return res.json(predictStock(query));
}
