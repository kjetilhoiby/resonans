/**
 * Import mock for $env/dynamic/private
 */
import { config } from 'dotenv';
config();

export const env = process.env;
