// Maxwell DealFlow CRM — Supabase Configuration
const SUPABASE_URL = 'https://bxwmbrdndsetjwcexwpc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4d21icmRuZHNldGp3Y2V4d3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTgzOTgsImV4cCI6MjA5MDU3NDM5OH0.zHSYjhbbZqG4Bx76Jyrjpak2mwPrkQKk42ZOBkhYkzc';

// Claude API proxy endpoint (Supabase Edge Function — added after deploy)
const CLAUDE_PROXY_URL = `${SUPABASE_URL}/functions/v1/claude-chat`;

// Web Push (VAPID) — public key for push subscription
// Private key lives ONLY in Supabase secrets (never in client code)
const VAPID_PUBLIC_KEY = 'BH3dmIs9gHMMlzYgzzzQ5nDjpHpJmo7mNmM3UBY5hUbAQyiWItJDsJuXqUVQzJCEWITyHpf289ayNt-q5-xV0-I';
const PUSH_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-push`;
