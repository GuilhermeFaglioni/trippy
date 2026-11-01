-- Mudança de nome de um usuário precisa chegar aos membros que já sincronizaram.
-- Cada viagem em que ele é membro ganha um seq novo, para o pull incremental reenviar a linha.
CREATE FUNCTION bump_member_seq_on_name_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  membership RECORD;
  next_seq bigint;
BEGIN
  FOR membership IN
    SELECT trip_id FROM trip_members WHERE user_id = NEW.id ORDER BY trip_id
  LOOP
    UPDATE trips
       SET seq_counter = seq_counter + 1
     WHERE id = membership.trip_id
     RETURNING seq_counter INTO next_seq;

    UPDATE trip_members
       SET seq = next_seq
     WHERE trip_id = membership.trip_id AND user_id = NEW.id;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_name_bumps_member_seq_trigger
AFTER UPDATE OF name ON users
FOR EACH ROW
WHEN (NEW.name IS DISTINCT FROM OLD.name)
EXECUTE FUNCTION bump_member_seq_on_name_change();
