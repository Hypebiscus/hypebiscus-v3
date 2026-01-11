-- Add constraint to prevent data corruption
-- Ensures positions can't have both isActive=true AND closedAt set
-- This prevents the issue where positions are marked active but have a close timestamp

-- Migration: add_position_closed_constraint
-- Date: 2026-01-11
-- Description: Prevent positions from having inconsistent state (isActive=true AND closedAt IS NOT NULL)

-- First, fix any existing corrupted data
UPDATE positions
SET "closedAt" = NULL
WHERE "isActive" = true AND "closedAt" IS NOT NULL;

-- Add check constraint to prevent future corruption
ALTER TABLE positions
ADD CONSTRAINT positions_closed_consistency CHECK (
  -- If active, closedAt must be NULL
  ("isActive" = true AND "closedAt" IS NULL) OR
  -- If inactive, closedAt must be set
  ("isActive" = false AND "closedAt" IS NOT NULL)
);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT positions_closed_consistency ON positions IS
'Ensures positions cannot be both active and closed at the same time. Active positions must have closedAt=NULL, closed positions must have closedAt set.';
