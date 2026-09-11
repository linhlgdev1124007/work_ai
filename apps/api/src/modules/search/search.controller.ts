import { Router, Request, Response } from 'express';
import { searchService } from './search.service';
import { authMiddleware } from '../../middleware/auth.middleware';

export const searchRouter = Router();

// Universal Search endpoint
searchRouter.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const q = req.query.q ? String(req.query.q) : '';
    const results = await searchService.universalSearch(q, req.user!);
    return res.status(200).json({ success: true, data: results });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});
