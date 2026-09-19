/**
 * Single shared Supabase client.
 *
 * Uses the service-role key, which bypasses Row Level Security. That is only
 * acceptable because this client never leaves the backend: the frontend talks
 * to our Express API, never to Supabase directly.
 */

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

/**
 * Supabase errors carry useful detail, but some of it (hints, internal column
 * names) should not reach an API consumer. Throw a clean Error and keep the
 * detail for the server log.
 */
export function unwrap({ data, error }, context) {
  if (error) {
    const err = new Error(`${context}: ${error.message}`);
    err.code = error.code;
    err.details = error.details;
    throw err;
  }
  return data;
}
