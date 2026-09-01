import { json } from '@sveltejs/kit';
import { getPublicSupabaseConfig } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(getPublicSupabaseConfig());
