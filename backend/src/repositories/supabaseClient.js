import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'ine-price-tracker' } },
  }
);

export function unwrap({ data, error }, context) {
  if (error) {
    const err = new Error(`${context}: ${error.message}`);
    err.code = error.code;
    err.details = error.details;
    throw err;
  }
  return data;
}
