import {Router} from 'express';
import {getPrediction} from '../controllers/predictController';

const router = Router();

router.get('/predict', getPrediction);

export default router;
