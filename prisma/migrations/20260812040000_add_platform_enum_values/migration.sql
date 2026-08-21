-- Extend Platform enum with all major influencer-campaign platforms.
-- Additive only (ALTER TYPE ADD VALUE); safe/non-destructive.
ALTER TYPE "Platform" ADD VALUE IF NOT EXISTS 'FACEBOOK';
ALTER TYPE "Platform" ADD VALUE IF NOT EXISTS 'TWITCH';
ALTER TYPE "Platform" ADD VALUE IF NOT EXISTS 'THREADS';
ALTER TYPE "Platform" ADD VALUE IF NOT EXISTS 'PINTEREST';
-- SNAPCHAT and LINKEDIN are added by 20260814000000_song_phase_and_platforms,
-- which is already applied and adds them without IF NOT EXISTS. Adding them
-- here too would make that later migration fail on a fresh database.
