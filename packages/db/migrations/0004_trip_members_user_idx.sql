CREATE INDEX trip_members_active_user_idx
  ON trip_members (user_id)
  WHERE left_at IS NULL;
