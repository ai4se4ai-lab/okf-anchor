-- Immutability guards (CLAUDE.md §3 "Overwrite attempts must fail loud";
-- skill: okf-prisma-postgres). A published OKF asset version and its five-layer
-- records are append-only. These triggers make an accidental UPDATE or DELETE
-- raise instead of silently mutating published history.
--
-- Rows are written once, fully populated, inside the publish transaction. If a
-- future migration genuinely needs to touch a published row it must first
-- `ALTER TABLE ... DISABLE TRIGGER`, make the change in a reviewed migration,
-- and re-enable — never work around this from application code.

CREATE OR REPLACE FUNCTION okf_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'okf: % on %.% is not allowed — published OKF records are immutable (id=%)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, COALESCE(OLD.id, NEW.id)
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- Fully append-only tables.
CREATE TRIGGER okf_immutable_asset_version
  BEFORE UPDATE OR DELETE ON "AssetVersion"
  FOR EACH ROW EXECUTE FUNCTION okf_reject_mutation();

CREATE TRIGGER okf_immutable_canonical
  BEFORE UPDATE OR DELETE ON "CanonicalRepresentation"
  FOR EACH ROW EXECUTE FUNCTION okf_reject_mutation();

CREATE TRIGGER okf_immutable_graph
  BEFORE UPDATE OR DELETE ON "KnowledgeGraph"
  FOR EACH ROW EXECUTE FUNCTION okf_reject_mutation();

CREATE TRIGGER okf_immutable_source
  BEFORE UPDATE OR DELETE ON "OkfSource"
  FOR EACH ROW EXECUTE FUNCTION okf_reject_mutation();

CREATE TRIGGER okf_immutable_storage_object
  BEFORE UPDATE OR DELETE ON "StorageObject"
  FOR EACH ROW EXECUTE FUNCTION okf_reject_mutation();

CREATE TRIGGER okf_immutable_publication_history
  BEFORE UPDATE OR DELETE ON "PublicationHistory"
  FOR EACH ROW EXECUTE FUNCTION okf_reject_mutation();

-- Anchor is mutable only while the on-chain state is not yet CONFIRMED
-- (pending -> submitted -> confirmed for async EVM/DKG providers). Once
-- CONFIRMED it is frozen.
CREATE OR REPLACE FUNCTION okf_reject_confirmed_anchor_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.state = 'CONFIRMED' THEN
    RAISE EXCEPTION 'okf: % on Anchor % is not allowed — a confirmed anchor is immutable', TG_OP, OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER okf_immutable_confirmed_anchor
  BEFORE UPDATE OR DELETE ON "Anchor"
  FOR EACH ROW EXECUTE FUNCTION okf_reject_confirmed_anchor_mutation();
